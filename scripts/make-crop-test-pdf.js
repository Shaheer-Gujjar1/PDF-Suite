// Generates upload/test-crop.pdf — 2-page US Letter PDF with distinct page
// numbers drawn large, for Crop PDF E2E verification.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const fs = require('fs')

async function main() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage([612, 792]) // US Letter in points
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.95, 0.95, 0.97) })
    page.drawText('PAGE ' + i, {
      x: 200, y: 380, size: 72, font, color: rgb(0.2, 0.2, 0.6),
    })
    page.drawText('Crop PDF test document', { x: 200, y: 320, size: 18, font, color: rgb(0.3, 0.3, 0.3) })
  }
  const bytes = await doc.save()
  fs.writeFileSync('/home/z/my-project/upload/test-crop.pdf', bytes)
  console.log('written', bytes.length, 'bytes')
}
main().catch((e) => { console.error(e); process.exit(1) })
