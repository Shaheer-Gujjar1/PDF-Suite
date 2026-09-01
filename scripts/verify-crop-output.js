// Verifies the Crop PDF E2E output: cropBox/mediaBox must equal the drawn
// display rect (100,100 200x160) converted to PDF points on the 612x792 page:
// x=100, y=792-(100+160)=532, w=200, h=160 — on BOTH pages.
const { PDFDocument } = require('pdf-lib')
const fs = require('fs')

async function main() {
  const doc = await PDFDocument.load(fs.readFileSync('/home/z/my-project/upload/test-crop-output.pdf'))
  const want = { x: 100, y: 532, width: 200, height: 160 }
  let pass = true
  doc.getPages().forEach((p, i) => {
    const { x, y, width, height } = p.getCropBox()
    const { x: mx, y: my, width: mw, height: mh } = p.getMediaBox()
    const okCrop = ['x', 'y', 'width', 'height'].every((k) => Math.abs(({ x, y, width, height })[k] - want[k]) < 0.01)
    const okMedia = ['x', 'y', 'width', 'height'].every((k) => Math.abs(({ x: mx, y: my, width: mw, height: mh })[k] - want[k]) < 0.01)
    if (!okCrop || !okMedia) pass = false
    console.log(`page ${i + 1}: cropBox=(${x}, ${y}, ${width}, ${height}) mediaBox=(${mx}, ${my}, ${mw}, ${mh}) -> ${okCrop && okMedia ? 'PASS' : 'FAIL want ' + JSON.stringify(want)}`)
  })
  console.log(pass ? 'E2E CROP VERIFIED: cropBox == drawn rect in PDF points on all pages' : 'E2E MISMATCH')
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
