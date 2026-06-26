'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Parses the spreadsheet with SheetJS, then draws it DIRECTLY to a canvas
 * using the Canvas 2D API — no html2canvas, no iframes, no CSS conflicts.
 * Preserves cell colors, merges, borders, fonts, alignment, column widths.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'

let xlsxPromise: Promise<any> | null = null

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

export interface RenderedPage {
  dataUrl: string
  width: number
  height: number
}

export interface RenderProgress {
  (progress: number, message: string): void
}

/** Convert ARGB hex to {r,g,b} */
function argbToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || hex === '00000000' || hex === 'FFFFFFFF') return null
  const h = hex.replace(/^FF/, '')
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  return null
}

interface CellStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize: number
  fontColor: string
  bgColor: string
  align: string
  valign: string
  borders: { top?: string; bottom?: string; left?: string; right?: string }
}

interface ParsedCell {
  text: string
  style: CellStyle
  rowspan: number
  colspan: number
  hidden: boolean
}

interface ParsedSheet {
  name: string
  cells: ParsedCell[][]
  colWidths: number[]
  rowHeights: number[]
  totalWidth: number
  totalHeight: number
}

/** Parse a worksheet into a structured format with styling */
function parseWorksheet(ws: any, XLSX: any): ParsedSheet | null {
  if (!ws['!ref']) return null
  const range = XLSX.utils.decode_range(ws['!ref'])
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

  const defaultStyle: CellStyle = {
    bold: false, italic: false, underline: false,
    fontSize: 11, fontColor: '#000000', bgColor: '#ffffff',
    align: 'left', valign: 'middle',
    borders: {},
  }

  const cells: ParsedCell[][] = []
  const colWidths: number[] = []
  const rowHeights: number[] = []

  // Column widths (in pixels, default 80)
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]
    colWidths.push(col && col.wpx ? col.wpx : 90)
  }

  // Row heights (in pixels, default 22)
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]
    rowHeights.push(row && row.hpt ? Math.round(row.hpt * 1.333) : 22)
  }

  // Parse cells
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowCells: ParsedCell[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${r},${c}`]

      if (merge && merge.hidden) {
        rowCells.push({ text: '', style: defaultStyle, rowspan: 0, colspan: 0, hidden: true })
        continue
      }

      const style: CellStyle = { ...defaultStyle }

      let text = ''
      if (cell) {
        // Font
        const font = cell.s?.font || {}
        if (font.bold) style.bold = true
        if (font.italic) style.italic = true
        if (font.underline) style.underline = true
        if (font.sz) style.fontSize = font.sz
        if (font.color?.rgb) {
          const rgb = argbToRgb(font.color.rgb)
          if (rgb) style.fontColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`
        }

        // Fill
        const fill = cell.s?.fill
        if (fill?.fgColor?.rgb && fill.fgColor.rgb !== '00000000') {
          const rgb = argbToRgb(fill.fgColor.rgb)
          if (rgb) style.bgColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`
        }

        // Alignment
        const align = cell.s?.alignment || {}
        if (align.horizontal) style.align = align.horizontal
        if (align.vertical) style.valign = align.vertical

        // Borders
        const border = cell.s?.border || {}
        if (border.top?.style) {
          const bc = border.top.color?.rgb ? argbToRgb(border.top.color.rgb) : null
          style.borders.top = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000000'
        }
        if (border.bottom?.style) {
          const bc = border.bottom.color?.rgb ? argbToRgb(border.bottom.color.rgb) : null
          style.borders.bottom = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000000'
        }
        if (border.left?.style) {
          const bc = border.left.color?.rgb ? argbToRgb(border.left.color.rgb) : null
          style.borders.left = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000000'
        }
        if (border.right?.style) {
          const bc = border.right.color?.rgb ? argbToRgb(border.right.color.rgb) : null
          style.borders.right = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000000'
        }

        // Content
        if (cell.w !== undefined && cell.w !== null) text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) text = String(cell.v)
      }

      rowCells.push({
        text,
        style,
        rowspan: merge ? merge.rowspan : 1,
        colspan: merge ? merge.colspan : 1,
        hidden: false,
      })
    }
    cells.push(rowCells)
  }

  const totalWidth = colWidths.reduce((a, b) => a + b, 0)
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0)

  return { name: '', cells, colWidths, rowHeights, totalWidth, totalHeight }
}

/** Draw a parsed sheet onto a canvas at the given position */
function drawSheet(
  ctx: CanvasRenderingContext2D,
  sheet: ParsedSheet,
  offsetX: number,
  offsetY: number,
  scale: number
): { width: number; height: number } {
  const { cells, colWidths, rowHeights } = sheet
  ctx.save()
  ctx.scale(scale, scale)

  // Calculate column X positions
  const colX: number[] = [0]
  for (let i = 0; i < colWidths.length; i++) {
    colX.push(colX[i] + colWidths[i])
  }

  // Calculate row Y positions
  const rowY: number[] = [0]
  for (let i = 0; i < rowHeights.length; i++) {
    rowY.push(rowY[i] + rowHeights[i])
  }

  // Draw cells
  for (let r = 0; r < cells.length; r++) {
    const row = cells[r]
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (cell.hidden) continue

      const x = colX[c] + offsetX
      const y = rowY[r] + offsetY
      const w = colWidths.slice(c, c + cell.colspan).reduce((a, b) => a + b, 0)
      const h = rowHeights.slice(r, r + cell.rowspan).reduce((a, b) => a + b, 0)

      // Background
      ctx.fillStyle = cell.style.bgColor
      ctx.fillRect(x, y, w, h)

      // Borders
      ctx.strokeStyle = '#d0d0d0'
      ctx.lineWidth = 1
      // Default thin borders on all sides
      ctx.strokeRect(x, y, w, h)
      // Override with styled borders
      if (cell.style.borders.top) {
        ctx.strokeStyle = cell.style.borders.top
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + w, y)
        ctx.stroke()
      }
      if (cell.style.borders.bottom) {
        ctx.strokeStyle = cell.style.borders.bottom
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x, y + h)
        ctx.lineTo(x + w, y + h)
        ctx.stroke()
      }
      if (cell.style.borders.left) {
        ctx.strokeStyle = cell.style.borders.left
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + h)
        ctx.stroke()
      }
      if (cell.style.borders.right) {
        ctx.strokeStyle = cell.style.borders.right
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x + w, y)
        ctx.lineTo(x + w, y + h)
        ctx.stroke()
      }

      // Text
      if (cell.text) {
        const fontSize = cell.style.fontSize
        ctx.font = `${cell.style.bold ? 'bold ' : ''}${cell.style.italic ? 'italic ' : ''}${fontSize}px Arial, sans-serif`
        ctx.fillStyle = cell.style.fontColor
        ctx.textBaseline = 'middle'

        // Alignment
        let textAlign = 'left'
        let textX = x + 5
        if (cell.style.align === 'center') {
          textAlign = 'center'
          textX = x + w / 2
        } else if (cell.style.align === 'right') {
          textAlign = 'right'
          textX = x + w - 5
        }
        ctx.textAlign = textAlign as CanvasTextAlign

        // Vertical alignment
        let textY = y + h / 2
        if (cell.style.valign === 'top') textY = y + fontSize * 0.7
        else if (cell.style.valign === 'bottom') textY = y + h - fontSize * 0.5

        // Clip text to cell
        ctx.save()
        ctx.beginPath()
        ctx.rect(x + 2, y + 1, w - 4, h - 2)
        ctx.clip()
        ctx.fillText(cell.text, textX, textY)
        ctx.restore()
      }
    }
  }

  ctx.restore()
  return { width: sheet.totalWidth, height: sheet.totalHeight }
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

  // Parse all sheets
  const sheets: ParsedSheet[] = []
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    const parsed = parseWorksheet(ws, XLSX)
    if (parsed) {
      parsed.name = wb.SheetNames[i]
      sheets.push(parsed)
    }
  }

  if (sheets.length === 0) {
    throw new Error('No sheets found in the spreadsheet')
  }

  onProgress?.(0.4, 'Rendering spreadsheet…')

  // Calculate total canvas dimensions
  const MARGIN = 40
  const SHEET_GAP = 40
  const TITLE_HEIGHT = 30
  const SCALE = 2

  // A4 dimensions at 96dpi
  const PAGE_WIDTH = 794
  const PAGE_HEIGHT = 1123

  // Calculate content width (max of all sheets)
  let maxContentWidth = 0
  let totalContentHeight = 0
  for (const sheet of sheets) {
    const sheetWidth = sheet.totalWidth + MARGIN * 2
    const sheetHeight = sheet.totalHeight + TITLE_HEIGHT + MARGIN * 2 + SHEET_GAP
    if (sheetWidth > maxContentWidth) maxContentWidth = sheetWidth
    totalContentHeight += sheetHeight
  }

  const canvasWidth = Math.max(maxContentWidth, PAGE_WIDTH) * SCALE
  const canvasHeight = totalContentHeight * SCALE

  // Create the master canvas
  const masterCanvas = document.createElement('canvas')
  masterCanvas.width = canvasWidth
  masterCanvas.height = canvasHeight
  const ctx = masterCanvas.getContext('2d')!

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // Draw each sheet
  let currentY = 0
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]

    // Sheet title
    ctx.save()
    ctx.scale(SCALE, SCALE)
    ctx.font = 'bold 16px Arial, sans-serif'
    ctx.fillStyle = '#2F5496'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(sheet.name, MARGIN, currentY + MARGIN)
    // Title underline
    ctx.strokeStyle = '#2F5496'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(MARGIN, currentY + MARGIN + TITLE_HEIGHT - 5)
    ctx.lineTo(MARGIN + sheet.totalWidth, currentY + MARGIN + TITLE_HEIGHT - 5)
    ctx.stroke()
    ctx.restore()

    // Draw the sheet data
    const drawResult = drawSheet(
      ctx,
      sheet,
      MARGIN,
      currentY + MARGIN + TITLE_HEIGHT,
      SCALE
    )

    currentY += MARGIN + TITLE_HEIGHT + sheet.totalHeight + SHEET_GAP + MARGIN
    onProgress?.(0.4 + (0.3 * (i + 1) / sheets.length), 'Rendering sheet ' + (i + 1) + ' of ' + sheets.length)
  }

  onProgress?.(0.7, 'Splitting into pages…')

  // Split into A4 pages at safe break points
  const pageHeightScaled = PAGE_HEIGHT * SCALE
  const pages: RenderedPage[] = []
  let y = 0
  let pageNum = 0

  while (y < canvasHeight) {
    const idealBreak = y + pageHeightScaled

    if (idealBreak >= canvasHeight) {
      // Last page — take remaining content
      const remainingHeight = canvasHeight - y
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvasWidth
      pageCanvas.height = Math.max(1, remainingHeight)
      const pageCtx = pageCanvas.getContext('2d')!
      pageCtx.fillStyle = '#ffffff'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageCtx.drawImage(masterCanvas, 0, y, canvasWidth, remainingHeight, 0, 0, canvasWidth, remainingHeight)
      pages.push({
        dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
        width: canvasWidth / SCALE,
        height: remainingHeight / SCALE,
      })
      break
    }

    // Find a safe break point — a fully white row
    let safeY = idealBreak
    const searchRange = 80 * SCALE // Search ±80px (scaled)
    for (let offset = 0; offset <= searchRange; offset += SCALE) {
      for (const checkY of [idealBreak + offset, idealBreak - offset]) {
        if (checkY < y || checkY >= canvasHeight) continue
        let isWhite = true
        const rowData = ctx.getImageData(0, checkY, canvasWidth, 1).data
        for (let x = 0; x < canvasWidth; x += 4) {
          if (rowData[x * 4] < 250 || rowData[x * 4 + 1] < 250 || rowData[x * 4 + 2] < 250) {
            isWhite = false
            break
          }
        }
        if (isWhite) { safeY = checkY; break }
      }
      if (safeY !== idealBreak) break
    }

    const pageHeight = safeY - y
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvasWidth
    pageCanvas.height = pageHeight
    const pageCtx = pageCanvas.getContext('2d')!
    pageCtx.fillStyle = '#ffffff'
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    pageCtx.drawImage(masterCanvas, 0, y, canvasWidth, pageHeight, 0, 0, canvasWidth, pageHeight)
    pages.push({
      dataUrl: pageCanvas.toDataURL('image/jpeg', 0.92),
      width: canvasWidth / SCALE,
      height: pageHeight / SCALE,
    })

    y = safeY
    pageNum++
    onProgress?.(0.7 + (0.3 * (pageNum + 1) / Math.ceil(canvasHeight / pageHeightScaled)), 'Page ' + (pageNum + 1))
  }

  onProgress?.(1, 'Done')
  return pages
}
