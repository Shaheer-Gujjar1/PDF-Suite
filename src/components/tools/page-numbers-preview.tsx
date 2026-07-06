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
  margin: number
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
        // Render at 2x the display size for crisp (non-blurry) preview.
        // Display width = 360px, render width = 720px (retina).
        const baseViewport = page.getViewport({ scale: 1 })
        const displayWidth = 360
        const dpr = 2
        const renderScale = Math.min((displayWidth * dpr) / baseViewport.width, 4.0)
        const viewport = page.getViewport({ scale: renderScale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        canvas.style.maxWidth = displayWidth + 'px'
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch (_) {}
        }
        renderTaskRef.current = page.render({ canvasContext: ctx, viewport })
        await renderTaskRef.current.promise
        if (cancelled) return
        // Store page dimensions + a canvas 2D context for measuring text width
        // (so the preview's X position matches the worker's font.widthOfTextAtSize).
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
    const { position, fontSize, format, startNumber, margin } = config
    const num = startNumber
    // Roman numeral conversion (matching the worker's toRoman function).
    const toRoman = (n: number): string => {
      if (n < 1) return String(n)
      const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1]
      const syms = ['m','cm','d','cd','c','xc','l','xl','x','ix','v','iv','i']
      let r = ''
      for (let i = 0; i < vals.length; i++) { while (n >= vals[i]) { r += syms[i]; n -= vals[i] } }
      return r
    }
    // Letter conversion (matching the worker's toAlpha function).
    const toAlpha = (n: number): string => {
      if (n < 1) return String(n)
      let r = ''
      while (n > 0) { const rem = (n - 1) % 26; r = String.fromCharCode(97 + rem) + r; n = Math.floor((n - 1) / 26) }
      return r
    }
    const text = String(format)
      .replace(/\{n\}/g, String(num))
      .replace(/\{total\}/g, '…')
      .replace(/\{roman\}/g, toRoman(num))
      .replace(/\{Roman\}/g, toRoman(num).toUpperCase())
      .replace(/\{alpha\}/g, toAlpha(num))
      .replace(/\{Alpha\}/g, toAlpha(num).toUpperCase())

    // Measure actual text width using a temporary canvas — this matches
    // the worker's font.widthOfTextAtSize() so positions are identical.
    let textWidth = text.length * fontSize * 0.5 // fallback
    try {
      const measureCanvas = document.createElement('canvas')
      const mctx = measureCanvas.getContext('2d')
      if (mctx) {
        mctx.font = `${fontSize}px Helvetica, Arial, sans-serif`
        textWidth = mctx.measureText(text).width
      }
    } catch (_) {}

    // Position math — IDENTICAL to the worker processor.
    let x: number, y: number
    if (position === 'bottom-center') { x = (pw - textWidth) / 2; y = margin }
    else if (position === 'bottom-right') { x = pw - textWidth - margin; y = margin }
    else if (position === 'bottom-left') { x = margin; y = margin }
    else if (position === 'top-center') { x = (pw - textWidth) / 2; y = ph - margin - fontSize }
    else if (position === 'top-right') { x = pw - textWidth - margin; y = ph - margin - fontSize }
    else { x = margin; y = ph - margin - fontSize }

    // Convert from PDF coordinates (bottom-left origin, y=baseline) to
    // CSS coordinates (top-left origin). The worker draws text at y=baseline,
    // so the text's TOP edge is at y + fontSize (approximate ascent for
    // Helvetica ≈ 0.72 × fontSize, but using full fontSize as cap height
    // approximation is close enough and what the worker's margin calculation
    // implies).
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
        className="relative mx-auto inline-block overflow-hidden rounded-xl border border-border bg-white shadow-md"
        style={{ maxWidth: '100%', minHeight: loading || error ? '400px' : 'auto', display: loading || error ? 'block' : 'inline-block' }}
      >
        {/* Canvas is always rendered so the ref is available for rendering. */}
        <canvas ref={canvasRef} className="block h-auto" style={{ display: loading || error ? 'none' : 'block', maxWidth: '100%' }} />
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
