(async () => {
  const steps = [];
  const push = (k, v) => steps.push(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  try {
    const zrec = (window.__bytes || []).find(d => d.ab);
    if (!zrec) return 'NO ZIP';
    const u8 = new Uint8Array(zrec.ab);
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
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
      }
      entries.push({ name, bytes });
      p = dataStart + csize;
    }
    push('entries', entries.map(e => e.name + ' (' + e.bytes.length + 'B)'));

    const px = async (bmp, x, y) => {
      const c = new OffscreenCanvas(1, 1);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, x, y, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    for (const e of entries) {
      const b = e.bytes;
      const magic = (b[0] === 0xff && b[1] === 0xd8) ? 'JPEG'
        : (b[0] === 0x89 && b[1] === 0x50) ? 'PNG'
        : (b[0] === 0x52 && b[8] === 0x57) ? 'WEBP' : '???';
      const bmp = await createImageBitmap(new Blob([b]));
      push(e.name, magic + ' ' + bmp.width + 'x' + bmp.height);
      e.bmp = bmp;
    }

    const bandStats = async (bmp, x0, y0, x1, y1) => {
      const c = new OffscreenCanvas(x1 - x0, y1 - y0);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, -x0, -y0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let white = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
        if (d[i] < 50 && d[i + 1] < 50 && d[i + 2] < 50) dark++;
      }
      return { white, dark };
    };

    const ph = entries.find(e => e.name === 'test-photo-meme.jpg');
    if (ph) {
      const top = await bandStats(ph.bmp, 150, 40, 1050, 170);
      const mid = await bandStats(ph.bmp, 100, 330, 1100, 470);
      push('photo.topBand', top);
      push('photo.midBand', mid);
    }
    const ch = entries.find(e => e.name === 'test-checker-meme.png');
    if (ch) {
      const band = await bandStats(ch.bmp, 50, 10, 590, 110);
      push('checker.topBand', band);
      // lossless identity check far from the caption: bottom strip must equal
      // the ORIGINAL checker pixels exactly (PNG out, PNG in).
      const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit meme for test-checker.png');
      const img = btn.querySelector('img');
      const ab = await (await fetch(img.src)).arrayBuffer();
      const orig = await createImageBitmap(new Blob([ab]));
      let bad = 0;
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 16; gx++) {
          const x = Math.floor(gx * (orig.width - 1) / 15);
          const y = Math.floor(orig.height * 0.75) + gy * 6;
          const a = await px(ch.bmp, x, y);
          const b2 = await px(orig, x, y);
          if (a[0] !== b2[0] || a[1] !== b2[1] || a[2] !== b2[2] || a.length !== b2.length) bad++;
        }
      }
      push('checker.bottomIdentity', bad + '/128 mismatches (expect 0 — lossless pass-through)');
    }
    return steps.join('\n');
  } catch (err) {
    return 'ERROR: ' + (err && err.message);
  }
})()
