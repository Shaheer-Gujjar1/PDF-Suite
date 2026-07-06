'use client'

import * as React from 'react'
import { Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

/** Load pdf.js if not already loaded. Returns the pdfjsLib global. */
function ensurePdfJs(): Promise<any> {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PDFJS_URL
    script.onload = async () => {
      const pdfjs = (window as any).pdfjsLib
      if (!pdfjs) { reject(new Error('pdf.js failed to load')); return }
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
    script.onerror = () => reject(new Error('Failed to load pdf.js'))
    document.head.appendChild(script)
  })
}

export interface PageNumberPreviewConfig {
  position: string
  fontSize: number
  format: string
  startNumber: number
}

interface PageNumbersPreviewProps {
  file: File
  config: PageNumberPreviewConfig
  className?: string
}

/**
 * Real-time preview of the first page of the PDF with the page number
 * overlay rendered at the exact position/size the worker would draw it.
 * The preview is larger than a typical thumbnail so the user can clearly
 * see how the number looks. Updates instantly as settings change.
 */
export function PageNumbersPreview({ file, config, className }: PageNumbersPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [pageDims, setPageDims] = React.useState<{ w: number; h: number; renderW: number } | null>(null)
  const renderTaskRef = React.useRef<any>(null)

  // Render the first page to the canvas at a higher scale for a larger preview.
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPageDims(null)

    ;(async () => {
      try {
        const pdfjs = await ensurePdfJs()
        const buf: ArrayBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(new Error('Could not read file'))
          reader.readAsArrayBuffer(file)
        })
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        if (cancelled) return
        const page = await doc.getPage(1)
        // Use a scale that gives a good preview size (~360px wide for A4).
        const baseViewport = page.getViewport({ scale: 1 })
        const targetWidth = 360
        const renderScale = Math.min(targetWidth / baseViewport.width, 2.0)
        const viewport = page.getViewport({ scale: renderScale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch (_) {}
        }
        renderTaskRef.current = page.render({ canvasContext: ctx, viewport })
        await renderTaskRef.current.promise
        if (cancelled) return
        // Store page dimensions in PDF points (scale 1) + canvas width for overlay math.
        setPageDims({ w: baseViewport.width, h: baseViewport.height, renderW: canvas.width })
        setLoading(false)
        try { await page.cleanup() } catch (_) {}
        try { await doc.destroy() } catch (_) {}
      } catch (e: any) {
        console.error('[page-numbers-preview] error:', e)
        if (!cancelled) {
          setError(e.message || String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch (_) {}
      }
    }
  }, [file])

  // Compute the overlay text + position (matching the worker's logic exactly).
  const overlay = React.useMemo(() => {
    if (!pageDims) return null
    const { w: pw, h: ph, renderW } = pageDims
    const { position, fontSize, format, startNumber } = config
    const num = startNumber
    const text = String(format)
      .replace(/\{n\}/g, String(num))
      .replace(/\{total\}/g, '…')
    // Approximate text width: average char width ≈ 0.5 × fontSize for Helvetica
    const textWidth = text.length * fontSize * 0.5
    const margin = 28
    let x: number, y: number
    if (position === 'bottom-center') { x = (pw - textWidth) / 2; y = margin }
    else if (position === 'bottom-right') { x = pw - textWidth - margin; y = margin }
    else if (position === 'bottom-left') { x = margin; y = margin }
    else if (position === 'top-center') { x = (pw - textWidth) / 2; y = ph - margin - fontSize }
    else if (position === 'top-right') { x = pw - textWidth - margin; y = ph - margin - fontSize }
    else { x = margin; y = ph - margin - fontSize }
    // The worker draws text with y = baseline (bottom-left origin). For the
    // overlay (top-left origin): canvas_y = pageHeight - baseline_y - fontSize.
    const scale = renderW / pw
    return {
      text,
      leftPct: (x / pw) * 100,
      topPct: ((ph - y - fontSize) / ph) * 100,
      fontSizePx: fontSize * scale,
    }
  }, [pageDims, config])

  return (
    <div className={cn('relative', className)}>
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-border bg-white shadow-md"
        style={{ maxWidth: '100%', minHeight: loading || error ? '400px' : 'auto' }}
      >
        {/* Canvas is always rendered so the ref is available for rendering. */}
        <canvas ref={canvasRef} className="block h-auto w-full" style={{ display: loading || error ? 'none' : 'block' }} />
        {/* Page number overlay */}
        {!loading && !error && overlay && (
          <div
            className="pointer-events-none absolute whitespace-nowrap text-gray-500"
            style={{
              left: `${overlay.leftPct}%`,
              top: `${overlay.topPct}%`,
              fontSize: `${overlay.fontSizePx}px`,
              lineHeight: 1,
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}
          >
            {overlay.text}
          </div>
        )}
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
          </div>
        )}
        {/* Error overlay */}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/5 p-4 text-center">
            <FileText className="h-8 w-8 text-destructive/50" />
            <p className="text-xs text-destructive">Preview failed: {error}</p>
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Live preview · Page 1 of {file.name}
      </p>
    </div>
  )
}
