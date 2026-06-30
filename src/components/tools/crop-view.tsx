'use client'

import * as React from 'react'
import {
  Loader2, X, ChevronLeft, ChevronRight, Crop as CropIcon, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropResult {
  /** Single crop for all pages (all-pages mode) */
  crop?: CropRect
  /** Per-page crops (current-page mode), keyed by 0-indexed page number */
  pageCrops?: Record<number, CropRect>
  mode: 'all' | 'current'
}

interface CropPdfViewProps {
  file: File
  onResultChange: (result: CropResult | null) => void
  onRemoveFile?: () => void
}

type DragMode = 'none' | 'creating' | 'moving' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | 'resize-ne' | 'resize-nw' | 'resize-se' | 'resize-sw'

const HANDLE_SIZE = 10
const MIN_SIZE = 20

export function CropPdfView({ file, onResultChange, onRemoveFile }: CropPdfViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 50, 1.0)
  const [mode, setMode] = React.useState<'all' | 'current'>('all')
  const [currentPage, setCurrentPage] = React.useState(0)
  const [allPagesCrop, setAllPagesCrop] = React.useState<CropRect | null>(null)
  const [pageCrops, setPageCrops] = React.useState<Record<number, CropRect>>({})
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 })
  const dragMode = React.useRef<DragMode>('none')
  const dragStart = React.useRef({ x: 0, y: 0, rect: null as CropRect | null })

  const page = pages[currentPage]

  // Track container size
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

  // Get the crop for the current view
  const activeCrop = mode === 'all' ? allPagesCrop : (pageCrops[currentPage] ?? null)

  // Set crop for the current view
  const setActiveCrop = React.useCallback((rect: CropRect | null) => {
    if (mode === 'all') {
      setAllPagesCrop(rect)
    } else {
      setPageCrops((prev) => {
        const next = { ...prev }
        if (rect === null) delete next[currentPage]
        else next[currentPage] = rect
        return next
      })
    }
  }, [mode, currentPage])

  // Emit result
  React.useEffect(() => {
    if (mode === 'all') {
      if (allPagesCrop) {
        onResultChange({ mode: 'all', crop: allPagesCrop })
      } else {
        onResultChange(null)
      }
    } else {
      const count = Object.keys(pageCrops).length
      if (count > 0) {
        onResultChange({ mode: 'current', pageCrops })
      } else {
        onResultChange(null)
      }
    }
  }, [mode, allPagesCrop, pageCrops, onResultChange])

  // Coordinate conversion: display → PDF points
  const toPdf = React.useCallback((rect: CropRect): CropRect => {
    if (!page || containerSize.w === 0) return rect
    const scaleX = page.width / containerSize.w
    const scaleY = page.height / containerSize.h
    return {
      x: rect.x * scaleX,
      y: page.height - (rect.y + rect.height) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    }
  }, [page, containerSize])

  // PDF → display
  const toDisplay = React.useCallback((rect: CropRect): CropRect => {
    if (!page || containerSize.w === 0) return rect
    const scaleX = containerSize.w / page.width
    const scaleY = containerSize.h / page.height
    return {
      x: rect.x * scaleX,
      y: (page.height - rect.y - rect.height) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    }
  }, [page, containerSize])

  // Mouse event handlers
  const getMousePos = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    }
  }

  const hitTest = (pos: { x: number; y: number }, rect: CropRect): DragMode => {
    if (!rect || rect.width === 0) return 'none'
    const { x, y } = pos
    const left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height
    const h = HANDLE_SIZE

    // Check corners first
    if (Math.abs(x - left) < h && Math.abs(y - top) < h) return 'resize-nw'
    if (Math.abs(x - right) < h && Math.abs(y - top) < h) return 'resize-ne'
    if (Math.abs(x - left) < h && Math.abs(y - bottom) < h) return 'resize-sw'
    if (Math.abs(x - right) < h && Math.abs(y - bottom) < h) return 'resize-se'
    // Check edges
    if (Math.abs(y - top) < h && x > left && x < right) return 'resize-n'
    if (Math.abs(y - bottom) < h && x > left && x < right) return 'resize-s'
    if (Math.abs(x - left) < h && y > top && y < bottom) return 'resize-w'
    if (Math.abs(x - right) < h && y > top && y < bottom) return 'resize-e'
    // Inside rect → move
    if (x > left && x < right && y > top && y < bottom) return 'moving'
    return 'none'
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!page) return
    const pos = getMousePos(e)
    const existing = activeCrop
    if (existing) {
      const hit = hitTest(pos, existing)
      if (hit !== 'none') {
        dragMode.current = hit
        dragStart.current = { x: pos.x, y: pos.y, rect: { ...existing } }
        return
      }
    }
    // Start new selection
    dragMode.current = 'creating'
    dragStart.current = { x: pos.x, y: pos.y, rect: null }
    setActiveCrop({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragMode.current === 'none') return
    const pos = getMousePos(e)
    const start = dragStart.current

    if (dragMode.current === 'creating') {
      const x = Math.min(start.x, pos.x)
      const y = Math.min(start.y, pos.y)
      const width = Math.abs(pos.x - start.x)
      const height = Math.abs(pos.y - start.y)
      setActiveCrop({ x, y, width, height })
    } else if (dragMode.current === 'moving' && start.rect) {
      const dx = pos.x - start.x
      const dy = pos.y - start.y
      let newX = start.rect.x + dx
      let newY = start.rect.y + dy
      newX = Math.max(0, Math.min(newX, containerSize.w - start.rect.width))
      newY = Math.max(0, Math.min(newY, containerSize.h - start.rect.height))
      setActiveCrop({ ...start.rect, x: newX, y: newY })
    } else if (start.rect) {
      // Resizing
      const dx = pos.x - start.x
      const dy = pos.y - start.y
      let { x, y, width, height } = start.rect
      const dm = dragMode.current
      if (dm.includes('w')) { x = start.rect.x + dx; width = start.rect.width - dx; }
      if (dm.includes('e')) { width = start.rect.width + dx; }
      if (dm.includes('n')) { y = start.rect.y + dy; height = start.rect.height - dy; }
      if (dm.includes('s')) { height = start.rect.height + dy; }
      // Enforce minimum size
      if (width < MIN_SIZE) { if (dm.includes('w')) x = start.rect.x + start.rect.width - MIN_SIZE; width = MIN_SIZE; }
      if (height < MIN_SIZE) { if (dm.includes('n')) y = start.rect.y + start.rect.height - MIN_SIZE; height = MIN_SIZE; }
      // Clamp to container
      x = Math.max(0, x); y = Math.max(0, y)
      if (x + width > containerSize.w) width = containerSize.w - x
      if (y + height > containerSize.h) height = containerSize.h - y
      setActiveCrop({ x, y, width, height })
    }
  }

  const handleMouseUp = () => {
    if (dragMode.current === 'creating' && activeCrop) {
      // Remove tiny selections
      if (activeCrop.width < MIN_SIZE || activeCrop.height < MIN_SIZE) {
        setActiveCrop(null)
      }
    }
    dragMode.current = 'none'
  }

  const getCursor = (): string => {
    if (!containerRef.current || !activeCrop) return 'crosshair'
    // Cursor is managed by handles via CSS; default crosshair for new selection
    return 'crosshair'
  }

  const trim10 = () => {
    if (containerSize.w === 0) return
    setActiveCrop({
      x: containerSize.w * 0.1,
      y: containerSize.h * 0.1,
      width: containerSize.w * 0.8,
      height: containerSize.h * 0.8,
    })
  }

  const resetCrop = () => setActiveCrop(null)

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Loading pages…</p>
    </div>
  )
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">{error}</div>
  if (pages.length === 0) return null

  const pdfCrop = activeCrop && containerSize.w > 0 ? toPdf(activeCrop) : null
  const pageCount = pages.length
  const hasAnyCrop = mode === 'all' ? !!allPagesCrop : Object.keys(pageCrops).length > 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {mode === 'all'
            ? 'Draw a crop region — it will apply to all pages.'
            : 'Navigate to each page and draw a crop region individually.'}
        </p>
        {onRemoveFile && (
          <Button variant="outline" size="sm" onClick={onRemoveFile} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Change file
          </Button>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('all')}
          className={cn(
            'flex-1 rounded-lg border p-3 text-left transition-all',
            mode === 'all' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/40'
          )}
        >
          <div className="flex items-center gap-2">
            <CropIcon className={cn('h-4 w-4', mode === 'all' && 'text-primary')} />
            <span className="text-sm font-medium">All pages</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">One selection applied to every page</p>
        </button>
        <button
          type="button"
          onClick={() => setMode('current')}
          className={cn(
            'flex-1 rounded-lg border p-3 text-left transition-all',
            mode === 'current' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/40'
          )}
        >
          <div className="flex items-center gap-2">
            <FileText className={cn('h-4 w-4', mode === 'current' && 'text-primary')} />
            <span className="text-sm font-medium">Current page</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Crop each page individually</p>
        </button>
      </div>

      {/* Page navigation (current-page mode) */}
      {mode === 'current' && (
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            Page {currentPage + 1} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Crop area */}
      {page && (
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
            <img src={page.dataUrl} alt={`Page ${currentPage + 1}`} className="block max-w-full" draggable={false} />

            {/* Crop overlay */}
            {activeCrop && (
              <>
                {/* Dimmed outside region */}
                <div className="pointer-events-none absolute inset-0 bg-black/40" style={{
                  clipPath: `polygon(0 0, 0 100%, ${activeCrop.x}px 100%, ${activeCrop.x}px ${activeCrop.y}px, ${activeCrop.x + activeCrop.width}px ${activeCrop.y}px, ${activeCrop.x + activeCrop.width}px ${activeCrop.y + activeCrop.height}px, ${activeCrop.x}px ${activeCrop.y + activeCrop.height}px, ${activeCrop.x}px 100%, 100% 100%, 100% 0)`,
                }} />
                {/* Selection border */}
                <div
                  className="pointer-events-none absolute border-2 border-primary"
                  style={{ left: activeCrop.x, top: activeCrop.y, width: activeCrop.width, height: activeCrop.height }}
                >
                  {/* Resize handles */}
                  {(['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const).map((h) => {
                    const handleStyle: React.CSSProperties = {
                      position: 'absolute',
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      background: 'white',
                      border: '2px solid hsl(var(--primary))',
                      borderRadius: '2px',
                    }
                    if (h.includes('n')) handleStyle.top = -HANDLE_SIZE / 2
                    if (h.includes('s')) handleStyle.bottom = -HANDLE_SIZE / 2
                    if (h.includes('w')) handleStyle.left = -HANDLE_SIZE / 2
                    if (h.includes('e')) handleStyle.right = -HANDLE_SIZE / 2
                    if (h === 'n' || h === 's') { handleStyle.left = '50%'; handleStyle.transform = 'translateX(-50%)'; handleStyle.width = HANDLE_SIZE * 2 }
                    if (h === 'e' || h === 'w') { handleStyle.top = '50%'; handleStyle.transform = 'translateY(-50%)'; handleStyle.height = HANDLE_SIZE * 2 }
                    if (h === 'n' && h.includes('w')) { /* corner */ }
                    const cursors: Record<string, string> = {
                      nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
                      n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
                    }
                    handleStyle.cursor = cursors[h]
                    return <div key={h} style={handleStyle} />
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dimension display + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={trim10}>Trim margins 10%</Button>
          <Button size="sm" variant="outline" onClick={resetCrop} disabled={!activeCrop}>Reset crop</Button>
        </div>
        {pdfCrop && (
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>X: <strong className="text-foreground">{Math.round(pdfCrop.x)}</strong></span>
            <span>Y: <strong className="text-foreground">{Math.round(pdfCrop.y)}</strong></span>
            <span>W: <strong className="text-foreground">{Math.round(pdfCrop.width)}</strong></span>
            <span>H: <strong className="text-foreground">{Math.round(pdfCrop.height)}</strong></span>
          </div>
        )}
      </div>

      {/* Page thumbnails strip (all pages) */}
      {pageCount > 1 && (
        <div className="border-t border-border/60 pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {mode === 'current' ? 'Click a page to navigate:' : 'All pages (same crop applies):'}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {pages.map((pg, idx) => {
              const hasCrop = mode === 'all' ? !!allPagesCrop : !!pageCrops[idx]
              return (
                <button
                  key={idx}
                  onClick={() => mode === 'current' && setCurrentPage(idx)}
                  className={cn(
                    'relative shrink-0 overflow-hidden rounded border-2 transition-all',
                    mode === 'current' && currentPage === idx
                      ? 'border-primary ring-1 ring-primary/20'
                      : 'border-border hover:border-primary/40',
                    mode === 'current' && 'cursor-pointer'
                  )}
                >
                  <img src={pg.dataUrl} alt={`Page ${idx + 1}`} className="h-20 w-15 object-contain" />
                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[8px] font-medium text-white">
                    {idx + 1}
                  </span>
                  {hasCrop && (
                    <span className="absolute left-0 top-0 rounded-br bg-emerald-500 px-1 text-[8px] font-bold text-white">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
