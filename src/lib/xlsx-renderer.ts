'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Uses SheetJS to parse cell DATA, then manually parses xl/styles.xml via
 * JSZip to get full cell STYLING (colors, fonts, borders, fills) that the
 * SheetJS community edition misses. Draws directly to Canvas 2D.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'

let xlsxPromise: Promise<any> | null = null
let jszipPromise: Promise<any> | null = null

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

function loadJSZip(): Promise<any> {
  if (jszipPromise) return jszipPromise
  jszipPromise = loadScript(JSZIP_URL, () => !!(window as any).JSZip).then(() => (window as any).JSZip)
  return jszipPromise
}

export interface RenderedPage { dataUrl: string; width: number; height: number }
export interface RenderProgress { (progress: number, message: string): void }

// ─── Style parsing from xl/styles.xml ───────────────────────────────────────

interface XlsxStyle {
  fontColor: string
  bgColor: string
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize: number
  fontName: string
  align: string
  valign: string
  wrapText: boolean
  borderTop?: string
  borderBottom?: string
  borderLeft?: string
  borderRight?: string
}

const DEFAULT_STYLE: XlsxStyle = {
  fontColor: '#000000', bgColor: '#ffffff',
  bold: false, italic: false, underline: false,
  fontSize: 11, fontName: 'Arial',
  align: 'left', valign: 'middle', wrapText: false,
}

/** Parse ARGB or RGB hex to CSS rgb() */
function hexToCss(hex: string): string | null {
  if (!hex) return null
  // Remove alpha prefix if 8 chars
  let h = hex
  if (h.length === 8) h = h.slice(2)
  if (h.length === 6) return `rgb(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)})`
  return null
}

/** Map theme color index to approximate RGB */
const THEME_COLORS: string[] = [
  'rgb(255,255,255)', 'rgb(0,0,0)', 'rgb(231,230,230)', 'rgb(68,84,106)',
  'rgb(91,155,213)', 'rgb(237,125,49)', 'rgb(165,165,165)', 'rgb(255,192,0)',
  'rgb(68,114,196)', 'rgb(112,173,71)',
]

function colorToCss(color: any): string | null {
  if (!color) return null
  if (color.rgb) return hexToCss(color.rgb)
  if (color.theme !== undefined && color.theme < THEME_COLORS.length) return THEME_COLORS[color.theme]
  if (color.tint !== undefined) {
    // Apply tint to theme color (simplified)
    const base = color.theme !== undefined && color.theme < THEME_COLORS.length
      ? THEME_COLORS[color.theme] : 'rgb(255,255,255)'
    return base
  }
  return null
}

/**
 * Parse xl/styles.xml from the XLSX to build a complete style table.
 * Returns an array indexed by cellXfs index → XlsxStyle.
 */
async function parseStyles(arrayBuffer: ArrayBuffer): Promise<XlsxStyle[]> {
  const JSZip = await loadJSZip()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) {
    console.warn('[xlsx-renderer] No styles.xml found — using default styles')
    return [DEFAULT_STYLE]
  }

  const xml = await stylesFile.async('string')
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')

  // Parse fonts
  const fonts: XlsxStyle[] = []
  const fontNodes = doc.querySelectorAll('fonts > font')
  fontNodes.forEach((fontNode) => {
    const style: XlsxStyle = { ...DEFAULT_STYLE }
    const sz = fontNode.querySelector('sz')
    if (sz) style.fontSize = parseFloat(sz.getAttribute('val') || '11')
    const color = fontNode.querySelector('color')
    if (color) { const c = colorToCss({ rgb: color.getAttribute('rgb'), theme: color.getAttribute('theme') ? parseInt(color.getAttribute('theme')!) : undefined }); if (c) style.fontColor = c }
    const name = fontNode.querySelector('name')
    if (name) style.fontName = name.getAttribute('val') || 'Arial'
    if (fontNode.querySelector('b')) style.bold = true
    if (fontNode.querySelector('i')) style.italic = true
    if (fontNode.querySelector('u')) style.underline = true
    fonts.push(style)
  })

  // Parse fills
  const fills: string[] = []
  const fillNodes = doc.querySelectorAll('fills > fill')
  fillNodes.forEach((fillNode) => {
    const patternFill = fillNode.querySelector('patternFill')
    if (patternFill) {
      const fgColor = patternFill.querySelector('fgColor')
      if (fgColor) {
        const c = colorToCss({ rgb: fgColor.getAttribute('rgb'), theme: fgColor.getAttribute('theme') ? parseInt(fgColor.getAttribute('theme')!) : undefined })
        fills.push(c || '#ffffff')
      } else {
        fills.push('#ffffff')
      }
    } else {
      fills.push('#ffffff')
    }
  })

  // Parse borders
  const borders: { top?: string; bottom?: string; left?: string; right?: string }[] = []
  const borderNodes = doc.querySelectorAll('borders > border')
  borderNodes.forEach((borderNode) => {
    const b: { top?: string; bottom?: string; left?: string; right?: string } = {}
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const sideNode = borderNode.querySelector(side)
      if (sideNode) {
        const styleAttr = sideNode.getAttribute('style')
        if (styleAttr && styleAttr !== 'none') {
          const colorNode = sideNode.querySelector('color')
          const c = colorNode ? colorToCss({ rgb: colorNode.getAttribute('rgb'), theme: colorNode.getAttribute('theme') ? parseInt(colorNode.getAttribute('theme')!) : undefined }) : '#000000'
          b[side as 'top'] = c || '#000000'
        }
      }
    }
    borders.push(b)
  })

  // Parse cellXfs — the master style table indexed by style index
  const styles: XlsxStyle[] = []
  const xfNodes = doc.querySelectorAll('cellXfs > xf')
  xfNodes.forEach((xf) => {
    const fontId = parseInt(xf.getAttribute('fontId') || '0')
    const fillId = parseInt(xf.getAttribute('fillId') || '0')
    const borderId = parseInt(xf.getAttribute('borderId') || '0')

    const style: XlsxStyle = { ...(fonts[fontId] || DEFAULT_STYLE) }

    // Apply fill (skip fill index 0 which is "none" and 1 which is gray125)
    if (fillId > 1 && fills[fillId]) {
      style.bgColor = fills[fillId]
    }

    // Apply borders
    const border = borders[borderId]
    if (border) {
      style.borderTop = border.top
      style.borderBottom = border.bottom
      style.borderLeft = border.left
      style.borderRight = border.right
    }

    // Alignment (stored as child element)
    const alignment = xf.querySelector('alignment')
    if (alignment) {
      const h = alignment.getAttribute('horizontal')
      if (h) style.align = h
      const v = alignment.getAttribute('vertical')
      if (v) style.valign = v
      if (alignment.getAttribute('wrapText') === '1' || alignment.getAttribute('wrapText') === 'true') {
        style.wrapText = true
      }
    }

    styles.push(style)
  })

  console.log(`[xlsx-renderer] Parsed ${fonts.length} fonts, ${fills.length} fills, ${borders.length} borders, ${styles.length} cell styles`)
  return styles
}

// ─── Sheet parsing + canvas drawing ─────────────────────────────────────────

interface CellInfo {
  text: string
  style: XlsxStyle
  rowspan: number
  colspan: number
  hidden: boolean
}

function parseSheet(ws: any, XLSX: any, styles: XlsxStyle[]): { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string } | null {
  if (!ws['!ref']) return null
  const fullRange = XLSX.utils.decode_range(ws['!ref'])
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  // Trim to actual content
  let maxR = -1, maxC = -1
  for (const key in ws) {
    if (key[0] === '!') continue
    const cell = ws[key]
    if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
      const addr = XLSX.utils.decode_cell(key)
      if (addr.r > maxR) maxR = addr.r
      if (addr.c > maxC) maxC = addr.c
    }
  }
  if (maxR < 0) maxR = fullRange.s.r
  if (maxC < 0) maxC = fullRange.s.c
  for (const m of merges) { if (m.e.r > maxR) maxR = m.e.r; if (m.e.c > maxC) maxC = m.e.c }
  maxR = Math.min(maxR, fullRange.s.r + 499)
  maxC = Math.min(maxC, fullRange.s.c + 29)

  const range = { s: { r: fullRange.s.r, c: fullRange.s.c }, e: { r: maxR, c: maxC } }
  console.log(`[xlsx-renderer] Sheet range: ${XLSX.utils.encode_range(range)} (${maxR - fullRange.s.r + 1} rows × ${maxC - fullRange.s.c + 1} cols)`)

  // Merge lookup
  const mergeMap: Record<string, { rs: number; cs: number; hidden: boolean }> = {}
  for (const m of merges) {
    if (m.s.r > range.e.r || m.s.c > range.e.c) continue
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
        rowCells.push({ text: '', style: DEFAULT_STYLE, rowspan: 0, colspan: 0, hidden: true })
        continue
      }

      // Get style from our parsed styles table (cell.s is the style index)
      let style = DEFAULT_STYLE
      if (cell && cell.s !== undefined && styles[cell.s]) {
        style = styles[cell.s]
      }

      // Smart alignment for unstyled cells
      if (cell && (cell.s === undefined || !styles[cell.s])) {
        style = { ...DEFAULT_STYLE }
        if (cell.t === 'n') style.align = 'right'
        else if (cell.t === 'b') style.align = 'center'
      }

      let text = ''
      if (cell) {
        if (cell.w !== undefined && cell.w !== null) text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) text = String(cell.v)
      }

      rowCells.push({
        text,
        style,
        rowspan: merge ? merge.rs : 1,
        colspan: merge ? merge.cs : 1,
        hidden: false,
      })
    }
    cells.push(rowCells)
  }

  return { cells, colWidths, rowHeights, name: '' }
}

function drawSheet(ctx: CanvasRenderingContext2D, sheet: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string }, sheetName: string, offsetX: number, offsetY: number) {
  const { cells, colWidths, rowHeights } = sheet

  const colX: number[] = [offsetX]
  for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i])
  const rowY: number[] = [offsetY]
  for (let i = 0; i < rowHeights.length; i++) rowY.push(rowY[i] + rowHeights[i])

  // Sheet title
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
      const s = cell.style

      const x = colX[c], y = rowY[r]
      const w = colWidths.slice(c, c + cell.colspan).reduce((a, b) => a + b, 0)
      const h = rowHeights.slice(r, r + cell.rowspan).reduce((a, b) => a + b, 0)

      // Background
      ctx.fillStyle = s.bgColor
      ctx.fillRect(x, y, w, h)

      // Default borders
      ctx.strokeStyle = '#d0d0d0'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      // Styled borders
      if (s.borderTop) { ctx.strokeStyle = s.borderTop; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke() }
      if (s.borderBottom) { ctx.strokeStyle = s.borderBottom; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke() }
      if (s.borderLeft) { ctx.strokeStyle = s.borderLeft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke() }
      if (s.borderRight) { ctx.strokeStyle = s.borderRight; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke() }

      // Text
      if (cell.text) {
        ctx.font = `${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${s.fontSize}px ${s.fontName}, Arial, sans-serif`
        ctx.fillStyle = s.fontColor
        const padding = 5
        const maxW = w - padding * 2

        if (s.wrapText && ctx.measureText(cell.text).width > maxW) {
          const words = cell.text.split(' ')
          const lines: string[] = []
          let line = ''
          for (const word of words) {
            const test = line ? line + ' ' + word : word
            if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word }
            else line = test
          }
          if (line) lines.push(line)
          const lh = s.fontSize * 1.3
          let startY: number
          if (s.valign === 'top') startY = y + padding + lh / 2
          else if (s.valign === 'bottom') startY = y + h - padding - (lines.length - 1) * lh - lh / 2
          else startY = y + (h - lines.length * lh) / 2 + lh / 2
          ctx.textBaseline = 'middle'
          ctx.save()
          ctx.beginPath()
          ctx.rect(x + 1, y + 1, w - 2, h - 2)
          ctx.clip()
          for (let li = 0; li < lines.length; li++) {
            let tx = x + padding
            if (s.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
            else if (s.align === 'right') { ctx.textAlign = 'right'; tx = x + w - padding }
            else ctx.textAlign = 'left'
            ctx.fillText(lines[li], tx, startY + li * lh)
          }
          ctx.restore()
        } else {
          ctx.textBaseline = 'middle'
          let tx = x + padding
          if (s.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
          else if (s.align === 'right') { ctx.textAlign = 'right'; tx = x + w - padding }
          else ctx.textAlign = 'left'
          let ty = y + h / 2
          if (s.valign === 'top') ty = y + s.fontSize * 0.7 + 2
          else if (s.valign === 'bottom') ty = y + h - s.fontSize * 0.5 - 2
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
  onProgress?.(0.1, 'Loading engines…')
  const XLSX = await loadXLSX()

  onProgress?.(0.2, 'Parsing spreadsheet…')
  const arrayBuffer = await file.arrayBuffer()

  // Parse styles from xl/styles.xml using JSZip (gets FULL styling that
  // SheetJS community edition misses)
  onProgress?.(0.3, 'Reading cell styles…')
  let styles: XlsxStyle[] = [DEFAULT_STYLE]
  try {
    styles = await parseStyles(arrayBuffer)
  } catch (e) {
    console.warn('[xlsx-renderer] Could not parse styles.xml, using defaults:', e)
  }

  // Parse cell data with SheetJS
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellNF: true })

  const sheets: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string }[] = []
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    const parsed = parseSheet(ws, XLSX, styles)
    if (parsed) { parsed.name = wb.SheetNames[i]; sheets.push(parsed) }
    onProgress?.(0.3 + 0.2 * (i + 1) / wb.SheetNames.length, 'Sheet ' + (i + 1))
  }
  if (sheets.length === 0) throw new Error('No sheets found')

  onProgress?.(0.5, 'Rendering…')

  const MARGIN = 40, TITLE_SPACE = 40, SHEET_GAP = 30, SCALE = 2
  const PAGE_WIDTH = 794, PAGE_HEIGHT = 1123

  let maxW = 0, totalH = 0
  for (const sheet of sheets) {
    const sw = sheet.colWidths.reduce((a, b) => a + b, 0) + MARGIN * 2
    const sh = sheet.rowHeights.reduce((a, b) => a + b, 0) + TITLE_SPACE + MARGIN * 2 + SHEET_GAP
    if (sw > maxW) maxW = sw
    totalH += sh
  }

  const canvasW = Math.max(maxW, PAGE_WIDTH) * SCALE
  const canvasH = totalH * SCALE
  console.log(`[xlsx-renderer] Canvas: ${canvasW}x${canvasH}, ~${Math.ceil(canvasH / (PAGE_HEIGHT * SCALE))} pages`)

  // Use segmented rendering if canvas is too tall
  const MAX_CANVAS_H = 16000
  const useSegmented = canvasH > MAX_CANVAS_H

  if (!useSegmented) {
    const master = document.createElement('canvas')
    master.width = canvasW; master.height = canvasH
    const ctx = master.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvasW, canvasH)

    let currentY = MARGIN
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i]
      const sheetTableWidth = sheet.colWidths.reduce((a, b) => a + b, 0)
      const offsetX = Math.max(MARGIN, (PAGE_WIDTH - sheetTableWidth) / 2)
      ctx.save(); ctx.scale(SCALE, SCALE)
      drawSheet(ctx, sheet, sheet.name, offsetX, currentY + TITLE_SPACE)
      ctx.restore()
      currentY += TITLE_SPACE + sheet.rowHeights.reduce((a, b) => a + b, 0) + SHEET_GAP + MARGIN
      onProgress?.(0.5 + 0.3 * (i + 1) / sheets.length, 'Sheet ' + (i + 1))
      await new Promise(r => setTimeout(r, 0))
    }

    onProgress?.(0.8, 'Creating pages…')
    const pageHScaled = PAGE_HEIGHT * SCALE
    const pages: RenderedPage[] = []
    let y = 0
    while (y < canvasH) {
      const ph = Math.min(pageHScaled, canvasH - y)
      const pc = document.createElement('canvas')
      pc.width = canvasW; pc.height = ph
      const pctx = pc.getContext('2d')!
      pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, pc.width, pc.height)
      pctx.drawImage(master, 0, y, canvasW, ph, 0, 0, canvasW, ph)
      pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: canvasW / SCALE, height: ph / SCALE })
      y += ph
      onProgress?.(0.8 + 0.2 * pages.length / Math.ceil(canvasH / pageHScaled), 'Page ' + pages.length)
      await new Promise(r => setTimeout(r, 0))
    }
    console.log(`[xlsx-renderer] Generated ${pages.length} pages`)
    onProgress?.(1, 'Done')
    return pages
  } else {
    console.log('[xlsx-renderer] Using segmented rendering')
    const pages: RenderedPage[] = []
    const pageHScaled = PAGE_HEIGHT * SCALE
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i]
      const sheetTableWidth = sheet.colWidths.reduce((a, b) => a + b, 0)
      const sheetHeight = sheet.rowHeights.reduce((a, b) => a + b, 0)
      const segW = Math.max(sheetTableWidth + MARGIN * 2, PAGE_WIDTH) * SCALE
      const segH = (sheetHeight + TITLE_SPACE + MARGIN * 2 + SHEET_GAP) * SCALE
      const segCanvas = document.createElement('canvas')
      segCanvas.width = segW; segCanvas.height = segH
      const segCtx = segCanvas.getContext('2d')!
      segCtx.fillStyle = '#ffffff'; segCtx.fillRect(0, 0, segW, segH)
      const offsetX = Math.max(MARGIN, (PAGE_WIDTH - sheetTableWidth) / 2)
      segCtx.save(); segCtx.scale(SCALE, SCALE)
      drawSheet(segCtx, sheet, sheet.name, offsetX, MARGIN + TITLE_SPACE)
      segCtx.restore()
      let sy = 0
      while (sy < segH) {
        const ph = Math.min(pageHScaled, segH - sy)
        const pc = document.createElement('canvas')
        pc.width = segW; pc.height = ph
        const pctx = pc.getContext('2d')!
        pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, pc.width, pc.height)
        pctx.drawImage(segCanvas, 0, sy, segW, ph, 0, 0, segW, ph)
        pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: segW / SCALE, height: ph / SCALE })
        sy += ph
      }
      onProgress?.(0.5 + 0.4 * (i + 1) / sheets.length, 'Sheet ' + (i + 1) + ' → ' + pages.length + ' pages')
      await new Promise(r => setTimeout(r, 0))
    }
    console.log(`[xlsx-renderer] Generated ${pages.length} pages (segmented)`)
    onProgress?.(1, 'Done')
    return pages
  }
}
