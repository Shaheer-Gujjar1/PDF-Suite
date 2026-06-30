'use client'

import * as React from 'react'
import { Loader2, Eraser, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePdfThumbnails } from '@/hooks/use-pdf'

export interface SignResult {
  annotations: { type: 'image'; data: string; mime: string; x: number; y: number; width: number; height: number; page: number }[]
}

interface SignAnnotateViewProps {
  file: File
  onResultChange: (result: SignResult | null) => void
}

export function SignAnnotateView({ file, onResultChange }: SignAnnotateViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 1, 0.6)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [hasDrawing, setHasDrawing] = React.useState(false)
  const [sigDataUrl, setSigDataUrl] = React.useState<string | null>(null)
  const [placed, setPlaced] = React.useState<{ x: number; y: number } | null>(null)
  const pageRef = React.useRef<HTMLDivElement>(null)
  const page = pages[0]

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    canvas.setPointerCapture(e.pointerId)
  }

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    if (!canvas.hasPointerCapture(e.pointerId)) return
    const ctx = canvas.getContext('2d')!
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
    ctx.stroke()
    setHasDrawing(true)
  }

  const clear = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawing(false)
    setSigDataUrl(null)
    setPlaced(null)
  }

  const placeSignature = () => {
    if (!hasDrawing || !canvasRef.current) return
    setSigDataUrl(canvasRef.current.toDataURL('image/png'))
    setPlaced({ x: 50, y: 50 })
  }

  React.useEffect(() => {
    if (placed && sigDataUrl) {
      const base64 = sigDataUrl.split(',')[1]
      onResultChange({
        annotations: [{
          type: 'image', data: base64, mime: 'image/png',
          x: placed.x, y: placed.y, width: 200, height: 75, page: 0,
        }],
      })
    } else {
      onResultChange(null)
    }
  }, [placed, sigDataUrl, onResultChange])

  const handleDragSignature = (e: React.PointerEvent) => {
    if (!pageRef.current || !placed || !page) return
    if (e.buttons !== 1) return
    const rect = pageRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 80))
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height - 30))
    setPlaced({ x: (x / rect.width) * page.width, y: (1 - y / rect.height) * page.height - 75 })
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Loading page…</p>
    </div>
  )
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">{error}</div>

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        {/* Signature pad */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Draw your signature</h3>
          <canvas
            ref={canvasRef}
            width={400}
            height={150}
            className="w-full touch-none rounded-xl border-2 border-border bg-white"
            onPointerDown={startDraw}
            onPointerMove={draw}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={clear} disabled={!hasDrawing && !placed}>
              <Eraser className="mr-1.5 h-3.5 w-3.5" />Clear
            </Button>
            <Button size="sm" onClick={placeSignature} disabled={!hasDrawing}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Place signature
            </Button>
          </div>
        </div>

        {/* Page preview */}
        {page && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Drag to position on page</h3>
            <div ref={pageRef} className="relative inline-block">
              <img src={page.dataUrl} alt="Page" className="max-h-[400px] rounded-lg border-2 border-border" draggable={false} />
              {placed && sigDataUrl && (
                <img
                  src={sigDataUrl}
                  alt="Signature"
                  className="absolute cursor-move border border-primary/40 bg-white/80"
                  style={{
                    left: `${(placed.x / page.width) * 100}%`,
                    bottom: `${(placed.y / page.height) * 100}%`,
                    width: `${(200 / page.width) * 100}%`,
                  }}
                  onPointerMove={handleDragSignature}
                />
              )}
            </div>
            {placed && (
              <Button size="sm" variant="ghost" onClick={() => setPlaced(null)}>
                <X className="mr-1.5 h-3.5 w-3.5" />Remove placed
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
