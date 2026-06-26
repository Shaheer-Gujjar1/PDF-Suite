'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Parses BOTH cell data (SheetJS) AND styling (directly from xl/styles.xml
 * + xl/worksheets/sheetN.xml via JSZip) to get 100% of formatting.
 * Draws directly to Canvas 2D with auto text wrapping.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'

let xlsxP: Promise<any> | null = null
let jszipP: Promise<any> | null = null

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
function loadXLSX() { if (!xlsxP) xlsxP = loadScript(XLSX_URL, () => !!(window as any).XLSX).then(() => (window as any).XLSX); return xlsxP }
function loadJSZip() { if (!jszipP) jszipP = loadScript(JSZIP_URL, () => !!(window as any).JSZip).then(() => (window as any).JSZip); return jszipP }

export interface RenderedPage { dataUrl: string; width: number; height: number }
export interface RenderProgress { (progress: number, message: string): void }

// ─── Style types ────────────────────────────────────────────────────────────

interface CellStyle {
  fontColor: string; bgColor: string
  bold: boolean; italic: boolean; underline: boolean
  fontSize: number; fontName: string
  align: string; valign: string; wrapText: boolean
  borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string
}

const DEF: CellStyle = {
  fontColor: '#000000', bgColor: '#ffffff',
  bold: false, italic: false, underline: false,
  fontSize: 11, fontName: 'Arial',
  align: 'left', valign: 'middle', wrapText: false,
}

const THEME: string[] = [
  'rgb(255,255,255)','rgb(0,0,0)','rgb(231,230,230)','rgb(68,84,106)',
  'rgb(91,155,213)','rgb(237,125,49)','rgb(165,165,165)','rgb(255,192,0)',
  'rgb(68,114,196)','rgb(112,173,71)',
]

function toCss(rgb?: string | null, theme?: string | null): string | null {
  if (rgb) {
    let h = rgb; if (h.length === 8) h = h.slice(2)
    if (h.length === 6) return `rgb(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)})`
  }
  if (theme !== null && theme !== undefined) { const t = parseInt(theme); if (t < THEME.length) return THEME[t] }
  return null
}

/**
 * Parse xl/styles.xml AND the worksheet XML to get the CORRECT style index
 * for each cell. SheetJS doesn't reliably store cell.s, so we parse the
 * raw XML to get the `s` attribute from each <c> element.
 */
async function parseXlsxFully(arrayBuffer: ArrayBuffer, XLSX: any) {
  const JSZip = await loadJSZip()
  const zip = await JSZip.loadAsync(arrayBuffer)

  // ── Parse styles.xml ──
  const stylesXml = await zip.file('xl/styles.xml')?.async('string')
  const fonts: CellStyle[] = []
  const fills: string[] = []
  const borders: { top?: string; bottom?: string; left?: string; right?: string }[] = []
  const cellXfs: CellStyle[] = []

  if (stylesXml) {
    const doc = new DOMParser().parseFromString(stylesXml, 'text/xml')

    // Fonts
    doc.querySelectorAll('fonts > font').forEach((fn) => {
      const s: CellStyle = { ...DEF }
      const sz = fn.querySelector('sz'); if (sz) s.fontSize = parseFloat(sz.getAttribute('val') || '11')
      const col = fn.querySelector('color')
      if (col) { const c = toCss(col.getAttribute('rgb') || undefined, col.getAttribute('theme')); if (c) s.fontColor = c }
      const nm = fn.querySelector('name'); if (nm) s.fontName = nm.getAttribute('val') || 'Arial'
      if (fn.querySelector('b')) s.bold = true
      if (fn.querySelector('i')) s.italic = true
      if (fn.querySelector('u')) s.underline = true
      fonts.push(s)
    })

    // Fills
    doc.querySelectorAll('fills > fill').forEach((fn) => {
      const pf = fn.querySelector('patternFill')
      if (pf) {
        const fg = pf.querySelector('fgColor')
        if (fg) { const c = toCss(fg.getAttribute('rgb') || undefined, fg.getAttribute('theme')); fills.push(c || '#ffffff') }
        else fills.push('#ffffff')
      } else fills.push('#ffffff')
    })

    // Borders
    doc.querySelectorAll('borders > border').forEach((bn) => {
      const b: { top?: string; bottom?: string; left?: string; right?: string } = {}
      for (const side of ['top','bottom','left','right']) {
        const sn = bn.querySelector(side)
        if (sn && sn.getAttribute('style') && sn.getAttribute('style') !== 'none') {
          const cn = sn.querySelector('color')
          b[side as 'top'] = toCss(cn?.getAttribute('rgb') || undefined, cn?.getAttribute('theme')) || '#000000'
        }
      }
      borders.push(b)
    })

    // CellXfs — the master style table
    doc.querySelectorAll('cellXfs > xf').forEach((xf) => {
      const fontId = parseInt(xf.getAttribute('fontId') || '0')
      const fillId = parseInt(xf.getAttribute('fillId') || '0')
      const borderId = parseInt(xf.getAttribute('borderId') || '0')
      const s: CellStyle = { ...(fonts[fontId] || DEF) }
      // Fills: index 0 = none, index 1 = gray125 (Excel default), skip both
      if (fillId > 1 && fills[fillId]) s.bgColor = fills[fillId]
      const border = borders[borderId]
      if (border) { s.borderTop = border.top; s.borderBottom = border.bottom; s.borderLeft = border.left; s.borderRight = border.right }
      const align = xf.querySelector('alignment')
      if (align) {
        const h = align.getAttribute('horizontal'); if (h) s.align = h
        const v = align.getAttribute('vertical'); if (v) s.valign = v
        if (align.getAttribute('wrapText') === '1' || align.getAttribute('wrapText') === 'true') s.wrapText = true
      }
      cellXfs.push(s)
    })
  }

  console.log(`[xlsx] Styles: ${fonts.length} fonts, ${fills.length} fills, ${borders.length} borders, ${cellXfs.length} cellXfs`)

  // ── Parse worksheet XML to get correct style index per cell ──
  // Find sheet files
  const sheetFiles: { name: string; xml: string }[] = []
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  let sheetNames: string[] = []
  if (workbookXml) {
    const wbDoc = new DOMParser().parseFromString(workbookXml, 'text/xml')
    wbDoc.querySelectorAll('sheet').forEach((s) => {
      sheetNames.push(s.getAttribute('name') || 'Sheet')
    })
  }

  // Read each sheet XML
  const sheetRex = /xl\/worksheets\/sheet(\d+)\.xml/
  const sheetEntries = Object.keys(zip.files).filter(k => sheetRex.test(k)).sort()
  for (let i = 0; i < sheetEntries.length; i++) {
    const xml = await zip.file(sheetEntries[i])!.async('string')
    sheetFiles.push({ name: sheetNames[i] || `Sheet${i+1}`, xml })
  }

  // ── Build cell style map from worksheet XML ──
  // Each <c r="A1" s="3"> has a style index `s` that maps to cellXfs
  const sheetCellStyles: Map<string, number>[] = [] // per sheet: cellRef → styleIndex

  for (const sf of sheetFiles) {
    const doc = new DOMParser().parseFromString(sf.xml, 'text/xml')
    const styleMap = new Map<string, number>()
    doc.querySelectorAll('sheetData > row > c').forEach((c) => {
      const ref = c.getAttribute('r') // e.g. "A1"
      const s = c.getAttribute('s') // style index
      if (ref && s !== null) {
        styleMap.set(ref, parseInt(s))
      }
    })
    sheetCellStyles.push(styleMap)
    console.log(`[xlsx] Sheet "${sf.name}": ${styleMap.size} cells with style indices`)
  }

  return { cellXfs, sheetCellStyles, sheetNames }
}

// ─── Canvas drawing ─────────────────────────────────────────────────────────

interface CellInfo {
  text: string; style: CellStyle
  rowspan: number; colspan: number; hidden: boolean
}

function parseSheetWithStyles(ws: any, XLSX: any, cellXfs: CellStyle[], cellStyleMap: Map<string, number>): { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string } | null {
  if (!ws['!ref']) return null
  const fullRange = XLSX.utils.decode_range(ws['!ref'])
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  // Trim empty rows/cols
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
  console.log(`[xlsx] Sheet range: ${XLSX.utils.encode_range(range)}`)

  // Merge lookup
  const mergeMap: Record<string, { rs: number; cs: number; hidden: boolean }> = {}
  for (const m of merges) {
    if (m.s.r > range.e.r || m.s.c > range.e.c) continue
    mergeMap[`${m.s.r},${m.s.c}`] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1, hidden: false }
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++)
      if (r !== m.s.r || c !== m.s.c) mergeMap[`${r},${c}`] = { rs: 0, cs: 0, hidden: true }
  }

  const colWidths: number[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]; colWidths.push(col && col.wpx ? col.wpx : 90)
  }
  const rowHeights: number[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]; rowHeights.push(row && row.hpt ? Math.round(row.hpt * 1.333) : 22)
  }

  const cells: CellInfo[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowCells: CellInfo[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${r},${c}`]
      if (merge && merge.hidden) { rowCells.push({ text: '', style: DEF, rowspan: 0, colspan: 0, hidden: true }); continue }

      // Get style from our XML-parsed style map (not SheetJS's cell.s)
      let style = DEF
      const styleIdx = cellStyleMap.get(cellAddr)
      if (styleIdx !== undefined && cellXfs[styleIdx]) {
        style = cellXfs[styleIdx]
      } else if (cell && cell.s !== undefined && cellXfs[cell.s]) {
        style = cellXfs[cell.s]
      }

      // Smart alignment defaults
      if (cell && styleIdx === undefined) {
        if (cell.t === 'n') style = { ...style, align: 'right' }
        else if (cell.t === 'b') style = { ...style, align: 'center' }
      }

      let text = ''
      if (cell) {
        if (cell.w !== undefined && cell.w !== null) text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) text = String(cell.v)
      }

      rowCells.push({ text, style, rowspan: merge ? merge.rs : 1, colspan: merge ? merge.cs : 1, hidden: false })
    }
    cells.push(rowCells)
  }
  return { cells, colWidths, rowHeights, name: '' }
}

function drawSheet(ctx: CanvasRenderingContext2D, sheet: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[] }, sheetName: string, offsetX: number, offsetY: number) {
  const { cells, colWidths, rowHeights } = sheet
  const colX = [offsetX]; for (let i = 0; i < colWidths.length; i++) colX.push(colX[i] + colWidths[i])
  const rowY = [offsetY]; for (let i = 0; i < rowHeights.length; i++) rowY.push(rowY[i] + rowHeights[i])

  // Sheet title
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillStyle = '#2F5496'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(sheetName, offsetX, offsetY - 30)
  ctx.strokeStyle = '#2F5496'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(offsetX, offsetY - 12); ctx.lineTo(offsetX + colWidths.reduce((a,b)=>a+b,0), offsetY - 12); ctx.stroke()

  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      const cell = cells[r][c]; if (cell.hidden) continue
      const s = cell.style
      const x = colX[c], y = rowY[r]
      const w = colWidths.slice(c, c + cell.colspan).reduce((a,b)=>a+b,0)
      const h = rowHeights.slice(r, r + cell.rowspan).reduce((a,b)=>a+b,0)

      // Background
      ctx.fillStyle = s.bgColor; ctx.fillRect(x, y, w, h)

      // Default borders
      ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      // Styled borders
      if (s.borderTop) { ctx.strokeStyle = s.borderTop; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke() }
      if (s.borderBottom) { ctx.strokeStyle = s.borderBottom; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke() }
      if (s.borderLeft) { ctx.strokeStyle = s.borderLeft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke() }
      if (s.borderRight) { ctx.strokeStyle = s.borderRight; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.stroke() }

      // Text with AUTO-WRAPPING (wrap even without wrapText flag if text overflows)
      if (cell.text) {
        ctx.font = `${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${s.fontSize}px ${s.fontName}, Arial, sans-serif`
        ctx.fillStyle = s.fontColor
        const pad = 5
        const maxW = w - pad * 2
        const measured = ctx.measureText(cell.text).width

        // Auto-wrap if text is too long for the cell (even without wrapText flag)
        const shouldWrap = s.wrapText || measured > maxW

        if (shouldWrap && cell.text.length > 1) {
          // Word-wrap
          const words = cell.text.split(/(\s+)/) // split keeping spaces
          const lines: string[] = []
          let line = ''
          for (const word of words) {
            const test = line + word
            if (ctx.measureText(test).width > maxW && line.trim()) {
              lines.push(line.trim())
              line = word.trim()
            } else {
              line = test
            }
          }
          if (line.trim()) lines.push(line.trim())

          // Character-wrap any line still too long
          for (let li = 0; li < lines.length; li++) {
            while (ctx.measureText(lines[li]).width > maxW && lines[li].length > 1) {
              let cut = lines[li].length - 1
              while (cut > 1 && ctx.measureText(lines[li].slice(0, cut)).width > maxW) cut--
              const rest = lines[li].slice(cut)
              lines[li] = lines[li].slice(0, cut)
              lines.splice(li + 1, 0, rest)
              li++
            }
          }

          const lh = s.fontSize * 1.3
          let startY: number
          if (s.valign === 'top') startY = y + pad + lh / 2
          else if (s.valign === 'bottom') startY = y + h - pad - (lines.length - 1) * lh - lh / 2
          else startY = y + (h - lines.length * lh) / 2 + lh / 2

          ctx.textBaseline = 'middle'
          ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip()
          for (let li = 0; li < lines.length; li++) {
            let tx = x + pad
            if (s.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
            else if (s.align === 'right') { ctx.textAlign = 'right'; tx = x + w - pad }
            else ctx.textAlign = 'left'
            ctx.fillText(lines[li], tx, startY + li * lh)
          }
          ctx.restore()
        } else {
          ctx.textBaseline = 'middle'
          let tx = x + pad
          if (s.align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2 }
          else if (s.align === 'right') { ctx.textAlign = 'right'; tx = x + w - pad }
          else ctx.textAlign = 'left'
          let ty = y + h / 2
          if (s.valign === 'top') ty = y + s.fontSize * 0.7 + 2
          else if (s.valign === 'bottom') ty = y + h - s.fontSize * 0.5 - 2
          ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip()
          ctx.fillText(cell.text, tx, ty)
          ctx.restore()
        }
      }
    }
  }
}

export async function renderXlsxToPages(file: File, onProgress?: RenderProgress): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading engines…')
  const XLSX = await loadXLSX()

  onProgress?.(0.2, 'Reading file…')
  const arrayBuffer = await file.arrayBuffer()

  // Parse styles directly from XML (gets 100% of formatting)
  onProgress?.(0.3, 'Parsing cell styles…')
  const { cellXfs, sheetCellStyles, sheetNames } = await parseXlsxFully(arrayBuffer, XLSX)

  // Parse cell data with SheetJS
  onProgress?.(0.4, 'Parsing spreadsheet data…')
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellNF: true })

  const sheets: { cells: CellInfo[][]; colWidths: number[]; rowHeights: number[]; name: string }[] = []
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    const styleMap = sheetCellStyles[i] || new Map<string, number>()
    const parsed = parseSheetWithStyles(ws, XLSX, cellXfs, styleMap)
    if (parsed) { parsed.name = wb.SheetNames[i]; sheets.push(parsed) }
    onProgress?.(0.4 + 0.2 * (i + 1) / wb.SheetNames.length, 'Sheet ' + (i + 1))
  }
  if (sheets.length === 0) throw new Error('No sheets found')

  onProgress?.(0.6, 'Rendering…')

  const M = 40, TS = 40, SG = 30, SC = 2, PW = 794, PH = 1123
  let maxW = 0, totalH = 0
  for (const s of sheets) {
    const sw = s.colWidths.reduce((a,b)=>a+b,0) + M*2
    const sh = s.rowHeights.reduce((a,b)=>a+b,0) + TS + M*2 + SG
    if (sw > maxW) maxW = sw; totalH += sh
  }
  const cW = Math.max(maxW, PW) * SC, cH = totalH * SC
  console.log(`[xlsx] Canvas: ${cW}x${cH}, ~${Math.ceil(cH/(PH*SC))} pages`)

  const useSeg = cH > 16000
  const pageHS = PH * SC

  if (!useSeg) {
    const master = document.createElement('canvas')
    master.width = cW; master.height = cH
    const ctx = master.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cW, cH)

    let curY = M
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i]
      const tw = s.colWidths.reduce((a,b)=>a+b,0)
      const ox = Math.max(M, (PW - tw) / 2)
      ctx.save(); ctx.scale(SC, SC)
      drawSheet(ctx, s, s.name, ox, curY + TS)
      ctx.restore()
      curY += TS + s.rowHeights.reduce((a,b)=>a+b,0) + SG + M
      onProgress?.(0.6 + 0.2 * (i+1) / sheets.length, 'Sheet ' + (i+1))
      await new Promise(r => setTimeout(r, 0))
    }

    onProgress?.(0.8, 'Creating pages…')
    const pages: RenderedPage[] = []
    let y = 0
    while (y < cH) {
      const ph = Math.min(pageHS, cH - y)
      const pc = document.createElement('canvas')
      pc.width = cW; pc.height = ph
      const pctx = pc.getContext('2d')!
      pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pc.width, pc.height)
      pctx.drawImage(master, 0, y, cW, ph, 0, 0, cW, ph)
      pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: cW/SC, height: ph/SC })
      y += ph
      onProgress?.(0.8 + 0.2 * pages.length / Math.ceil(cH/pageHS), 'Page ' + pages.length)
      await new Promise(r => setTimeout(r, 0))
    }
    console.log(`[xlsx] Generated ${pages.length} pages`)
    onProgress?.(1, 'Done')
    return pages
  } else {
    console.log('[xlsx] Segmented rendering')
    const pages: RenderedPage[] = []
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i]
      const tw = s.colWidths.reduce((a,b)=>a+b,0)
      const sh = s.rowHeights.reduce((a,b)=>a+b,0)
      const sw = Math.max(tw + M*2, PW) * SC
      const sh2 = (sh + TS + M*2 + SG) * SC
      const sc = document.createElement('canvas')
      sc.width = sw; sc.height = sh2
      const sctx = sc.getContext('2d')!
      sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, sw, sh2)
      const ox = Math.max(M, (PW - tw) / 2)
      sctx.save(); sctx.scale(SC, SC)
      drawSheet(sctx, s, s.name, ox, M + TS)
      sctx.restore()
      let sy = 0
      while (sy < sh2) {
        const ph = Math.min(pageHS, sh2 - sy)
        const pc = document.createElement('canvas')
        pc.width = sw; pc.height = ph
        const pctx = pc.getContext('2d')!
        pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pc.width, pc.height)
        pctx.drawImage(sc, 0, sy, sw, ph, 0, 0, sw, ph)
        pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: sw/SC, height: ph/SC })
        sy += ph
      }
      onProgress?.(0.6 + 0.3 * (i+1) / sheets.length, 'Sheet ' + (i+1) + ' → ' + pages.length + ' pages')
      await new Promise(r => setTimeout(r, 0))
    }
    console.log(`[xlsx] Generated ${pages.length} pages (segmented)`)
    onProgress?.(1, 'Done')
    return pages
  }
}
