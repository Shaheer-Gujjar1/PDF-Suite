'use client'

/**
 * Main-thread DOCX → page images renderer.
 *
 * Steps:
 * 1. Load mammoth (DOCX → HTML)
 * 2. Render HTML in a hidden div with Word-like CSS
 * 3. Use html2canvas to capture the rendered content
 * 4. Split the canvas into A4-page-sized images
 * 5. Return the page images (as ArrayBuffer for the worker)
 */

const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'

let mammothPromise: Promise<any> | null = null
let html2canvasPromise: Promise<any> | null = null

function loadMammoth(): Promise<any> {
  if (mammothPromise) return mammothPromise
  if ((window as any).mammoth) return Promise.resolve((window as any).mammoth)
  mammothPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = MAMMOTH_URL
    script.onload = () => {
      if ((window as any).mammoth) resolve((window as any).mammoth)
      else reject(new Error('mammoth failed to load'))
    }
    script.onerror = () => reject(new Error('Failed to load mammoth'))
    document.head.appendChild(script)
  })
  return mammothPromise
}

function loadHtml2Canvas(): Promise<any> {
  if (html2canvasPromise) return html2canvasPromise
  if ((window as any).html2canvas) return Promise.resolve((window as any).html2canvas)
  html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = HTML2CANVAS_URL
    script.onload = () => {
      if ((window as any).html2canvas) resolve((window as any).html2canvas)
      else reject(new Error('html2canvas failed to load'))
    }
    script.onerror = () => reject(new Error('Failed to load html2canvas'))
    document.head.appendChild(script)
  })
  return html2canvasPromise
}

/** Word-like CSS for rendering the document preview */
const WORD_CSS = `
  body {
    font-family: 'Calibri', 'Arial', sans-serif;
    font-size: 11pt;
    line-height: 1.15;
    color: #000;
    margin: 0;
    padding: 0;
  }
  h1 { font-size: 16pt; font-weight: bold; margin: 12pt 0 6pt 0; color: #2F5496; }
  h2 { font-size: 13pt; font-weight: bold; margin: 10pt 0 4pt 0; color: #2F5496; }
  h3 { font-size: 12pt; font-weight: bold; margin: 8pt 0 4pt 0; color: #1F3864; }
  h4, h5, h6 { font-weight: bold; margin: 6pt 0 3pt 0; }
  p { margin: 0 0 8pt 0; }
  strong, b { font-weight: bold; }
  em, i { font-style: italic; }
  u { text-decoration: underline; }
  ul { list-style-type: disc; padding-left: 36pt; margin: 0 0 8pt 0; }
  ol { list-style-type: decimal; padding-left: 36pt; margin: 0 0 8pt 0; }
  li { margin: 0 0 4pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  td, th { border: 1px solid #000; padding: 4pt 6pt; font-size: 10pt; }
  th { font-weight: bold; background: #f0f0f0; }
  img { max-width: 100%; height: auto; margin: 4pt 0; }
  a { color: #0563C1; text-decoration: underline; }
  blockquote { border-left: 3px solid #ccc; padding-left: 12pt; margin: 8pt 0; color: #555; }
  hr { border: none; border-top: 1px solid #ccc; margin: 8pt 0; }
`

export interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

export interface RenderProgress {
  (progress: number, message: string): void
}

/**
 * Render a DOCX file to page images.
 * Returns an array of A4-proportioned page images.
 */
export async function renderDocxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading document engine…')
  const mammoth = await loadMammoth()

  onProgress?.(0.2, 'Converting Word document…')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const html = result.value

  onProgress?.(0.4, 'Rendering document…')
  const html2canvas = await loadHtml2Canvas()

  // A4 dimensions at 2x for quality (in pixels: 1pt ≈ 1.333px at 96dpi)
  const PAGE_WIDTH = 794  // 595pt * 1.333
  const PAGE_HEIGHT = 1123 // 842pt * 1.333
  const MARGIN = 64        // ~48pt margin

  // Create a hidden container with the document content
  // Use an iframe so html2canvas doesn't inherit the app's CSS (which uses
  // oklch/lab colors that html2canvas 1.4 can't parse)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + PAGE_WIDTH + 'px;height:' + PAGE_HEIGHT + 'px;border:none;'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow!.document
  iframeDoc.open()
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${WORD_CSS}
    body { background: white; }
  </style></head><body>${html}</body></html>`)
  iframeDoc.close()

  const container = iframeDoc.body

  try {
    onProgress?.(0.5, 'Capturing document layout…')
    // Wait a moment for images to load
    await new Promise((r) => setTimeout(r, 300))

    // Inject html2canvas into the iframe and call it from there so it
    // clones the iframe's document (which only has our Word-like CSS,
    // not the main app's oklch/lab colors that html2canvas can't parse)
    const iframeWin = iframe.contentWindow as any
    const iframeHtml2Canvas = iframeWin.html2canvas || html2canvas
    const canvas = await iframeHtml2Canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: PAGE_WIDTH,
      height: container.scrollHeight,
      windowWidth: PAGE_WIDTH,
    })

    onProgress?.(0.7, 'Splitting into pages…')

    // Split the tall canvas into A4-page-sized sections
    const pages: RenderedPage[] = []
    const contentWidth = canvas.width
    const pageHeightInCanvas = Math.round(PAGE_HEIGHT * 2) // 2x scale
    const totalPages = Math.ceil(canvas.height / pageHeightInCanvas)

    for (let i = 0; i < totalPages; i++) {
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = contentWidth
      pageCanvas.height = Math.min(pageHeightInCanvas, canvas.height - i * pageHeightInCanvas)

      // If the last page is shorter, pad it with white
      if (pageCanvas.height < pageHeightInCanvas) {
        pageCanvas.height = pageHeightInCanvas
      }

      const ctx = pageCanvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(
        canvas,
        0, i * pageHeightInCanvas, contentWidth, Math.min(pageHeightInCanvas, canvas.height - i * pageHeightInCanvas),
        0, 0, contentWidth, Math.min(pageHeightInCanvas, canvas.height - i * pageHeightInCanvas)
      )

      pages.push({
        dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      })
    }

    onProgress?.(1, 'Done')
    return pages
  } finally {
    document.body.removeChild(iframe)
  }
}

/**
 * Check if a DOCX file contains only images (no significant text).
 */
export async function isDocxImagesOnly(file: File): Promise<boolean> {
  const mammoth = await loadMammoth()
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  const text = result.value.trim()
  // If less than 20 chars of text, consider it images-only
  return text.length < 20
}
