'use client'

import * as React from 'react'

/**
 * Loads pdf.js on the main thread (for rendering page thumbnails in the
 * interactive tool views — Organize, Crop, Sign, Edit Text, Merge).
 * Uses the legacy UMD build via a dynamic script tag.
 */

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

let pdfjsPromise: Promise<any> | null = null

export function loadPdfJs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise
  pdfjsPromise = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib)
      return
    }
    const script = document.createElement('script')
    script.src = PDFJS_URL
    script.onload = async () => {
      const pdfjs = (window as any).pdfjsLib
      if (!pdfjs) {
        reject(new Error('pdf.js failed to load'))
        return
      }
      try {
        const res = await fetch(PDFJS_WORKER_URL)
        const text = await res.text()
        const blob = new Blob([text], { type: 'application/javascript' })
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
      } catch {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
      }
      resolve(pdfjs)
    }
    script.onerror = () => reject(new Error('Failed to load pdf.js script'))
    document.head.appendChild(script)
  })
  return pdfjsPromise
}

export interface RenderedPage {
  pageNum: number
  dataUrl: string
  width: number
  height: number
}

/**
 * Render pages of a single PDF to thumbnail data URLs.
 */
export function usePdfThumbnails(
  file: File | null,
  maxPages: number = 50,
  scale: number = 0.4
): { pages: RenderedPage[]; loading: boolean; error: string | null } {
  const [pages, setPages] = React.useState<RenderedPage[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file) {
      setPages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPages([])

    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const buf = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        const count = Math.min(doc.numPages, maxPages)
        const rendered: RenderedPage[] = []
        for (let i = 1; i <= count; i++) {
          if (cancelled) break
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport }).promise
          rendered.push({
            pageNum: i,
            dataUrl: canvas.toDataURL('image/png'),
            width: viewport.width,
            height: viewport.height,
          })
          try { await page.cleanup() } catch {}
        }
        try { await doc.destroy() } catch {}
        if (!cancelled) {
          setPages(rendered)
          setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || String(e))
          setLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [file, maxPages, scale])

  return { pages, loading, error }
}

export interface FirstPageThumb {
  id: string
  dataUrl: string | null
  pageCount: number
  loading: boolean
}

/**
 * Render the first page of multiple PDFs (for the Merge tool's drag-reorder).
 * Returns a map of fileId → thumbnail.
 */
export function usePdfFirstPages(
  files: { id: string; file: File }[]
): { thumbs: Map<string, FirstPageThumb>; loading: boolean } {
  const [thumbs, setThumbs] = React.useState<Map<string, FirstPageThumb>>(new Map())
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (files.length === 0) {
      setThumbs(new Map())
      return
    }
    let cancelled = false
    setLoading(true)

    const newThumbs = new Map<string, FirstPageThumb>()
    files.forEach((f) => {
      newThumbs.set(f.id, { id: f.id, dataUrl: null, pageCount: 0, loading: true })
    })
    setThumbs(new Map(newThumbs))

    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        for (const f of files) {
          if (cancelled) break
          try {
            const buf = await f.file.arrayBuffer()
            const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
            const page = await doc.getPage(1)
            const viewport = page.getViewport({ scale: 0.35 })
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const ctx = canvas.getContext('2d')!
            await page.render({ canvasContext: ctx, viewport }).promise
            const dataUrl = canvas.toDataURL('image/png')
            const pageCount = doc.numPages
            try { await doc.destroy() } catch {}
            if (!cancelled) {
              newThumbs.set(f.id, { id: f.id, dataUrl, pageCount, loading: false })
              setThumbs(new Map(newThumbs))
            }
          } catch {
            if (!cancelled) {
              newThumbs.set(f.id, { id: f.id, dataUrl: null, pageCount: 0, loading: false })
              setThumbs(new Map(newThumbs))
            }
          }
        }
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [files])

  return { thumbs, loading }
}
