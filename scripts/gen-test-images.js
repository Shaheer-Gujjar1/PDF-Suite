/**
 * Generates test images (JPG, PNG, WebP) for browser-testing Crop Images.
 * Uses the project's sharp dependency.
 */
const sharp = require('/home/z/my-project/node_modules/sharp')
const fs = require('fs')
const path = require('path')

const outDir = '/home/z/my-project/.zscripts/test-images'
fs.mkdirSync(outDir, { recursive: true })

function makeSvg(w, h, label, c1, c2) {
  return Buffer.from(`
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.22}" fill="rgba(255,255,255,0.35)"/>
    <rect x="${w * 0.1}" y="${h * 0.6}" width="${w * 0.5}" height="${h * 0.25}" fill="rgba(0,0,0,0.25)" rx="12"/>
    <text x="50%" y="52%" font-size="${Math.round(h / 9)}" font-family="sans-serif" fill="#ffffff" text-anchor="middle" font-weight="bold">${label}</text>
    <text x="50%" y="62%" font-size="${Math.round(h / 18)}" font-family="sans-serif" fill="rgba(255,255,255,0.85)" text-anchor="middle">${w} x ${h}</text>
  </svg>`)
}

async function main() {
  await sharp(makeSvg(1600, 1000, 'TEST JPG', '#f97316', '#b91c1c'))
    .jpeg({ quality: 88 })
    .toFile(path.join(outDir, 'sunset-photo.jpg'))

  await sharp(makeSvg(1200, 800, 'TEST PNG', '#0d9488', '#134e4a'))
    .png()
    .toFile(path.join(outDir, 'ui-mockup.png'))

  await sharp(makeSvg(900, 1200, 'TEST WEBP', '#7c3aed', '#4c1d95'))
    .webp({ quality: 85 })
    .toFile(path.join(outDir, 'portrait-shot.webp'))

  for (const f of fs.readdirSync(outDir)) {
    const st = fs.statSync(path.join(outDir, f))
    console.log(`${f}: ${(st.size / 1024).toFixed(1)} KB`)
  }
  console.log('DONE')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
