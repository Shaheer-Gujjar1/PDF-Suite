(async () => {
  const R = { zip: null, checks: {}, err: null };
  try {
    const rec = [...window.__cap].reverse().find(c => (c.type || '').includes('zip')) || [...window.__cap].reverse().find(c => c.type === '');
    if (!rec) return JSON.stringify({ err: 'no zip captured', caps: window.__cap.map(c => ({ t: c.type, s: c.size })) });
    const bytes = new Uint8Array(rec.ab);
    const dv = new DataView(rec.ab);
    let off = 0;
    const entries = [];
    const td = new TextDecoder();
    while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      const compSize = dv.getUint32(off + 18, true);
      const nameLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const name = td.decode(bytes.subarray(off + 30, off + 30 + nameLen));
      const dataStart = off + 30 + nameLen + extraLen;
      let data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        data = new Uint8Array(buf);
      }
      entries.push({ name, size: data.length, data });
      off = dataStart + compSize;
    }
    R.zip = entries.map(e => ({ name: e.name, size: e.size }));

    const find = n => entries.find(e => e.name === n);
    const decode = async (entry) => {
      const bmp = await createImageBitmap(new Blob([entry.data]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, ctx };
    };

    const chk = find('test-checker-blurred.png');
    if (chk) {
      const img = await decode(chk);
      const std = (cx, cy, rad) => {
        const vals = [];
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++)
            vals.push(img.ctx.getImageData(cx + dx, cy + dy, 1, 1).data[0]);
        const m = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
        return { mean: Math.round(m * 10) / 10, std: Math.round(sd * 10) / 10 };
      };
      R.checks.ellipseCenter = std(223, 160, 6);
      R.checks.boxCenter = std(454, 287, 6);
      R.checks.sharpCorner = std(602, 447, 6);
      R.checks.dims = { w: img.w, h: img.h };
    } else {
      R.err = 'checker entry missing';
    }

    const pl = find('test-plain-blurred.png');
    if (pl) {
      const bmpA = await createImageBitmap(new Blob([pl.data]));
      const bin = atob(window.__plainB64);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      const bmpB = await createImageBitmap(new Blob([b]));
      const ca = new OffscreenCanvas(bmpA.width, bmpA.height);
      ca.getContext('2d').drawImage(bmpA, 0, 0);
      const cb = new OffscreenCanvas(bmpB.width, bmpB.height);
      cb.getContext('2d').drawImage(bmpB, 0, 0);
      const da = ca.getContext('2d').getImageData(0, 0, bmpA.width, bmpA.height).data;
      const db = cb.getContext('2d').getImageData(0, 0, bmpB.width, bmpB.height).data;
      let diff = 0;
      if (da.length === db.length) for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
      else diff = -1;
      R.checks.plainPixelDiffs = diff;
      R.checks.plainDims = { w: bmpA.width, h: bmpA.height };
    }

    for (const n of ['test-photo-blurred.jpg', 'test-webp-blurred.webp']) {
      const e = find(n);
      if (e) {
        const bmp = await createImageBitmap(new Blob([e.data]));
        R.checks[n] = { w: bmp.width, h: bmp.height };
      }
    }
    window.__vres = R;
    return 'done';
  } catch (e) {
    window.__vres = { err: String(e && e.message || e) };
    return 'ERR ' + (e && e.message || e);
  }
})()
