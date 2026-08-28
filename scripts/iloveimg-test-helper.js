/* Cropper.js (iloveimg) drag test helper — runs inside agent-browser eval */
(() => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  const getBox = () => {
    const r = document.querySelector('.cropper-crop-box').getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };

  const fire = (type, x, y, target) => {
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, pointerId: 1,
    };
    const pe = new PointerEvent('pointer' + type, opts);
    const me = new MouseEvent('mouse' + type, opts);
    (target || document).dispatchEvent(pe);
    (target || document).dispatchEvent(me);
  };

  // Cropper binds down on the handle itself, move/up on the document (ownerDocument).
  const dragAction = async (action, dx, dy) => {
    const box = getBox();
    // handle start point: edge/corner of the box in viewport coords
    const sx =
      action.includes('w') ? box.x : action.includes('e') ? box.x + box.w : box.x + box.w / 2;
    const sy =
      action.includes('n') ? box.y : action.includes('s') ? box.y + box.h : box.y + box.h / 2;
    const handle = document.querySelector('.cropper-point.point-' + action) ||
                   document.querySelector('.cropper-line.line-' + action);
    const doc = handle.ownerDocument;
    fire('down', sx, sy, handle);
    await sleep(60);
    for (let i = 1; i <= 5; i++) {
      fire('move', sx + (dx * i) / 5, sy + (dy * i) / 5, doc);
      await sleep(40);
    }
    fire('up', sx + dx, sy + dy, doc);
    await sleep(150);
    const after = getBox();
    return JSON.stringify({
      action, dx, dy,
      before: box, after,
      dW: +(after.w - box.w).toFixed(1),
      dH: +(after.h - box.h).toFixed(1),
      dX: +(after.x - box.x).toFixed(1),
      dY: +(after.y - box.y).toFixed(1),
    });
  };

  window.__cj = { getBox, dragAction };
  return 'cropper helper installed';
})()
