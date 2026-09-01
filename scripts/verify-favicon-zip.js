(async () => {
  const caps = (window.__cap || []).filter(function (c) { return c.ab; });
  const report = { captured: caps.length, zips: [] };
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function zipEntries(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const entries = [];
    let i = 0;
    while (i < u8.length - 4) {
      if (dv.getUint32(i, true) === 0x04034b50) {
        const method = dv.getUint16(i + 8, true);
        const compSize = dv.getUint32(i + 18, true);
        const uncompSize = dv.getUint32(i + 22, true);
        const nameLen = dv.getUint16(i + 26, true);
        const extraLen = dv.getUint16(i + 28, true);
        const name = new TextDecoder().decode(u8.slice(i + 30, i + 30 + nameLen));
        const start = i + 30 + nameLen + extraLen;
        entries.push({ name: name, method: method, compSize: compSize, uncompSize: uncompSize, start: start });
        i = start + compSize;
      } else { i++; }
    }
    return entries;
  }
  function parseIco(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const type = dv.getUint16(2, true);
    const count = dv.getUint16(4, true);
    const out = { type: type, count: count, entries: [] };
    for (let j = 0; j < count; j++) {
      const b = 6 + j * 16;
      const w = dv.getUint8(b), h = dv.getUint8(b + 1);
      const planes = dv.getUint16(b + 4, true);
      const bpp = dv.getUint16(b + 6, true);
      const size = dv.getUint32(b + 8, true);
      const off = dv.getUint32(b + 12, true);
      const payload = u8.slice(off, off + size);
      const isPng = payload[0] === 0x89 && payload[1] === 0x50 && payload[2] === 0x4e && payload[3] === 0x47;
      let dibW = null, dibH = null;
      if (!isPng && payload.length >= 12) {
        const pdv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        dibW = pdv.getInt32(4, true); dibH = pdv.getInt32(8, true) / 2;
      }
      out.entries.push({
        dim: (w === 0 ? 256 : w) + 'x' + (h === 0 ? 256 : h),
        planes: planes, bpp: bpp, size: size,
        png: isPng, dibW: dibW, dibH: dibH,
        inBounds: off + size <= u8.length
      });
    }
    return out;
  }
  function pngDims(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sig = u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
    return { sig: sig, w: dv.getUint32(16, true), h: dv.getUint32(20, true) };
  }
  for (const c of caps) {
    const u8 = new Uint8Array(c.ab);
    const entries = zipEntries(u8);
    const info = { type: c.type || '(none)', size: c.size, fileCount: entries.length, names: entries.map(function (e) { return e.name + ' (' + e.uncompSize + 'B)'; }) };
    const icoE = entries.find(function (e) { return e.name.endsWith('.ico'); });
    if (icoE) {
      const icoBytes = icoE.method === 8 ? await inflateRaw(u8.slice(icoE.start, icoE.start + icoE.compSize)) : u8.slice(icoE.start, icoE.start + icoE.compSize);
      info.ico = parseIco(icoBytes);
    }
    const pngE = entries.find(function (e) { return /-32x32\.png$/.test(e.name); });
    if (pngE) {
      const pngBytes = pngE.method === 8 ? await inflateRaw(u8.slice(pngE.start, pngE.start + pngE.compSize)) : u8.slice(pngE.start, pngE.start + pngE.compSize);
      info.png32 = pngDims(pngBytes);
    }
    report.zips.push(info);
  }
  return JSON.stringify(report);
})()