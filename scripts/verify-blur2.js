(async () => {
  const R = { checks: {}, err: null };
  try {
    const decode = async (bytes, mime) => {
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime || '' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
    };
    const b64ToBytes = (b64) => {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    };

    const zipCap = [...window.__cap].reverse().find(c => (c.type || '').includes('zip'));
    const zbytes = new Uint8Array(zipCap.ab);
    const dv = new DataView(zipCap.ab);
    const td = new TextDecoder();
    let off = 0;
    const entries = {};
    while (off + 30 <= zbytes.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      const compSize = dv.getUint32(off + 18, true);
      const nameLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const name = td.decode(zbytes.subarray(off + 30, off + 30 + nameLen));
      const dataStart = off + 30 + nameLen + extraLen;
      let data = zbytes.subarray(dataStart, dataStart + compSize);
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        data = new Uint8Array(buf);
      }
      entries[name] = data;
      off = dataStart + compSize;
    }

    /* ---- plain.png: byte-level pixel identity with source ---- */
    const srcPlain = b64ToBytes(window.__plainB64);
    const A = await decode(entries['test-plain-blurred.png']);
    const B = await decode(srcPlain);
    R.checks.plainDims = { out: [A.w, A.h], src: [B.w, B.h] };
    if (A.w === B.w && A.h === B.h) {
      let diff = 0;
      for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) diff++;
      R.checks.plainPixelDiffs = diff;
    }

    /* ---- checker: exactness outside blur influence, blur inside ---- */
    const srcChk = b64ToBytes(window.__checkerB64);
    const S = await decode(srcChk);
    const O = await decode(entries['test-checker-blurred.png']);
    R.checks.checkerDims = { out: [O.w, O.h], src: [S.w, S.h] };
    /* final shapes (normalized, read from DOM before run):
       ellipse x .148855 y .183206 w .398855 h .300254
       rect    x .599237 y .526718 w .221374 h .142494 */
    const cx = (0.148855 + 0.398855 / 2) * O.w;
    const cy = (0.183206 + 0.300254 / 2) * O.h;
    const rx = 0.398855 / 2 * O.w;
    const ry = 0.300254 / 2 * O.h;
    const bx1 = 0.599237 * O.w, by1 = 0.526718 * O.h;
    const bx2 = bx1 + 0.221374 * O.w, by2 = by1 + 0.142494 * O.h;
    const MARGIN = 62; /* 3-pass support at strength 16: r=19 -> ~57px */
    let exactKept = 0, exactBroken = 0, changedIn = 0, changedTotal = 0;
    const keepSamples = [];
    for (let y = 0; y < O.h; y += 2) {
      for (let x = 0; x < O.w; x += 2) {
        const dex = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
        const dEll = Math.max(0, (dex - 1) * Math.min(rx, ry));
        const dxr = Math.max(bx1 - x, 0, x - bx2);
        const dyr = Math.max(by1 - y, 0, y - by2);
        const dRect = Math.sqrt(dxr * dxr + dyr * dyr);
        const inShape = dEll === 0 || dRect === 0;
        const i = (y * O.w + x) * 4;
        let same = true;
        for (let k = 0; k < 3; k++) if (O.data[i + k] !== S.data[i + k]) { same = false; break; }
        if (same) continue;
        changedTotal++;
        if (inShape) changedIn++;
        if (dEll > MARGIN && dRect > MARGIN) {
          exactBroken++;
          if (keepSamples.length < 5) keepSamples.push({ x, y, dEll: Math.round(dEll), dRect: Math.round(dRect) });
        }
        if (inShape) {
          /* changed and inside -> expected */
        }
      }
    }
    /* count exact pixels outside influence */
    let kept = 0, tot = 0;
    for (let y = 0; y < O.h; y += 3) {
      for (let x = 0; x < O.w; x += 3) {
        const dex = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
        const dEll = Math.max(0, (dex - 1) * Math.min(rx, ry));
        const dxr = Math.max(bx1 - x, 0, x - bx2);
        const dyr = Math.max(by1 - y, 0, y - by2);
        const dRect = Math.sqrt(dxr * dxr + dyr * dyr);
        if (dEll <= MARGIN || dRect <= MARGIN) continue;
        tot++;
        const i = (y * O.w + x) * 4;
        let same = true;
        for (let k = 0; k < 3; k++) if (O.data[i + k] !== S.data[i + k]) { same = false; break; }
        if (same) kept++;
      }
    }
    R.checks.outsideInfluence = { exactKept: kept, totalSampled: tot, broken: exactBroken, samples: keepSamples };
    R.checks.changed = { total: changedTotal, insideShapes: changedIn };
    window.__vres2 = R;
    return 'done';
  } catch (e) {
    window.__vres2 = { err: String(e && e.message || e) };
    return 'ERR ' + (e && e.message || e);
  }
})()
