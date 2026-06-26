'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Parses the spreadsheet with SheetJS, draws it DIRECTLY to canvas using
 * the Canvas 2D API. No html2canvas, no iframes. Renders each sheet to
 * its own canvas, then splits into A4 pages.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'

let xlsxPromise: Promise<any> | null = null

function loadScript(url: string, check: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) { resolve(); return }
    const script = document.createElement('script')
    script.src = url
    script.onload = () => { if (check()) resolve(); else reject(new Error('Global not found: ' + url)) }
    script.onerror = () => reject(new Error('Failed to load: ' + url))
    document.head.appendChild(script)
  })
}

function loadXLSX(): Promise<any> {
  if (xlsxPromise) return xlsxPromise
  xlsxPromise = loadScript(XLSX_URL, () => !!(window as any).XLSX).then(() => (window as any).XLSX)
  return xlsxPromise
}

export interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

export interface RenderProgress {
  (progress: number, message: string): void
}

function argbToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || hex === '00000000' || hex === 'FFFFFFFF') return null
  const h = hex.replace(/^FF/, '')
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
  return null
}

interface CellData {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize: number
  fontColor: string
  bgColor: string
  align: string
  borders: { top?: string; bottom?: string; left?: string; right?: string }
  rowspan: number
  colspan: number
  hidden: boolean
}

/**
 * Render a single worksheet to a canvas.
 * Returns the canvas and its dimensions.
 */
function renderSheetToCanvas(ws: any, XLSX: any, sheetName: string): HTMLCanvasElement {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  // Merge lookup
  const mergeMap: Record<string, { rowspan: number; colspan: number; hidden: boolean }> = {}
  for (const m of merges) {
    mergeMap[`${m.s.r},${m.s.c}`] = { rowspan: m.e.r - m.s.r + 1, colspan: m.e.c - m.s.c + 1, hidden: false }
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (r !== m.s.r || c !== m.s.c) mergeMap[`${r},${c}`] = { rowspan: 0, colspan: 0, hidden: true }
  }

  // Layout calculations (in CSS pixels, no scaling)
  const MARGIN = 40
  const TITLE_H = 30
  const DEFAULT_COL_W = 90
  const DEFAULT_ROW_H = 22
  const SCALE = 2

  const colWidths: number[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]
    colWidths.push(col && col.wpx ? col.wpx : DEFAULT_COL_W)
  }
  const rowHeights: number[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]
    rowHeights.push(row && row.hpt ? Math.round(row.hpt * 1.333) : DEFAULT_ROW_H)
  }

  const tableWidth = colWidths.reduce((a, b) => a + b, 0)
  const tableHeight = rowHeights.reduce((a, b) => a + b, 0)
  const contentWidth = tableWidth + MARGIN * 2
  const contentHeight = tableHeight + TITLE_H + MARGIN * 2

  // Create canvas at 2x scale for quality
  const canvas = document.createElement('canvas')
  canvas.width = contentWidth * SCALE
  canvas.height = contentHeight * SCALE
  const ctx = canvas.getContext('2d')!

  // Scale all drawing
  ctx.scale(SCALE, SCALE)

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, contentWidth, contentHeight)

  // Sheet title
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillStyle = '#2F5496'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(sheetName, MARGIN, MARGIN)
  ctx.strokeStyle = '#2F5496'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN, MARGIN + TITLE_H - 5)
  ctx.lineTo(MARGIN + tableWidth, MARGIN + TITLE_H - 5)
  ctx.stroke()

  // Column X positions
  const colX: number[] = [MARGIN]
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i])
  // Row Y positions
  const rowY: number[] = [MARGIN + TITLE_H]
  for (let i = 0; i < rowHeights.length; i++) rowY.push(rowY[i] + rowHeights[i])

  // Draw cells
  for (let r = 0; r <= range.e.r - range.s.r; r++) {
    for (let c = 0; c <= range.e.c - range.s.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${range.s.r + r},${range.s.c + c}`]

      if (merge && merge.hidden) continue

      const rowspan = merge ? merge.rowspan : 1
      const colspan = merge ? merge.colspan : 1
      const x = colX[c]
      const y = rowY[r]
      const w = colWidths.slice(c, c + colspan).reduce((a, b) => a + b, 0)
      const h = rowHeights.slice(r, r + rowspan).reduce((a, b) => a + b, 0)

      // Cell styling
      let bgColor = '#ffffff'
      let fontColor = '#000000'
      let bold = false
      let italic = false
      let fontSize = 11
      let align = 'left'

      if (cell) {
        const font = cell.s?.font || {}
        bold = !!font.bold
        italic = !!font.italic
        if (font.sz) fontSize = font.sz
        if (font.color?.rgb) { const rgb = argbToRgb(font.color.rgb); if (rgb) fontColor = `rgb(${rgb.r},${rgb.g},${rgb.b})` }
        const fill = cell.s?.fill
        if (fill?.fgColor?.rgb && fill.fgColor.rgb !== '00000000') { const rgb = argbToRgb(fill.fgColor.rgb); if (rgb) bgColor = `rgb(${rgb.r},${rgb.g},${rgb.b})` }
        const alignment = cell.s?.alignment || {}
        if (alignment.horizontal) align = alignment.horizontal
      }

      // Background
      ctx.fillStyle = bgColor
      ctx.fillRect(x, y, w, h)

      // Borders (default thin gray on all sides)
      ctx.strokeStyle = '#d0d0d0'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, w, h)

      // Override borders
      if (cell) {
        const border = cell.s?.border || {}
        if (border.top?.style) { ctx.strokeStyle = border.top.color?.rgb ? (argbToRgb(border.top.color.rgb) ? `rgb(${argbToRgb(border.top.color.rgb)!.r},${argbToRgb(border.top.color.rgb)!.g},${argbToRgb(border.top.color.rgb)!.b})` : '#000') : '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke() }
        if (border.bottom?.style) { ctx.strokeStyle = border.bottom.color?.rgb ? (argbToRgb(border.bottom.color.rgb) ? `rgb(${argbToRgb(border.bottom.color.rgb)!.r},${argbToRgb(border.bottom.color.rgb)!.g},${argbToRgb(border.bottom.color.rgb)!.b})` : '#000') : '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke() }
        if (border.left?.style) { ctx.strokeStyle = border.left.color?.rgb ? (argbToRgb(border.left.color.rgb) ? `rgb(${argbToRgb(border.left.color.rgb)!.r},${argbToRgb(border.left.color.rgb)!.g},${argbToRgb(border.left.color.rgb)!.b})` : '#000') : '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke() }
        if (border.right?.style) { ctx.strokeStyle = border.right.color?.rgb ? (argbToRgb(border.right.color.rgb) ? `rgb(${argbToRgb(border.right.color.rgb)!.r},${argbToRgb(border.right.color.rgb)!.g},${argbToRgb(border.right.color.rgb)!.b})` : '#000') : '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke() }
      }

      // Text
      let text = ''
      if (cell) {
        if (cell.w !== undefined && cell.w !== null) text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) text = String(cell.v)
      }
      if (text) {
        ctx.font = `${bold ? 'bold ' : ''}${italic ? 'italic ' : ''}${fontSize}px Arial, sans-serif`
        ctx.fillStyle = fontColor
        ctx.textBaseline = 'middle'
        let textX = x + 5
        if (align === 'center') { ctx.textAlign = 'center'; textX = x + w / 2 }
        else if (align === 'right') { ctx.textAlign = 'right'; textX = x + w - 5 }
        else { ctx.textAlign = 'left' }
        // Clip to cell
        ctx.save()
        ctx.beginPath()
        ctx.rect(x + 2, y + 1, w - 4, h - 2)
        ctx.clip()
        ctx.fillText(text, textX, y + h / 2)
        ctx.restore()
      }
    }
  }

  return canvas
}

export async function renderXlsxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading spreadsheet engine…')
  const XLSX = await loadXLSX()

  onProgress?.(0.2, 'Parsing spreadsheet…')
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellDates: true, cellNF: true })

  // Render each sheet to its own canvas
  const sheetCanvases: { canvas: HTMLCanvasElement; name: string }[] = []
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    if (!ws['!ref']) continue
    const canvas = renderSheetToCanvas(ws, XLSX, wb.SheetNames[i])
    sheetCanvases.push({ canvas, name: wb.SheetNames[i] })
    onProgress?.(0.2 + (0.3 * (i + 1) / wb.SheetNames.length), 'Rendering sheet ' + (i + 1) + ' of ' + wb.SheetNames.length)
    // Yield to the UI thread between sheets
    await new Promise(r => setTimeout(r, 0))
  }

  if (sheetCanvases.length === 0) throw new Error('No sheets found')

  onProgress?.(0.6, 'Creating pages…')

  // A4 page dimensions at 2x scale
  const PAGE_W = 794 * 2  // 1588
  const PAGE_H = 1123 * 2 // 2246
  const MARGIN = 40 * 2   // 80 (scaled)
  const SHEET_GAP = 30 * 2 // 60 (scaled)

  const pages: RenderedPage[] = []
  let pageNum = 0
  const totalPages = sheetCanvases.length

  for (const { canvas, name } of sheetCanvases) {
    const sheetW = canvas.width
    const sheetH = canvas.height

    // If the sheet fits on one page, just use it directly
    if (sheetH <= PAGE_H - MARGIN * 2) {
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = Math.max(sheetW + MARGIN * 2, PAGE_W)
      pageCanvas.height = PAGE_H
      const ctx = pageCanvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      // Center horizontally
      const offsetX = Math.max(MARGIN, (pageCanvas.width - sheetW) / 2)
      ctx.drawImage(canvas, offsetX, MARGIN)
      pages.push({
        dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
        width: pageCanvas.width / 2,
        height: pageCanvas.height / 2,
      })
    } else {
      // Split the sheet canvas into page-height chunks
      let y = 0
      while (y < sheetH) {
        const chunkH = Math.min(PAGE_H - MARGIN * 2, sheetH - y)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = Math.max(sheetW + MARGIN * 2, PAGE_W)
        pageCanvas.height = PAGE_H
        const ctx = pageCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        const offsetX = Math.max(MARGIN, (pageCanvas.width - sheetW) / 2)
        ctx.drawImage(canvas, 0, y, sheetW, chunkH, offsetX, MARGIN, sheetW, chunkH)
        pages.push({
          dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
          width: pageCanvas.width / 2,
          height: pageCanvas.height / 2,
        })
        y += chunkH
      }
    }

    // Add a gap page between sheets (except after the last one)
    pageNum++
    onProgress?.(0.6 + (0.4 * pageNum / totalPages), 'Page ' + pages.length)
    await new Promise(r => setTimeout(r, 0)) // Yield to UI
  }

  onProgress?.(1, 'Done')
  return pages
}
