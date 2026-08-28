/* Crop-handle drag test helper — runs inside agent-browser eval.
 * Usage: define window.__cropTest then call scenarios. */
(() => {
  const CONTAINER_SEL = '.relative.cursor-crosshair';
  const RECT_SEL = '.border-2.border-primary';

  const getRect = () => {
    // Scope to the crop editor container — the active batch thumbnail ALSO
    // carries border-2 border-primary and would shadow the selection border.
    const el = document.querySelector(
      '.relative.cursor-crosshair .border-2.border-primary'
    );
    if (!el) return null;
    const s = el.style;
    return {
      x: parseFloat(s.left),
      y: parseFloat(s.top),
      w: parseFloat(s.width),
      h: parseFloat(s.height),
    };
  };

  const fire = (type, x, y) => {
    const c = document.querySelector(CONTAINER_SEL);
    const r = c.getBoundingClientRect();
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: r.left + c.clientLeft + x,
      clientY: r.top + c.clientTop + y,
    });
    c.dispatchEvent(ev);
  };

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // Drag starting at container-space point [sx,sy], moving by [dx,dy] in steps
  const drag = async (sx, sy, dx, dy, steps = 6) => {
    fire('pointerdown', sx, sy);
    for (let i = 1; i <= steps; i++) {
      fire('pointermove', sx + (dx * i) / steps, sy + (dy * i) / steps);
      await sleep(10);
    }
    fire('pointerup', sx + dx, sy + dy);
    await sleep(80); // let React flush to the DOM before callers read
  };

  window.__cropTest = {
    getRect,
    // Grab a named handle of the current rect and drag by (dx, dy).
    // handle: n|s|e|w|nw|ne|sw|se — grabbed at the rect edge midpoint/corner.
    async dragHandle(handle, dx, dy) {
      const r = getRect();
      if (!r) return 'no rect';
      const sx =
        handle.includes('w') ? r.x : handle.includes('e') ? r.x + r.w : r.x + r.w / 2;
      const sy =
        handle.includes('n') ? r.y : handle.includes('s') ? r.y + r.h : r.y + r.h / 2;
      const before = { ...r };
      await drag(sx, sy, dx, dy);
      const after = getRect();
      return JSON.stringify({
        handle,
        dx,
        dy,
        before,
        after,
        dW: +(after.w - before.w).toFixed(1),
        dH: +(after.h - before.h).toFixed(1),
        dX: +(after.x - before.x).toFixed(1),
        dY: +(after.y - before.y).toFixed(1),
      });
    },
    ratio(id) {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => x.textContent.trim() === id);
      if (!b) return 'no button ' + id;
      b.click();
      return 'clicked ' + id;
    },
  };
  return 'helper installed';
})()
