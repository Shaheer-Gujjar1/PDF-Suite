/**
 * Byte-level unit test for the ICO encoder helpers embedded in
 * src/lib/processing/worker-source.ts (WORKER_SOURCE template string).
 *
 * Extracts encodeIcoBmp + buildIcoFile from the worker source by evaluating
 * it in a sandbox (with a fake `self`), then validates:
 *   1. ICONDIR structure (reserved=0, type=1, count)
 *   2. ICONDIRENTRY fields (sizes, 256 -> 0, offsets, lengths, planes/bpp)
 *   3. BMP DIB header (biHeight doubled, 32bpp) + BGRA bottom-up pixels
 *   4. AND-mask bits for fully transparent pixels
 *   5. A full fake-PNG entry pass-through
 */
import { WORKER_SOURCE } from '../src/lib/processing/worker-source'

const sandbox = new Function(
  'self',
  '__IMPORT_URLS_PLACEHOLDER__',
  '"use strict";' +
    WORKER_SOURCE +
    '; return { encodeIcoBmp: encodeIcoBmp, buildIcoFile: buildIcoFile };'
)

const { encodeIcoBmp, buildIcoFile } = sandbox(
  { onmessage: () => {}, postMessage: () => {} },
  {}
)

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/* ---- Test 1: encodeIcoBmp on a 3x2 image with known pixels --------------
 * Row 0 (top):    R=255 opaque, G=255 opaque, B=255 semi(128)
 * Row 1 (bottom): fully transparent, red opaque, fully transparent
 */
const W = 3
const H = 2
const px = new Uint8ClampedArray(W * H * 4)
function put(x: number, y: number, r: number, g: number, b: number, a: number) {
  const i = (y * W + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}
put(0, 0, 255, 0, 0, 255) // top-left: red opaque
put(1, 0, 0, 255, 0, 255) // top-mid: green opaque
put(2, 0, 0, 0, 255, 128) // top-right: blue semi
put(0, 1, 10, 20, 30, 0) // bottom-left: transparent
put(1, 1, 255, 0, 0, 255) // bottom-mid: red opaque
put(2, 1, 0, 0, 0, 0) // bottom-right: transparent

const dib = encodeIcoBmp({ width: W, height: H, data: px })

// DIB header
const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
check('biSize == 40', dv.getUint32(0, true) === 40)
check('biWidth == 3', dv.getInt32(4, true) === 3)
check('biHeight doubled (4)', dv.getInt32(8, true) === H * 2)
check('biPlanes == 1', dv.getUint16(12, true) === 1)
check('biBitCount == 32', dv.getUint16(14, true) === 32)
check('biCompression == 0 (BI_RGB)', dv.getUint32(16, true) === 0)

const xorRow = W * 4
const andRow = ((W + 31) >> 5) << 2
const xorSize = xorRow * H
const andSize = andRow * H
check('biSizeImage == xor+and', dv.getUint32(20, true) === xorSize + andSize)
check('DIB total size', dib.length === 40 + xorSize + andSize)

// Bottom-up BGRA: first stored row = source bottom row (y=1)
const o = 40
check('bottom row first — x0 BGRA of transparent px (A=0)', dib[o + 3] === 0)
check(
  'bottom row first — x1 BGRA of red (B=0,G=0,R=255,A=255)',
  dib[o + 4] === 0 && dib[o + 5] === 0 && dib[o + 6] === 255 && dib[o + 7] === 255
)
check(
  'top row — x0 BGRA of red (B=0,G=0,R=255,A=255)',
  dib[o + xorRow] === 0 &&
    dib[o + xorRow + 1] === 0 &&
    dib[o + xorRow + 2] === 255 &&
    dib[o + xorRow + 3] === 255
)
check(
  'top row — x2 blue semi kept straight (B=255, A=128)',
  dib[o + xorRow + 8] === 255 && dib[o + xorRow + 11] === 128
)

// AND mask: row 0 of mask = source bottom row → bits set at x0 and x2
const maskOff = 40 + xorSize
const maskRow0 = dib[maskOff] // bit7 = x0, bit6 = x1, bit5 = x2
check('AND mask bottom row: x0 transparent bit set', (maskRow0 & 0x80) !== 0)
check('AND mask bottom row: x1 opaque bit clear', (maskRow0 & 0x40) === 0)
check('AND mask bottom row: x2 transparent bit set', (maskRow0 & 0x20) !== 0)
const maskRow1 = dib[maskOff + andRow]
check('AND mask top row: x0/x1 opaque (0)', (maskRow1 & 0xc0) === 0)
check('AND mask top row: x2 not masked (alpha>0)', (maskRow1 & 0x20) === 0)

/* ---- Test 2: buildIcoFile structure -------------------------------------- */
const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const entries = [
  { size: 16, data: dib },
  { size: 256, data: fakePng },
]
const ico = buildIcoFile(entries)
const iv = new DataView(ico as unknown as ArrayBuffer)
check('reserved == 0', iv.getUint16(0, true) === 0)
check('type == 1 (icon)', iv.getUint16(2, true) === 1)
check('count == 2', iv.getUint16(4, true) === 2)
check('entry0 width byte == 16', iv.getUint8(6) === 16)
check('entry0 height byte == 16', iv.getUint8(7) === 16)
check('entry0 planes == 1', iv.getUint16(6 + 4, true) === 1)
check('entry0 bpp == 32', iv.getUint16(6 + 6, true) === 32)
check('entry0 bytesInRes == dib.length', iv.getUint32(6 + 8, true) === dib.length)
check('entry0 offset == 6+2*16', iv.getUint32(6 + 12, true) === 38)
check('entry1 width byte == 0 (256)', iv.getUint8(6 + 16) === 0)
check('entry1 bytesInRes == png.length', iv.getUint32(6 + 16 + 8, true) === fakePng.length)
check(
  'entry1 offset == 38 + dib.length',
  iv.getUint32(6 + 16 + 12, true) === 38 + dib.length
)
// PNG payload copied verbatim
const pngBytes = new Uint8Array(ico as unknown as ArrayBuffer)
const pngAt = 38 + dib.length
check(
  'PNG entry magic intact',
  pngBytes[pngAt] === 0x89 && pngBytes[pngAt + 1] === 0x50 && pngBytes[pngAt + 2] === 0x4e && pngBytes[pngAt + 3] === 0x47
)
check('ICO total size', ico.byteLength === 38 + dib.length + fakePng.length)

console.log(failures === 0 ? '\nALL ICO ENCODER TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
