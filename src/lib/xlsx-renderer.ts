'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Uses SheetJS to parse the spreadsheet, renders it as a styled HTML table
 * in a hidden div (all inline styles — no oklch), captures with html2canvas,
 * and splits into A4 pages at safe break points.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'

let xlsxPromise: Promise<any> | null = null
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

function loadXLSX(): Promise<any> {
  if (xlsxPromise) return xlsxPromise
  xlsxPromise = loadScript(XLSX_URL, () => !!(window as any).XLSX).then(() => (window as any).XLSX)
  return xlsxPromise
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

/** Convert ARGB hex to CSS rgb */
function argbToRgb(hex: string): string {
  if (!hex || hex === '00000000' || hex === 'FFFFFFFF') return ''
  const h = hex.replace(/^FF/, '')
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgb(${r},${g},${b})`
  }
  return ''
}

/** Convert column number to letter (0 → A, 1 → B, etc.) */
function colToLetter(col: number): string {
  let result = ''
  col++
  while (col > 0) {
    const rem = (col - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    col = Math.floor((col - 1) / 26)
  }
  return result
}

/** Build HTML table from a worksheet with styling */
function sheetToHtml(ws: any, XLSX: any): string {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  // Build merge lookup
  const mergeMap: Record<string, { rowspan: number; colspan: number; hidden: boolean }> = {}
  for (const m of merges) {
    mergeMap[`${m.s.r},${m.s.c}`] = {
      rowspan: m.e.r - m.s.r + 1,
      colspan: m.e.c - m.s.c + 1,
      hidden: false,
    }
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) {
          mergeMap[`${r},${c}`] = { rowspan: 0, colspan: 0, hidden: true }
        }
      }
    }
  }

  let html = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px;width:100%;">\n'

  // Column widths
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]
    const width = col && col.wpx ? col.wpx : 80
    html += `<col style="width:${width}px;">`
  }

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]
    const rowHeight = row && row.hpt ? row.hpt : 20
    html += `<tr style="height:${rowHeight}pt;">`

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${r},${c}`]

      if (merge && merge.hidden) continue

      const rowspan = merge ? merge.rowspan : 1
      const colspan = merge ? merge.colspan : 1
      const attrs: string[] = []
      if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`)
      if (colspan > 1) attrs.push(`colspan="${colspan}"`)

      // Cell styling — all inline, no oklch/lab
      const styles: string[] = [
        'border:1px solid #b0b0b0',
        'padding:4px 6px',
        'vertical-align:middle',
        'background:#ffffff',
        'color:#000000',
      ]
      let content = '&nbsp;'

      if (cell) {
        // Font style (cell.s may be undefined in community edition — use defaults)
        const font = cell.s?.font || {}
        if (font.bold) styles.push('font-weight:bold')
        if (font.italic) styles.push('font-style:italic')
        if (font.underline) styles.push('text-decoration:underline')
        if (font.sz) styles.push(`font-size:${font.sz}pt`)
        if (font.color?.rgb) {
          const c = argbToRgb(font.color.rgb)
          if (c) styles.push(`color:${c}`)
        }

        // Fill
        const fill = cell.s?.fill
        if (fill?.fgColor?.rgb && fill.fgColor.rgb !== '00000000') {
          const bg = argbToRgb(fill.fgColor.rgb)
          if (bg) styles.push(`background:${bg}`)
        }

        // Alignment
        const align = cell.s?.alignment || {}
        if (align.horizontal) styles.push(`text-align:${align.horizontal}`)
        if (align.wrapText) styles.push('white-space:normal')

        // Border
        const border = cell.s?.border || {}
        if (border.top?.style || border.bottom?.style || border.left?.style || border.right?.style) {
          const idx = styles.findIndex(s => s.startsWith('border:'))
          if (idx >= 0) styles.splice(idx, 1)
          for (const [side, key] of [['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right']] as [string, string][]) {
            const b = border[key]
            if (b && b.style) {
              const bw = b.style === 'thin' ? '1px' : '2px'
              const bc = b.color?.rgb ? argbToRgb(b.color.rgb) || '#000000' : '#000000'
              styles.push(`border-${side}:${bw} solid ${bc}`)
            } else {
              styles.push(`border-${side}:1px solid #b0b0b0`)
            }
          }
        }

        // Content — use cell.w (formatted) if available, else cell.v
        if (cell.w !== undefined && cell.w !== null) {
          content = String(cell.w)
        } else if (cell.v !== undefined && cell.v !== null) {
          content = String(cell.v)
        }
        // Escape HTML
        content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (!content) content = '&nbsp;'
      }

      html += `<td${attrs.length ? ' ' + attrs.join(' ') : ''} style="${styles.join(';')}">${content}</td>`
    }
    html += '</tr>\n'
  }
  html += '</table>'
  return html
}

function findSafeBreakPoint(
  ctx: CanvasRenderingContext2D,
  startY: number,
  targetY: number,
  maxSearch: number,
  canvasWidth: number
): number {
  const sampleStep = 2
  for (let offset = 0; offset <= maxSearch; offset++) {
    for (const y of [targetY + offset, targetY - offset]) {
      if (y < startY || y >= ctx.canvas.height) continue
      let isWhite = true
      const rowData = ctx.getImageData(0, y, canvasWidth, 1).data
      for (let x = 0; x < canvasWidth; x += sampleStep) {
        if (rowData[x * 4] < 250 || rowData[x * 4 + 1] < 250 || rowData[x * 4 + 2] < 250) {
          isWhite = false
          break
        }
      }
      if (isWhite) return y
    }
  }
  return targetY
}

export async function renderXlsxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading spreadsheet engine…')
  const XLSX = await loadXLSX()
  const html2canvas = await loadHtml2Canvas()

  onProgress?.(0.2, 'Parsing spreadsheet…')
  const arrayBuffer = await file.arrayBuffer()
  // cellStyles: true to read style info (works with xlsx.full.min.js)
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellDates: true, cellNF: true })

  // Build HTML for all sheets
  let sheetsHtml = ''
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const sheetName = wb.SheetNames[i]
    const ws = wb.Sheets[sheetName]
    if (!ws['!ref']) continue
    sheetsHtml += `<div style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;margin:16px 0 8px 0;color:#2F5496;padding:4px 0;border-bottom:2px solid #2F5496;">${sheetName}</div>\n`
    sheetsHtml += sheetToHtml(ws, XLSX)
    sheetsHtml += '<div style="height:24px;"></div>\n'
  }

  if (!sheetsHtml) {
    throw new Error('No sheets found in the spreadsheet')
  }

  // A4 dimensions
  const PAGE_WIDTH = 794
  const PAGE_HEIGHT = 1123
  const SCALE = 2
  const PAGE_HEIGHT_SCALED = PAGE_HEIGHT * SCALE

  // Use an isolated iframe to avoid the app's oklch/lab CSS colors that
  // html2canvas can't parse. The iframe only contains our inline-styled table.
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT * 2}px;border:none;`
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow!.document

  iframeDoc.open()
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #fff; padding: 40px; }
    </style>
  </head><body><div id="xlsx-content">${sheetsHtml}</div></body></html>`)
  iframeDoc.close()

  const inner = iframeDoc.getElementById('xlsx-content')!

  try {
    onProgress?.(0.5, 'Capturing spreadsheet…')
    // Wait for layout and fonts
    await new Promise((r) => setTimeout(r, 300))

    const contentHeight = inner.scrollHeight

    // Call html2canvas from the iframe's window so it clones the iframe's
    // document (which has no oklch colors), not the main app's document
    const iframeWin = iframe.contentWindow as any
    const iframeHtml2Canvas = iframeWin.html2canvas || html2canvas
    const canvas = await iframeHtml2Canvas(inner, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: PAGE_WIDTH - 80,
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

      if (idealBreak >= totalHeight) {
        const remainingHeight = totalHeight - currentY
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvasWidth
        pageCanvas.height = Math.max(1, remainingHeight)
        const pageCtx = pageCanvas.getContext('2d')!
        pageCtx.fillStyle = '#ffffff'
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        pageCtx.drawImage(canvas, 0, currentY, canvasWidth, remainingHeight, 0, 0, canvasWidth, remainingHeight)
        pages.push({ dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92), width: PAGE_WIDTH - 80, height: remainingHeight / SCALE })
        break
      }

      const searchRange = 100
      const safeY = findSafeBreakPoint(ctx, currentY, idealBreak, searchRange, canvasWidth)
      const pageHeight = safeY - currentY
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvasWidth
      pageCanvas.height = pageHeight
      const pageCtx = pageCanvas.getContext('2d')!
      pageCtx.fillStyle = '#ffffff'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageCtx.drawImage(canvas, 0, currentY, canvasWidth, pageHeight, 0, 0, canvasWidth, pageHeight)
      pages.push({ dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92), width: PAGE_WIDTH - 80, height: pageHeight / SCALE })

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
