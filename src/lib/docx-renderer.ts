'use client'

/**
 * Main-thread DOCX → page images renderer.
 *
 * Uses docx-preview (not mammoth) for high-fidelity rendering that preserves
 * the exact look of the Word file — fonts, colors, spacing, tables, images,
 * page breaks, headers/footers.
 *
 * Steps:
 * 1. Load docx-preview + html2canvas
 * 2. Render DOCX in a hidden iframe (isolated from app CSS)
 * 3. Capture with html2canvas
 * 4. Split into A4-page-sized images
 * 5. Return page images for the worker to wrap in a PDF
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
  // docx-preview requires JSZip — load it first
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
 * Render a DOCX file to page images using docx-preview.
 * docx-preview renders the DOCX XML directly (not via mammoth's simplified HTML),
 * preserving the exact visual appearance of the Word document.
 */
export async function renderDocxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading document engine…')
  const docxPreview = await loadDocxPreview()
  const html2canvas = await loadHtml2Canvas()

  onProgress?.(0.3, 'Rendering Word document…')

  // A4 dimensions in pixels at 96dpi (1pt = 1.333px)
  const PAGE_WIDTH = 794   // 595pt * 1.333
  const PAGE_HEIGHT = 1123 // 842pt * 1.333

  // Create an isolated iframe so html2canvas doesn't inherit the app's
  // oklch/lab CSS colors (which it can't parse)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT * 2}px;border:none;`
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow!.document

  // Set up the iframe with a white background and A4-width container
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
    // Render the DOCX using docx-preview — this parses the DOCX XML and
    // produces HTML that closely matches the original Word formatting
    const arrayBuffer = await file.arrayBuffer()
    await docxPreview.renderAsync(arrayBuffer, container, null, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      experimental: true,
      useBase64URL: true,
    })

    onProgress?.(0.5, 'Capturing document layout…')
    // Wait for images/fonts to load
    await new Promise((r) => setTimeout(r, 500))

    const iframeWin = iframe.contentWindow as any
    const iframeHtml2Canvas = iframeWin.html2canvas || html2canvas

    // docx-preview with breakPages:true creates individual page wrapper divs.
    // Capture each page div separately to avoid cutting text at boundaries.
    const pageDivs = container.querySelectorAll('.docx-page-wrapper, .docx-page')
    const pages: RenderedPage[] = []

    if (pageDivs.length > 0) {
      // Capture each page div individually
      for (let i = 0; i < pageDivs.length; i++) {
        const pageDiv = pageDivs[i] as HTMLElement
        const pageCanvas = await iframeHtml2Canvas(pageDiv, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          width: pageDiv.offsetWidth || PAGE_WIDTH,
          height: pageDiv.offsetHeight || PAGE_HEIGHT,
          windowWidth: PAGE_WIDTH,
        })
        pages.push({
          dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
          width: pageDiv.offsetWidth || PAGE_WIDTH,
          height: pageDiv.offsetHeight || PAGE_HEIGHT,
        })
        onProgress?.(0.5 + (0.5 * (i + 1) / pageDivs.length), 'Capturing page ' + (i + 1) + ' of ' + pageDivs.length)
      }
    } else {
      // Fallback: capture the whole container and split into A4 pages
      const contentHeight = container.scrollHeight
      const canvas = await iframeHtml2Canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: PAGE_WIDTH,
        height: contentHeight,
        windowWidth: PAGE_WIDTH,
      })

      onProgress?.(0.7, 'Splitting into pages…')
      const contentWidth = canvas.width
      const pageHeightInCanvas = Math.round(PAGE_HEIGHT * 2)
      const totalPages = Math.ceil(canvas.height / pageHeightInCanvas)

      for (let i = 0; i < totalPages; i++) {
        const srcY = i * pageHeightInCanvas
        const srcH = Math.min(pageHeightInCanvas, canvas.height - srcY)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = contentWidth
        pageCanvas.height = pageHeightInCanvas
        const ctx = pageCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        ctx.drawImage(canvas, 0, srcY, contentWidth, srcH, 0, 0, contentWidth, srcH)
        pages.push({
          dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
        })
      }
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
  // Simple heuristic: if the file is very small and has no text content
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
