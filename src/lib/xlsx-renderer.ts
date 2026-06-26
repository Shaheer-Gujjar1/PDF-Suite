'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Uses SheetJS to parse, then draws DIRECTLY to canvas via Canvas 2D API.
 * No html2canvas, no iframes, no SVG foreignObject — just direct drawing.
 * Renders each sheet to its own canvas, then splits into A4 pages.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'

let xlsxPromise: Promise<any> | null = null

function loadScript(url: string, check: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) { resolve(); return }
    const s = document.createElement('script')
    s.src = url
    s.onload = () => { if (check()) resolve(); else reject(new Error('Not found: ' + url)) }
    s.onerror = () => reject(new Error('Failed: ' + url))
    document.head.appendChild(s)
  })
}

function loadXLSX(): Promise<any> {
  if (xlsxPromise) return xlsxPromise
  xlsxPromise = loadScript(XLSX_URL, () => !!(window as any).XLSX).then(() => (window as any).XLSX)
  return xlsxPromise
}

export interface RenderedPage { dataUrl: string; width: number; height: number }
export interface RenderProgress { (progress: number, message: string): void }

function argbToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || hex === '00000000' || hex === 'FFFFFFFF') return null
  const h = hex.replace(/^FF/, '')
  if (h.length === 6) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }
  return null
}

const THEME_COLORS = [
  {r:255,g:255,b:255},{r:0,g:0,b:0},{r:231,g:230,b:230},{r:68,g:84,b:106},
  {r:91,g:155,b:213},{r:237,g:125,b:49},{r:165,g:165,b:165},{r:255,g:192,b:0},
  {r:68,g:114,b:196},{r:112,g:173,b:71}
]

function colorFromObj(obj: any): { r: number; g: number; b: number } | null {
  if (!obj) return null
  if (obj.rgb) return argbToRgb(obj.rgb)
  if (obj.theme !== undefined && obj.theme < THEME_COLORS.length) return THEME_COLORS[obj.theme]
  return null
}

interface CellInfo {
  text: string
  bold: boolean; italic: boolean; underline: boolean
  fontSize: number
  fontColor: string; bgColor: string
  align: string; valign: string; wrapText: boolean
  borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string
  rowspan: number; colspan: number; hidden: boolean
}

function parseSheet(ws: any, XLSX: any): { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string } | null {
  if (!ws['!ref']) return null
  const range = XLSX.utils.decode_range(ws['!ref'])
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  const mergeMap: Record<string, { rs: number; cs: number; hidden: boolean }> = {}
  for (const m of merges) {
    mergeMap[`${m.s.r},${m.s.c}`] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1, hidden: false }
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (r !== m.s.r || c !== m.s.c)
          mergeMap[`${r},${c}`] = { rs: 0, cs: 0, hidden: true }
  }

  const colWidths: number[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]
    colWidths.push(col && col.wpx ? col.wpx : 90)
  }

  const rowHeights: number[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]
    rowHeights.push(row && row.hpt ? Math.round(row.hpt * 1.333) : 22)
  }

  const cells: CellInfo[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowCells: CellInfo[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${r},${c}`]

      if (merge && merge.hidden) {
        rowCells.push({ text: '', bold: false, italic: false, underline: false, fontSize: 11, fontColor: '#000', bgColor: '#fff', align: 'left', valign: 'middle', wrapText: false, rowspan: 0, colspan: 0, hidden: true })
        continue
      }

      const info: CellInfo = {
        text: '', bold: false, italic: false, underline: false, fontSize: 11,
        fontColor: '#000000', bgColor: '#ffffff', align: 'left', valign: 'middle',
        wrapText: false, rowspan: merge ? merge.rs : 1, colspan: merge ? merge.cs : 1, hidden: false
      }

      if (cell) {
        const s = cell.s || {}
        const font = s.font || {}
        info.bold = !!font.bold
        info.italic = !!font.italic
        info.underline = !!font.underline
        if (font.sz) info.fontSize = font.sz
        const fc = colorFromObj(font.color); if (fc) info.fontColor = `rgb(${fc.r},${fc.g},${fc.b})`
        const bg = colorFromObj(s.fill?.fgColor); if (bg) info.bgColor = `rgb(${bg.r},${bg.g},${bg.b})`
        const align = s.alignment || {}
        if (align.horizontal) info.align = align.horizontal
        else if (cell.t === 'n') info.align = 'right'
        else if (cell.t === 'b') info.align = 'center'
        if (align.vertical) info.valign = align.vertical
        if (align.wrapText) info.wrapText = true
        const border = s.border || {}
        if (border.top?.style) { const bc = colorFromObj(border.top.color); info.borderTop = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000' }
        if (border.bottom?.style) { const bc = colorFromObj(border.bottom.color); info.borderBottom = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000' }
        if (border.left?.style) { const bc = colorFromObj(border.left.color); info.borderLeft = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000' }
        if (border.right?.style) { const bc = colorFromObj(border.right.color); info.borderRight = bc ? `rgb(${bc.r},${bc.g},${bc.b})` : '#000' }
        if (cell.w !== undefined && cell.w !== null) info.text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) info.text = String(cell.v)
      }

      rowCells.push(info)
    }
    cells.push(rowCells)
  }

  return { cells, colWidths, rowHeights, name: '' }
}

function drawSheet(ctx: CanvasRenderingContext2D, sheet: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string }, sheetName: string, offsetX: number, offsetY: number) {
  const { cells, colWidths, rowHeights } = sheet

  // Calculate positions
  const colX: number[] = [offsetX]
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i])
  const rowY: number[] = [offsetY]
  for (let i = 0; i < rowHeights.length; i++) rowY.push(rowY[i] + rowHeights[i])

  // Draw sheet title
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillStyle = '#2F5496'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(sheetName, offsetX, offsetY - 30)
  ctx.strokeStyle = '#2F5496'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(offsetX, offsetY - 12)
  ctx.lineTo(offsetX + colWidths.reduce((a, b) => a + b, 0), offsetY - 12)
  ctx.stroke()

  // Draw cells
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      const cell = cells[r][c]
      if (cell.hidden) continue

      const x = colX[c]
      const y = rowY[r]
      const w = colWidths.slice(c, c + cell.colspan).reduce((a, b) => a + b, 0)
      const h = rowHeights.slice(r, r + cell.rowspan).reduce((a, b) => a + b, 0)

      // Background
      ctx.fillStyle = cell.bgColor
      ctx.fillRect(x, y, w, h)

      // Default borders
      ctx.strokeStyle = '#d0d0d0'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      // Styled borders
      if (cell.borderTop) { ctx.strokeStyle = cell.borderTop; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke() }
      if (cell.borderBottom) { ctx.strokeStyle = cell.borderBottom; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke() }
      if (cell.borderLeft) { ctx.strokeStyle = cell.borderLeft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke() }
      if (cell.borderRight) { ctx.strokeStyle = cell.borderRight; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke() }

      // Text
      if (cell.text) {
        ctx.font = `${cell.bold ? 'bold ' : ''}${cell.italic ? 'italic ' : ''}${cell.fontSize}px Arial, sans-serif`
        ctx.fillStyle = cell.fontColor
        const padding = 5
        const maxW = w - padding * 2

        if (cell.wrapText && ctx.measureText(cell.text).width > maxW) {
          // Word wrap
          const words = cell.text.split(' ')
          const lines: string[] = []
          let line = ''
          for (const word of words) {
            const test = line ? line + ' ' + word : word
            if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word }
            else line = test
          }
          if (line) lines.push(line)

          const lh = cell.fontSize * 1.3
          let startY: number
          if (cell.valign === 'top') startY = y + padding + lh / 2
          else if (cell.valign === 'bottom') startY = y + h - padding - (lines.length - 1) * lh - lh / 2
          else startY = y + (h - lines.length * lh) / 2 + lh / 2

          ctx.textBaseline = 'middle'
          ctx.save()
          ctx.beginPath()
          ctx.rect(x + 1, y + 1, w - 2, h - 2)
          ctx.clip()
          for (let li = 0; li < lines.length; li++) {
            let tx = x + padding
            if (cell.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
            else if (cell.align === 'right') { ctx.textAlign = 'right'; tx = x + w - padding }
            else ctx.textAlign = 'left'
            ctx.fillText(lines[li], tx, startY + li * lh)
          }
          ctx.restore()
        } else {
          // Single line
          ctx.textBaseline = 'middle'
          let tx = x + padding
          if (cell.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
          else if (cell.align === 'right') { ctx.textAlign = 'right'; tx = x + w - padding }
          else ctx.textAlign = 'left'

          let ty = y + h / 2
          if (cell.valign === 'top') ty = y + cell.fontSize * 0.7 + 2
          else if (cell.valign === 'bottom') ty = y + h - cell.fontSize * 0.5 - 2

          ctx.save()
          ctx.beginPath()
          ctx.rect(x + 1, y + 1, w - 2, h - 2)
          ctx.clip()
          ctx.fillText(cell.text, tx, ty)
          ctx.restore()
        }
      }
    }
  }
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
  const sheets: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string }[] = []
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    const parsed = parseSheet(ws, XLSX)
    if (parsed) { parsed.name = wb.SheetNames[i]; sheets.push(parsed) }
    onProgress?.(0.2 + 0.2 * (i + 1) / wb.SheetNames.length, 'Sheet ' + (i + 1))
  }
  if (sheets.length === 0) throw new Error('No sheets found')

  onProgress?.(0.5, 'Rendering…')

  const MARGIN = 40
  const TITLE_SPACE = 40
  const SHEET_GAP = 30
  const SCALE = 2
  const PAGE_WIDTH = 794
  const PAGE_HEIGHT = 1123

  // Calculate total canvas size
  let maxW = 0
  let totalH = 0
  for (const sheet of sheets) {
    const sw = sheet.colWidths.reduce((a, b) => a + b, 0) + MARGIN * 2
    const sh = sheet.rowHeights.reduce((a, b) => a + b, 0) + TITLE_SPACE + MARGIN * 2 + SHEET_GAP
    if (sw > maxW) maxW = sw
    totalH += sh
  }

  const canvasW = Math.max(maxW, PAGE_WIDTH) * SCALE
  const canvasH = totalH * SCALE

  // Create master canvas
  const master = document.createElement('canvas')
  master.width = canvasW
  master.height = canvasH
  const ctx = master.getContext('2d')!

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Draw each sheet
  let currentY = MARGIN
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]
    const sheetTableWidth = sheet.colWidths.reduce((a, b) => a + b, 0)
    const offsetX = Math.max(MARGIN, (PAGE_WIDTH - sheetTableWidth) / 2)

    // Scale for this drawing
    ctx.save()
    ctx.scale(SCALE, SCALE)
    drawSheet(ctx, sheet, sheet.name, offsetX, currentY + TITLE_SPACE)
    ctx.restore()

    const sheetHeight = sheet.rowHeights.reduce((a, b) => a + b, 0)
    currentY += TITLE_SPACE + sheetHeight + SHEET_GAP + MARGIN
    onProgress?.(0.5 + 0.3 * (i + 1) / sheets.length, 'Rendering sheet ' + (i + 1))
    await new Promise(r => setTimeout(r, 0)) // Yield to UI
  }

  onProgress?.(0.8, 'Splitting into pages…')

  // Split into A4 pages
  const pageHScaled = PAGE_HEIGHT * SCALE
  const pages: RenderedPage[] = []
  let y = 0

  while (y < canvasH) {
    const remaining = canvasH - y
    const ph = Math.min(pageHScaled, remaining)

    const pc = document.createElement('canvas')
    pc.width = canvasW
    pc.height = ph
    const pctx = pc.getContext('2d')!
    pctx.fillStyle = '#ffffff'
    pctx.fillRect(0, 0, pc.width, pc.height)
    pctx.drawImage(master, 0, y, canvasW, ph, 0, 0, canvasW, ph)

    pages.push({
      dataUrl: pc.toDataURL('image/jpeg', 0.92),
      width: canvasW / SCALE,
      height: ph / SCALE,
    })

    y += ph
    onProgress?.(0.8 + 0.2 * pages.length / Math.ceil(canvasH / pageHScaled), 'Page ' + pages.length)
    await new Promise(r => setTimeout(r, 0))
  }

  onProgress?.(1, 'Done')
  return pages
}
