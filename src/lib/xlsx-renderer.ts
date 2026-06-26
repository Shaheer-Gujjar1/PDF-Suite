'use client'

/**
 * Main-thread XLSX → page images renderer.
 *
 * Strategy: Parse with SheetJS → generate styled HTML table (all inline CSS,
 * no oklch) → render in isolated iframe → capture with html2canvas called
 * from the iframe's own window context → split into A4 pages.
 *
 * This lets the browser's native CSS engine handle text wrapping, alignment,
 * colors, borders, merges — much more accurate than manual canvas drawing.
 */

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'

let xlsxPromise: Promise<any> | null = null
let h2cPromise: Promise<any> | null = null

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

function loadH2C(): Promise<any> {
  if (h2cPromise) return h2cPromise
  h2cPromise = loadScript(HTML2CANVAS_URL, () => !!(window as any).html2canvas).then(() => (window as any).html2canvas)
  return h2cPromise
}

export interface RenderedPage { dataUrl: string; width: number; height: number }
export interface RenderProgress { (progress: number, message: string): void }

function argbToCss(hex: string): string | null {
  if (!hex || hex === '00000000' || hex === 'FFFFFFFF') return null
  const h = hex.replace(/^FF/, '')
  if (h.length === 6) {
    return `rgb(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)})`
  }
  return null
}

const THEME_COLORS = ['#ffffff','#000000','#e7e6e6','#44546a','#5b9bd5','#ed7d31','#a5a5a5','#ffc000','#4472c4','#70ad47']

function colorFromObj(obj: any): string | null {
  if (!obj) return null
  if (obj.rgb) return argbToCss(obj.rgb)
  if (obj.theme !== undefined && obj.theme < THEME_COLORS.length) return THEME_COLORS[obj.theme]
  if (obj.indexed !== undefined && obj.indexed < 64) {
    // Standard indexed palette (simplified)
    const palette = ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#800000','#008000','#000080','#808000','#800080','#008080','#c0c0c0','#808080','#9999ff','#993366','#ffffcc','#ccffff','#660066','#ff8080','#0066cc','#cccccc','#000080','#ff00ff','#ffff00','#00ffff','#800080','#800000','#008080','#0000ff','#00ccff','#ccffff','#ccffcc','#ffff99','#99cc66','#99ccff','#ff6666','#cccc99','#999933','#ffcc00','#ffffff']
    if (obj.indexed < palette.length) return palette[obj.indexed]
  }
  return null
}

function borderCss(border: any, side: string): string {
  if (!border || !border[side] || !border[side].style) return `border-${side}:1px solid #d0d0d0;`
  const b = border[side]
  const w = b.style === 'medium' ? '2px' : b.style === 'thick' ? '3px' : '1px'
  const c = colorFromObj(b.color) || '#000000'
  const style = b.style === 'dashed' ? 'dashed' : b.style === 'dotted' ? 'dotted' : 'solid'
  return `border-${side}:${w} ${style} ${c};`
}

/**
 * Generate fully-styled HTML table from a worksheet.
 * Every cell gets inline CSS — no external stylesheets, no oklch.
 */
function sheetToStyledHtml(ws: any, XLSX: any, sheetName: string): string {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const merges = ws['!merges'] || []
  const cols = ws['!cols'] || []
  const rows = ws['!rows'] || []

  // Merge lookup
  const mergeMap: Record<string, { rs: number; cs: number; hidden: boolean }> = {}
  for (const m of merges) {
    mergeMap[`${m.s.r},${m.s.c}`] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1, hidden: false }
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (r !== m.s.r || c !== m.s.c)
          mergeMap[`${r},${c}`] = { rs: 0, cs: 0, hidden: true }
  }

  let html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:14px;font-weight:bold;color:#2F5496;padding:10px 0;border-bottom:2px solid #2F5496;margin-bottom:8px;">${sheetName}</div>`
  html += '<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11px;table-layout:fixed;">'

  // Column widths
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c]
    const w = col && col.wpx ? col.wpx : 90
    html += `<col style="width:${w}px;">`
  }

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r]
    const rh = row && row.hpt ? Math.round(row.hpt * 1.333) : 22
    html += `<tr style="height:${rh}px;">`

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[cellAddr]
      const merge = mergeMap[`${r},${c}`]

      if (merge && merge.hidden) continue

      const rs = merge ? merge.rs : 1
      const cs = merge ? merge.cs : 1
      const attrs = (rs > 1 ? ` rowspan="${rs}"` : '') + (cs > 1 ? ` colspan="${cs}"` : '')

      // Build inline styles
      const styles: string[] = ['border-collapse:collapse', 'padding:3px 5px', 'vertical-align:middle', 'box-sizing:border-box']

      let text = '&nbsp;'
      let textAlign = 'left'

      if (cell) {
        const s = cell.s || {}
        const font = s.font || {}
        const fill = s.fill
        const align = s.alignment || {}
        const border = s.border || {}

        // Font
        if (font.bold) styles.push('font-weight:bold')
        if (font.italic) styles.push('font-style:italic')
        if (font.underline) styles.push('text-decoration:underline')
        if (font.sz) styles.push(`font-size:${font.sz}px`)
        const fc = colorFromObj(font.color)
        if (fc) styles.push(`color:${fc}`)

        // Background
        const bg = colorFromObj(fill?.fgColor)
        if (bg) styles.push(`background:${bg}`)

        // Alignment
        if (align.horizontal) { textAlign = align.horizontal; styles.push(`text-align:${textAlign}`) }
        else if (cell.t === 'n') { textAlign = 'right'; styles.push('text-align:right') }
        else if (cell.t === 'b') { textAlign = 'center'; styles.push('text-align:center') }
        else styles.push(`text-align:${textAlign}`)

        if (align.vertical) styles.push(`vertical-align:${align.vertical}`)
        if (align.wrapText) styles.push('white-space:normal', 'word-wrap:break-word', 'overflow-wrap:break-word')
        else styles.push('white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis')

        // Borders
        styles.push(borderCss(border, 'top'))
        styles.push(borderCss(border, 'bottom'))
        styles.push(borderCss(border, 'left'))
        styles.push(borderCss(border, 'right'))

        // Content
        if (cell.w !== undefined && cell.w !== null) text = String(cell.w)
        else if (cell.v !== undefined && cell.v !== null) text = String(cell.v)
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (!text) text = '&nbsp;'
      } else {
        // Empty cell — still draw borders
        styles.push('border-top:1px solid #d0d0d0')
        styles.push('border-bottom:1px solid #d0d0d0')
        styles.push('border-left:1px solid #d0d0d0')
        styles.push('border-right:1px solid #d0d0d0')
      }

      html += `<td${attrs} style="${styles.join(';')}">${text}</td>`
    }
    html += '</tr>'
  }
  html += '</table>'
  return html
}

export async function renderXlsxToPages(
  file: File,
  onProgress?: RenderProgress
): Promise<RenderedPage[]> {
  onProgress?.(0.1, 'Loading engines…')
  const XLSX = await loadXLSX()
  await loadH2C()

  onProgress?.(0.2, 'Parsing spreadsheet…')
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellDates: true, cellNF: true })

  // Build styled HTML for all sheets
  let allHtml = ''
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const ws = wb.Sheets[wb.SheetNames[i]]
    if (!ws['!ref']) continue
    allHtml += sheetToStyledHtml(ws, XLSX, wb.SheetNames[i])
    allHtml += '<div style="height:24px;"></div>'
    onProgress?.(0.2 + 0.2 * (i + 1) / wb.SheetNames.length, 'Sheet ' + (i + 1))
  }
  if (!allHtml) throw new Error('No sheets found')

  onProgress?.(0.5, 'Rendering…')

  // A4 dimensions
  const PAGE_WIDTH = 794
  const PAGE_HEIGHT = 1123
  const SCALE = 2

  // Create isolated iframe — this is the key: the iframe has NO app CSS,
  // only our inline-styled table. html2canvas clones the IFRAME's document.
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT * 2}px;border:none;`
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow!.document
  iframeDoc.open()
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#fff; padding:40px; }
</style>
</head><body><div id="content">${allHtml}</div></body></html>`)
  iframeDoc.close()

  const content = iframeDoc.getElementById('content')!

  try {
    // Wait for layout
    await new Promise(r => setTimeout(r, 300))

    const contentHeight = content.scrollHeight

    // CRITICAL: call html2canvas from the IFRAME's window, not the main window.
    // This makes html2canvas clone the iframe's document (which has no oklch),
    // not the main app's document (which has oklch that breaks html2canvas).
    const iframeWin = iframe.contentWindow as any

    // If html2canvas isn't on the iframe's window, inject it
    if (!iframeWin.html2canvas) {
      const h2cScript = iframeDoc.createElement('script')
      h2cScript.src = HTML2CANVAS_URL
      iframeDoc.head.appendChild(h2cScript)
      await new Promise(r => setTimeout(r, 200)) // Wait for it to load
    }

    const h2c = iframeWin.html2canvas || (window as any).html2canvas

    const canvas = await h2c(content, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: PAGE_WIDTH - 80,
      height: contentHeight,
      windowWidth: PAGE_WIDTH,
    })

    onProgress?.(0.7, 'Splitting into pages…')

    // Split into A4 pages
    const ctx = canvas.getContext('2d')!
    const cw = canvas.width
    const ch = canvas.height
    const pageHScaled = PAGE_HEIGHT * SCALE
    const pages: RenderedPage[] = []

    let y = 0
    while (y < ch) {
      const idealBreak = y + pageHScaled
      const remaining = ch - y

      if (idealBreak >= ch) {
        // Last page
        const pc = document.createElement('canvas')
        pc.width = cw
        pc.height = Math.max(1, remaining)
        const pctx = pc.getContext('2d')!
        pctx.fillStyle = '#fff'
        pctx.fillRect(0, 0, pc.width, pc.height)
        pctx.drawImage(canvas, 0, y, cw, remaining, 0, 0, cw, remaining)
        pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: cw / SCALE, height: remaining / SCALE })
        break
      }

      // Find safe break point (white row)
      let safeY = idealBreak
      const searchRange = 60 * SCALE
      for (let offset = 0; offset <= searchRange; offset += SCALE) {
        for (const cy of [idealBreak + offset, idealBreak - offset]) {
          if (cy < y || cy >= ch) continue
          let white = true
          const row = ctx.getImageData(0, cy, cw, 1).data
          for (let x = 0; x < cw; x += 4) {
            if (row[x*4] < 250 || row[x*4+1] < 250 || row[x*4+2] < 250) { white = false; break }
          }
          if (white) { safeY = cy; break }
        }
        if (safeY !== idealBreak) break
      }

      const ph = safeY - y
      const pc = document.createElement('canvas')
      pc.width = cw
      pc.height = ph
      const pctx = pc.getContext('2d')!
      pctx.fillStyle = '#fff'
      pctx.fillRect(0, 0, pc.width, pc.height)
      pctx.drawImage(canvas, 0, y, cw, ph, 0, 0, cw, ph)
      pages.push({ dataUrl: pc.toDataURL('image/jpeg', 0.92), width: cw / SCALE, height: ph / SCALE })

      y = safeY
      onProgress?.(0.7 + 0.3 * pages.length / Math.ceil(ch / pageHScaled), 'Page ' + pages.length)
      await new Promise(r => setTimeout(r, 0)) // Yield to UI
    }

    onProgress?.(1, 'Done')
    return pages
  } finally {
    document.body.removeChild(iframe)
  }
}
