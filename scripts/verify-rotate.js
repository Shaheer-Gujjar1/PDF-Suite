(async () => {
  const out = { steps: [] };
  const push = (k, v) => out.steps.push({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v) });
  try {
    // 1. Grab the captured ZIP bytes (hook stores the ArrayBuffer directly)
    const zrec = (window.__bytes || []).find(d => d.ab);
    if (!zrec) return 'NO ZIP CAPTURED';
    const u8 = new Uint8Array(zrec.ab);
    push('zipSize', u8.length);

    // 2. Parse ZIP local file headers
    const dec = new TextDecoder();
    const entries = [];
    let p = 0;
    while (p + 30 <= u8.length && u8[p] === 0x50 && u8[p + 1] === 0x4b && u8[p + 2] === 0x03) {
      const method = u8[p + 8] | (u8[p + 9] << 8);
      const csize = u8[p + 18] | (u8[p + 19] << 8) | (u8[p + 20] << 16) | (u8[p + 21] << 24);
      const nameLen = u8[p + 26] | (u8[p + 27] << 8);
      const extraLen = u8[p + 28] | (u8[p + 29] << 8);
      const name = dec.decode(u8.subarray(p + 30, p + 30 + nameLen));
      const dataStart = p + 30 + nameLen + extraLen;
      let bytes = u8.subarray(dataStart, dataStart + csize);
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
        bytes = new Uint8Array(ab);
      }
      entries.push({ name, size: bytes.length, bytes });
      p = dataStart + csize;
    }
    push('entries', entries.map(e => e.name + ' (' + e.size + 'B)'));

    // 3. Magic + dims per entry
    const info = [];
    for (const e of entries) {
      const b = e.bytes;
      const magic = (b[0] === 0xff && b[1] === 0xd8) ? 'JPEG'
        : (b[0] === 0x89 && b[1] === 0x50) ? 'PNG'
        : (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) ? 'WEBP' : '???';
      const bmp = await createImageBitmap(new Blob([b], { type: 'application/octet-stream' }));
      info.push(e.name + ': ' + magic + ' ' + bmp.width + 'x' + bmp.height);
      e.bmp = bmp;
    }
    push('magic+dims', info);

    // 4. Pixel-verify checker 180° (PNG, lossless): out(x,y) == in(W-1-x, H-1-y)
    const chE = entries.find(e => e.name.includes('checker'));
    const phE = entries.find(e => e.name.includes('photo'));
    const wpE = entries.find(e => e.name.includes('webp'));
    const imgByAlt = (alt) => [...document.querySelectorAll('img')].find(i => i.alt === alt);

    // original bytes from the live preview object URLs
    const origBitmap = async (alt) => {
      const img = imgByAlt(alt);
      const ab = await (await fetch(img.src)).arrayBuffer();
      return createImageBitmap(new Blob([ab], { type: 'application/octet-stream' }));
    };

    // helper: sample pixels as [r,g,b]
    const px = async (bmp, x, y) => {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    if (chE && chE.bmp) {
      const o = await origBitmap('test-checker.png');
      const W = chE.bmp.width, H = chE.bmp.height;
      let bad = 0, n = 0;
      for (let gy = 0; gy < 15; gy++) for (let gx = 0; gx < 20; gx++) {
        const x = Math.floor(gx * (W - 1) / 19), y = Math.floor(gy * (H - 1) / 14);
        const a = await px(chE.bmp, x, y);
        const b = await px(o, W - 1 - x, H - 1 - y);
        if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) bad++;
        n++;
      }
      push('checker180_pixelCheck', bad + '/' + n + ' mismatches (expect 0/300)');
    }

    // 5. Pixel-verify webp flipH (lossy, tolerance 12): out(x,y) ≈ in(W-1-x, y)
    if (wpE && wpE.bmp) {
      const o = await origBitmap('test-webp.webp');
      const W = wpE.bmp.width, H = wpE.bmp.height;
      let bad = 0, maxD = 0, n = 0;
      for (let gy = 0; gy < 10; gy++) for (let gx = 0; gx < 12; gx++) {
        const x = Math.floor(gx * (W - 1) / 11), y = Math.floor(gy * (H - 1) / 9);
        const a = await px(wpE.bmp, x, y);
        const b = await px(o, W - 1 - x, y);
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        maxD = Math.max(maxD, d);
        if (d > 12) bad++;
        n++;
      }
      push('webpFlipH_pixelCheck', bad + '/' + n + ' mismatches >12 (max delta ' + maxD + ')');
    }

    // 6. Pixel-verify photo 90°CW (lossy, tolerance 14): out(dx,dy) ≈ in(dy, H-1-dx)
    if (phE && phE.bmp) {
      const o = await origBitmap('test-photo.jpg');
      const W = phE.bmp.width, H = phE.bmp.height; // 800x1200 expected
      let bad = 0, maxD = 0, n = 0;
      for (let gy = 0; gy < 10; gy++) for (let gx = 0; gx < 12; gx++) {
        const dx = Math.floor(gx * (W - 1) / 11), dy = Math.floor(gy * (H - 1) / 9);
        const a = await px(phE.bmp, dx, dy);
        const b = await px(o, dy, o.height - 1 - dx);
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        maxD = Math.max(maxD, d);
        if (d > 14) bad++;
        n++;
      }
      push('photo90_pixelCheck', bad + '/' + n + ' mismatches >14 (max delta ' + maxD + ')');
    }

    return JSON.stringify(out);
  } catch (err) {
    return 'ERROR: ' + (err && err.message);
  }
})()
