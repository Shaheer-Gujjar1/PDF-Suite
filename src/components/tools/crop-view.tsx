'use client'

import * as React from 'react'
import { Loader2, Crop as CropIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface CropResult {
  crop: { x: number; y: number; width: number; height: number }
}

interface CropPdfViewProps {
  file: File
  onResultChange: (result: CropResult | null) => void
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export function CropPdfView({ file, onResultChange }: CropPdfViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 1, 1.0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 })
  const [crop, setCrop] = React.useState<CropRect | null>(null)
  const [drawing, setDrawing] = React.useState(false)
  const [startPos, setStartPos] = React.useState({ x: 0, y: 0 })

  const page = pages[0]

  // Track container size for coordinate conversion
  React.useEffect(() => {
    if (!containerRef.current) return
    const update = () => {
      if (containerRef.current) {
        setContainerSize({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [page])

  const displayToPdf = React.useCallback(
    (rect: CropRect): CropRect => {
      if (!page || containerSize.w === 0) return rect
      const scaleX = page.width / containerSize.w
      const scaleY = page.height / containerSize.h
      const pdfX = rect.x * scaleX
      const pdfY = page.height - (rect.y + rect.height) * scaleY
      return { x: pdfX, y: pdfY, width: rect.width * scaleX, height: rect.height * scaleY }
    },
    [page, containerSize]
  )

  React.useEffect(() => {
    if (crop && page && containerSize.w > 0) {
      const pdfCrop = displayToPdf(crop)
      onResultChange({ crop: pdfCrop })
    } else {
      onResultChange(null)
    }
  }, [crop, page, displayToPdf, containerSize, onResultChange])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setStartPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setDrawing(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.min(startPos.x, e.clientX - rect.left)
    const y = Math.min(startPos.y, e.clientY - rect.top)
    const width = Math.abs(e.clientX - rect.left - startPos.x)
    const height = Math.abs(e.clientY - rect.top - startPos.y)
    setCrop({ x, y, width, height })
  }

  const handleMouseUp = () => setDrawing(false)

  const trim10 = () => {
    if (containerSize.w === 0) return
    setCrop({ x: containerSize.w * 0.1, y: containerSize.h * 0.1, width: containerSize.w * 0.8, height: containerSize.h * 0.8 })
  }

  const reset = () => setCrop(null)

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Loading page…</p>
    </div>
  )
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">{error}</div>
  if (!page) return null

  const pdfCrop = crop && containerSize.w > 0 ? displayToPdf(crop) : null

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Click and drag on the page to select a crop region. Applies to all pages.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={trim10}>Trim margins 10%</Button>
        <Button size="sm" variant="outline" onClick={reset}>Reset crop</Button>
      </div>

      <div className="flex justify-center">
        <div
          ref={containerRef}
          className="relative cursor-crosshair select-none overflow-hidden rounded-lg border-2 border-border bg-muted shadow-sm"
          style={{ maxWidth: '100%' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img src={page.dataUrl} alt="Page 1" className="block max-w-full" draggable={false} />
          {crop && (
            <div
              className="absolute border-2 border-primary bg-primary/10"
              style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height }}
            />
          )}
        </div>
      </div>

      {pdfCrop && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'X', value: Math.round(pdfCrop.x) },
            { label: 'Y', value: Math.round(pdfCrop.y) },
            { label: 'Width', value: Math.round(pdfCrop.width) },
            { label: 'Height', value: Math.round(pdfCrop.height) },
          ].map((f) => (
            <div key={f.label}>
              <Label className="text-xs text-muted-foreground">{f.label} (pt)</Label>
              <Input value={f.value} readOnly className="mt-1 h-8 text-sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
