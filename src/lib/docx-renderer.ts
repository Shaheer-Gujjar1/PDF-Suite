'use client'

/**
 * Main-thread DOCX → page images renderer.
 *
 * Uses docx-preview for high-fidelity rendering, then splits the captured
 * canvas at "safe" break points (whitespace gaps between content) instead
 * of fixed A4 heights — so text never gets cut mid-line.
 */

const DOCX_PREVIEW_URL = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.2/dist/docx-preview.min.js'
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'

let docxPreviewPromise: Promise<any> | null = null
let html2canvasPromise: Promise<any> | null = null

function loadScript(url: string, check: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) { resolve(); return }
    const script = document.createElement('script')
    script.src = url
    script.onload = () => {
      if (check()) resolve()
      else reject(new Error('Script loaded but global not found: ' + url))
    }
    script.onerror = () => reject(new Error('Failed to load: ' + url))
    document.head.appendChild(script)
  })
}

function loadDocxPreview(): Promise<any> {
  if (docxPreviewPromise) return docxPreviewPromise
  docxPreviewPromise = loadScript(JSZIP_URL, () => !!(window as any).JSZip)
    .then(() => loadScript(DOCX_PREVIEW_URL, () => !!(window as any).docx))
    .then(() => (window as any).docx)
  return docxPreviewPromise
}

function loadHtml2Canvas(): Promise<any> {
  if (html2canvasPromise) return html2canvasPromise
  html2canvasPromise = loadScript(HTML2CANVAS_URL, () => !!(window as any).html2canvas).then(() => (window as any).html2canvas)
  return html2canvasPromise
}

export interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

export interface RenderProgress {
  (progress: number, message: string): void
}

/**
 * Scan a canvas column-by-column to find "safe" break points — horizontal
 * rows that are entirely white (no text). These are gaps between paragraphs
 * where we can split without cutting text.
 *
 * @param ctx Canvas 2D context
 * @param startY Start Y position to scan from
 * @param targetY Ideal break point (A4 page boundary)
 * @param maxSearch How far up/down to search from targetY (pixels)
 * @returns The Y coordinate of the nearest white row, or targetY if none found
 */
function findSafeBreakPoint(
  ctx: CanvasRenderingContext2D,
  startY: number,
  targetY: number,
  maxSearch: number,
  canvasWidth: number
): number {
  // Scan rows around targetY to find a fully-white row
  // Sample every 2nd pixel for performance
  const sampleStep = 2
  const sampleWidth = Math.floor(canvasWidth / sampleStep)

  for (let offset = 0; offset <= maxSearch; offset++) {
    // Try below targetY first (slightly more content on this page)
    for (const y of [targetY + offset, targetY - offset]) {
      if (y < startY || y >= ctx.canvas.height) continue
      let isWhite = true
      const rowData = ctx.getImageData(0, y, canvasWidth, 1).data
      for (let x = 0; x < canvasWidth; x += sampleStep) {
        // Check if pixel is non-white (any channel < 250)
        if (rowData[x * 4] < 250 || rowData[x * 4 + 1] < 250 || rowData[x * 4 + 2] < 250) {
          isWhite = false
          break
        }
      }
      if (isWhite) return y
    }
  }
  return targetY // Fallback: use the exact A4 boundary
}

export async function renderDocxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading document engine…')
  const docxPreview = await loadDocxPreview()
  const html2canvas = await loadHtml2Canvas()

  onProgress?.(0.3, 'Rendering Word document…')

  // A4 dimensions in pixels at 96dpi
  const PAGE_WIDTH = 794   // 595pt * 1.333
  const PAGE_HEIGHT = 1123 // 842pt * 1.333
  const SCALE = 2 // 2x for quality
  const PAGE_HEIGHT_SCALED = PAGE_HEIGHT * SCALE

  // Create an isolated iframe
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT * 2}px;border:none;`
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow!.document

  iframeDoc.open()
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #fff; }
      #docx-container { width: ${PAGE_WIDTH}px; background: #fff; }
    </style>
  </head><body><div id="docx-container"></div></body></html>`)
  iframeDoc.close()

  const container = iframeDoc.getElementById('docx-container')!

  try {
    // Render with breakPages: false — one continuous flow, we handle pagination
    const arrayBuffer = await file.arrayBuffer()
    await docxPreview.renderAsync(arrayBuffer, container, null, {
      className: 'docx',
      inWrapper: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: false,
      experimental: false,
      useBase64URL: true,
    })

    onProgress?.(0.5, 'Capturing document…')
    await new Promise((r) => setTimeout(r, 500))

    const iframeWin = iframe.contentWindow as any
    const iframeHtml2Canvas = iframeWin.html2canvas || html2canvas

    // Capture the full document as one tall canvas
    const contentHeight = container.scrollHeight
    const canvas = await iframeHtml2Canvas(container, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: PAGE_WIDTH,
      height: contentHeight,
      windowWidth: PAGE_WIDTH,
    })

    onProgress?.(0.7, 'Splitting into pages…')

    const ctx = canvas.getContext('2d')!
    const canvasWidth = canvas.width
    const totalHeight = canvas.height
    const pages: RenderedPage[] = []

    let currentY = 0
    let pageNum = 0

    while (currentY < totalHeight) {
      const idealBreak = currentY + PAGE_HEIGHT_SCALED

      // If the remaining content is shorter than a full page, just take it all
      if (idealBreak >= totalHeight) {
        const remainingHeight = totalHeight - currentY
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvasWidth
        pageCanvas.height = remainingHeight
        const pageCtx = pageCanvas.getContext('2d')!
        pageCtx.fillStyle = '#ffffff'
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        pageCtx.drawImage(canvas, 0, currentY, canvasWidth, remainingHeight, 0, 0, canvasWidth, remainingHeight)

        pages.push({
          dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
          width: PAGE_WIDTH,
          height: remainingHeight / SCALE,
        })
        break
      }

      // Search for a safe break point near the ideal A4 boundary
      // Search ±100px (scaled) for a white row
      const searchRange = 100 // pixels in scaled canvas
      const safeY = findSafeBreakPoint(ctx, currentY, idealBreak, searchRange, canvasWidth)

      const pageHeight = safeY - currentY
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvasWidth
      pageCanvas.height = pageHeight
      const pageCtx = pageCanvas.getContext('2d')!
      pageCtx.fillStyle = '#ffffff'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageCtx.drawImage(canvas, 0, currentY, canvasWidth, pageHeight, 0, 0, canvasWidth, pageHeight)

      pages.push({
        dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
        width: PAGE_WIDTH,
        height: pageHeight / SCALE,
      })

      currentY = safeY
      pageNum++
      onProgress?.(0.7 + (0.3 * pageNum / Math.ceil(totalHeight / PAGE_HEIGHT_SCALED)), 'Page ' + (pageNum + 1))
    }

    onProgress?.(1, 'Done')
    return pages
  } finally {
    document.body.removeChild(iframe)
  }
}

export async function isDocxImagesOnly(file: File): Promise<boolean> {
  try {
    const mammothUrl = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
    await loadScript(mammothUrl, () => !!(window as any).mammoth)
    const mammoth = (window as any).mammoth
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value.trim().length < 20
  } catch {
    return false
  }
}
