'use client'

/**
 * OCR helper using Tesseract.js (pure WASM OCR, runs entirely in-browser).
 *
 * Used by the PDF-to-Word tool to extract selectable text from scanned
 * (image-only) PDFs. pdf.js's getTextContent() returns nothing for scanned
 * pages, so we OCR the rendered page image instead and use the word
 * bounding boxes to build a positioned, selectable text overlay in the DOCX.
 *
 * Tesseract.js spawns its own internal Web Worker, so recognition runs
 * off the main thread. Language data is fetched from a CDN on first use.
 */

import Tesseract from 'tesseract.js'

export interface OcrWord {
  text: string
  /** Bounding box in image pixel coordinates (top-left origin). */
  x0: number
  y0: number
  x1: number
  y1: number
  confidence: number
}

export interface OcrLine {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  words: OcrWord[]
}

export interface OcrResult {
  words: OcrWord[]
  lines: OcrLine[]
  text: string
}

let workerPromise: Promise<Tesseract.Worker> | null = null

/** CDN paths for Tesseract.js core (WASM) + language data. */
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0'
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

async function getWorker(): Promise<Tesseract.Worker> {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    const worker = await Tesseract.createWorker('eng', 1, {
      corePath: TESSERACT_CORE_PATH,
      langPath: TESSERACT_LANG_PATH,
      logger: () => {},
    })
    return worker
  })()
  return workerPromise
}

/**
 * Run OCR on a canvas (or anything Tesseract can ingest: canvas, dataURL,
 * image element). Returns word + line bounding boxes in image pixel coords.
 */
export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<OcrResult> {
  const worker = await getWorker()
  // Convert canvas to a blob and pass to Tesseract — blobs are handled
  // more reliably than dataURLs or raw canvas elements across versions.
  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  )
  const { data } = await worker.recognize(blob)
  onProgress?.(1)

  const words: OcrWord[] = []
  const lines: OcrLine[] = []
  const rawData = data as any

  // Tesseract.js v7's data.tsv/hocr are empty by default, but data.text is
  // populated. Try to extract words from the blocks tree (v7 returns blocks
  // → paragraphs → lines → words). If blocks don't have word data, fall back
  // to putting the full page text as a single "word" covering the page — the
  // worker will create one invisible text box with all the text, which is
  // still fully selectable (Ctrl+A) and searchable (Ctrl+F).
  if (Array.isArray(rawData.blocks)) {
    for (const block of rawData.blocks) {
      if (!block || !block.paragraphs) continue
      for (const para of block.paragraphs) {
        if (!para || !para.lines) continue
        for (const ln of para.lines) {
          if (!ln || !ln.words) continue
          for (const w of ln.words) {
            if (!w || !w.text || !w.text.trim()) continue
            const bbox = w.bbox || {}
            words.push({
              text: w.text.trim(),
              x0: bbox.x0 || 0,
              y0: bbox.y0 || 0,
              x1: bbox.x1 || 0,
              y1: bbox.y1 || 0,
              confidence: typeof w.confidence === 'number' ? w.confidence : 0,
            })
          }
        }
      }
    }
  }

  // Fallback: if blocks traversal found no word bboxes but we have text,
  // split the text into lines and create one "word" per line, stacked
  // vertically down the page. Each line becomes a white text box with
  // visible editable text — selectable, editable, and covering the image
  // text line-by-line. Estimate line height from the number of non-empty
  // lines vs. canvas height.
  if (words.length === 0 && data.text && data.text.trim()) {
    const textLines = data.text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
    if (textLines.length > 0) {
      // Reserve top 8% as margin, distribute lines in the remaining 84%.
      const topMargin = canvas.height * 0.08
      const usableH = canvas.height * 0.84
      const lineH = Math.min(usableH / textLines.length, canvas.height * 0.05)
      const fontSize = lineH * 0.75
      for (let i = 0; i < textLines.length; i++) {
        words.push({
          text: textLines[i],
          x0: canvas.width * 0.05,
          y0: topMargin + i * lineH,
          x1: canvas.width * 0.95,
          y1: topMargin + (i + 1) * lineH,
          confidence: data.confidence || 0,
        })
      }
    }
  }


  // Group words into lines by their top coordinate (rounded to font-size/2).
  if (words.length > 0) {
    const lineMap = new Map<number, OcrWord[]>()
    for (const w of words) {
      const avgH = (w.y1 - w.y0) || 10
      const lineKey = Math.round(w.y0 / (avgH * 0.5))
      if (!lineMap.has(lineKey)) lineMap.set(lineKey, [])
      lineMap.get(lineKey)!.push(w)
    }
    const sortedKeys = [...lineMap.keys()].sort((a, b) => a - b)
    for (const key of sortedKeys) {
      const ws = lineMap.get(key)!.sort((a, b) => a.x0 - b.x0)
      const lineText = ws.map((w) => w.text).join(' ')
      lines.push({
        text: lineText,
        x0: Math.min(...ws.map((w) => w.x0)),
        y0: Math.min(...ws.map((w) => w.y0)),
        x1: Math.max(...ws.map((w) => w.x1)),
        y1: Math.max(...ws.map((w) => w.y1)),
        words: ws,
      })
    }
  }


  return { words, lines, text: data.text || '' }
}

/** Terminate the OCR worker (frees memory). Safe to call multiple times. */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise
      await w.terminate()
    } catch {
      /* ignore */
    }
    workerPromise = null
  }
}
