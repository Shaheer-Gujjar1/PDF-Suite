(async () => {
  const steps = [];
  const push = (k, v) => steps.push(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  try {
    const zrec = window.__bytes[window.__bytes.length - 1];
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
    const ph = entries.find(e => e.name === 'test-photo-meme.jpg');
    if (!ph) return 'no photo entry: ' + entries.map(e => e.name).join(',');
    const bmp = await createImageBitmap(new Blob([ph.bytes]));
    push('dims', bmp.width + 'x' + bmp.height + ' (expect 1200x1056)');
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const full = ctx.getImageData(0, 0, c.width, c.height).data;
    // 1. Top bar (rows 0..127) must be pure white
    let topNonWhite = 0;
    for (let y = 0; y < 126; y += 2) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (full[i] < 250 || full[i + 1] < 250 || full[i + 2] < 250) topNonWhite++;
    }
    // 2. Bottom bar (rows 930..1055) pure white
    let botNonWhite = 0;
    for (let y = 930; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (full[i] < 250 || full[i + 1] < 250 || full[i + 2] < 250) botNonWhite++;
    }
    // 3. First non-white row (image start) should be ~128
    let imgStart = -1;
    for (let y = 0; y < 400 && imgStart < 0; y++) {
      for (let x = 0; x < c.width; x += 4) {
        const i = (y * c.width + x) * 4;
        if (full[i] < 240 || full[i + 1] < 240 || full[i + 2] < 240) { imgStart = y; break; }
      }
    }
    // 4. Caption in top bar: dark stroke pixels within rows 0..127
    let topDark = 0;
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (full[i] < 60 && full[i + 1] < 60 && full[i + 2] < 60) topDark++;
    }
    push('topBar.nonWhite', topNonWhite + ' (expect 0)');
    push('bottomBar.nonWhite', botNonWhite + ' (expect 0)');
    push('imageStartsAtRow', imgStart + ' (expect ~128)');
    push('topBar.darkStrokePx', topDark + ' (>0 means caption text sits in the bar)');
    return steps.join('\n');
  } catch (err) {
    return 'ERROR: ' + (err && err.message);
  }
})()
