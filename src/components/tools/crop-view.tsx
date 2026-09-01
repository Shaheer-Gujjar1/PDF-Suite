'use client'

import * as React from 'react'
import {
  Loader2, X, ChevronLeft, ChevronRight, Crop as CropIcon, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropResult {
  /** Single crop for all pages (all-pages mode), in PDF points. */
  crop?: CropRect
  /** Per-page crops (current-page mode), keyed by 0-indexed page number, PDF points. */
  pageCrops?: Record<number, CropRect>
  mode: 'all' | 'current'
}

interface CropPdfViewProps {
  file: File
  onResultChange: (result: CropResult | null) => void
  onRemoveFile?: () => void
}

/** Crop rect in relative (0..1) page coordinates so it survives rescaling. */
interface RelRect {
  x: number
  y: number
  w: number
  h: number
}

interface PxRect {
  x: number
  y: number
  width: number
  height: number
}

interface PxPoint {
  x: number
  y: number
}

type DragMode =
  | 'moving'
  | 'resize-n'
  | 'resize-s'
  | 'resize-e'
  | 'resize-w'
  | 'resize-ne'
  | 'resize-nw'
  | 'resize-se'
  | 'resize-sw'

const HANDLE_SIZE = 10
const MIN_SIZE = 20

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

function relToPx(rel: RelRect, cw: number, ch: number): PxRect {
  return { x: rel.x * cw, y: rel.y * ch, width: rel.w * cw, height: rel.h * ch }
}

/**
 * Resize by moving ONLY the edges/corner the user grabbed.
 *
 * Ported verbatim from crop-images-view.tsx (ratio branch omitted — this tool
 * has no ratio presets). Mid-edge handles (n/s/e/w) are STRICTLY single-axis:
 * the dragged edge follows the pointer, the opposite edge never moves and the
 * perpendicular dimension is untouched — dragging e/w changes width only,
 * dragging n/s changes height only (iloveimg/Cropper.js behavior). Corners
 * move both axes with the opposite corner anchored.
 */
function resizeWithHandles(
  dm: DragMode,
  start: PxRect,
  dx: number,
  dy: number,
  cw: number,
  ch: number
): PxRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  // Which edges did the user grab? Parse the direction from the mode SUFFIX
  // ('n', 'se', …). NEVER dm.includes() on the full string: the word "resize"
  // itself contains 'e' and 's', so 'resize-n'.includes('e') was true — the
  // top handle also dragged the right edge, changing the width on every
  // horizontal swipe (the exact bug this port fixes).
  const dir = dm.slice('resize-'.length)
  const grabW = dir.includes('w')
  const grabE = dir.includes('e')
  const grabN = dir.includes('n')
  const grabS = dir.includes('s')

  // 1) Move only the grabbed edges.
  if (grabW) left = start.x + dx
  if (grabE) right = start.x + start.width + dx
  if (grabN) top = start.y + dy
  if (grabS) bottom = start.y + start.height + dy

  // 2) Min size on each moved edge, anchored to the opposite edge.
  if (grabW && right - left < MIN_SIZE) left = right - MIN_SIZE
  if (grabE && right - left < MIN_SIZE) right = left + MIN_SIZE
  if (grabN && bottom - top < MIN_SIZE) top = bottom - MIN_SIZE
  if (grabS && bottom - top < MIN_SIZE) bottom = top + MIN_SIZE

  // 3) Keep inside the container without crossing the opposite edge.
  left = clamp(left, 0, cw)
  right = clamp(right, 0, cw)
  top = clamp(top, 0, ch)
  bottom = clamp(bottom, 0, ch)
  if (right - left < MIN_SIZE) {
    if (grabW) left = Math.max(0, right - MIN_SIZE)
    else right = Math.min(cw, left + MIN_SIZE)
  }
  if (bottom - top < MIN_SIZE) {
    if (grabN) top = Math.max(0, bottom - MIN_SIZE)
    else bottom = Math.min(ch, top + MIN_SIZE)
  }

  const width = right - left
  const height = bottom - top
  if (width < 2 || height < 2) return start
  return { x: left, y: top, width, height }
}

/** New rect drawn from an anchor point toward the pointer. */
function createRect(anchor: PxPoint, pos: PxPoint, cw: number, ch: number): PxRect {
  const dirX = pos.x >= anchor.x ? 1 : -1
  const dirY = pos.y >= anchor.y ? 1 : -1
  const maxW = dirX === 1 ? cw - anchor.x : anchor.x
  const maxH = dirY === 1 ? ch - anchor.y : anchor.y
  const w = Math.min(Math.abs(pos.x - anchor.x), maxW)
  const h = Math.min(Math.abs(pos.y - anchor.y), maxH)
  if (w < 2 || h < 2) {
    return { x: anchor.x, y: anchor.y, width: 0, height: 0 }
  }
  return {
    x: dirX === 1 ? anchor.x : anchor.x - w,
    y: dirY === 1 ? anchor.y : anchor.y - h,
    width: w,
    height: h,
  }
}

function hitTest(pos: PxPoint, rect: PxRect): DragMode | null {
  const { x, y } = pos
  const left = rect.x
  const top = rect.y
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  // Corner zones shrink on small boxes so a mid-edge zone always exists —
  // grabbing the side of a short/narrow box must never register as a corner
  // (a corner would change both dimensions on a one-axis gesture).
  const hz = Math.min(HANDLE_SIZE, rect.width / 2)
  const vz = Math.min(HANDLE_SIZE, rect.height / 2)

  if (Math.abs(x - left) < hz && Math.abs(y - top) < vz) return 'resize-nw'
  if (Math.abs(x - right) < hz && Math.abs(y - top) < vz) return 'resize-ne'
  if (Math.abs(x - left) < hz && Math.abs(y - bottom) < vz) return 'resize-sw'
  if (Math.abs(x - right) < hz && Math.abs(y - bottom) < vz) return 'resize-se'
  if (Math.abs(y - top) < vz && x > left && x < right) return 'resize-n'
  if (Math.abs(y - bottom) < vz && x > left && x < right) return 'resize-s'
  // Side handles also accept grabs a few px OUTSIDE the edge (the visible
  // border straddles the rect boundary, and a flush edge at x=0 or x=cw
  // previously fell through and started a brand-new selection).
  if (Math.abs(x - left) < hz && y > top && y < bottom) return 'resize-w'
  if (Math.abs(x - right) < hz && y > top && y < bottom) return 'resize-e'
  if (x > left && x < right && y > top && y < bottom) return 'moving'
  return null
}

const HANDLE_CURSORS: Record<DragMode, string> = {
  moving: 'move',
  'resize-nw': 'nwse-resize',
  'resize-ne': 'nesw-resize',
  'resize-sw': 'nesw-resize',
  'resize-se': 'nwse-resize',
  'resize-n': 'ns-resize',
  'resize-s': 'ns-resize',
  'resize-e': 'ew-resize',
  'resize-w': 'ew-resize',
}

export function CropPdfView({ file, onResultChange, onRemoveFile }: CropPdfViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 50, 1.0)
  const [mode, setMode] = React.useState<'all' | 'current'>('all')
  const [currentPage, setCurrentPage] = React.useState(0)
  const [allPagesRel, setAllPagesRel] = React.useState<RelRect | null>(null)
  const [pageRels, setPageRels] = React.useState<Record<number, RelRect>>({})
  const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 })

  const containerRef = React.useRef<HTMLDivElement>(null)
  // Drag session state — only ever read/written inside pointer event
  // handlers, so mutating it outside render is safe (and lint-clean).
  // `box` is the container size captured at pointer-down so mid-drag reflow
  // can never skew the math, and `lastRect` keeps the newest px rect so the
  // drag-end check never depends on render timing.
  const drag = React.useRef<{
    mode: DragMode | 'creating'
    anchor: PxPoint
    start: PxRect | null
    box: { w: number; h: number }
    lastRect: PxRect | null
  } | null>(null)

  const page = pages[currentPage]

  /* ---------------- Container measurement -------------------------------- */
  const updateSize = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setContainerSize((prev) => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === prev.w && h === prev.h) return prev
      return { w, h }
    })
  }, [])

  // Measure synchronously before paint so the overlay is never stale after
  // switching pages or modes (the old async state was the source of
  // stretched/contracted rects — same fix as Crop Images).
  React.useLayoutEffect(() => {
    updateSize()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(updateSize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [currentPage, page, mode, updateSize])

  /* ---------------- Active selection -------------------------------------- */
  const activeRel = mode === 'all' ? allPagesRel : (pageRels[currentPage] ?? null)

  const setActiveRel = React.useCallback(
    (rel: RelRect | null) => {
      if (mode === 'all') {
        setAllPagesRel(rel)
      } else {
        setPageRels((prev) => {
          const next = { ...prev }
          if (rel === null) delete next[currentPage]
          else next[currentPage] = rel
          return next
        })
      }
    },
    [mode, currentPage]
  )

  const setRelFromPx = React.useCallback(
    (rect: PxRect | null, box: { w: number; h: number }) => {
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        setActiveRel(null)
      } else {
        setActiveRel({
          x: rect.x / box.w,
          y: rect.y / box.h,
          w: rect.width / box.w,
          h: rect.height / box.h,
        })
      }
    },
    [setActiveRel]
  )

  /* ---------------- Emit result (PDF points, per-page aware) -------------- */
  const toPoints = React.useCallback(
    (rel: RelRect, idx: number): CropRect | null => {
      const pg = pages[idx]
      if (!pg || !pg.width || !pg.height) return null
      return {
        x: rel.x * pg.width,
        y: pg.height - (rel.y + rel.h) * pg.height, // PDF y runs from the bottom
        width: rel.w * pg.width,
        height: rel.h * pg.height,
      }
    },
    [pages]
  )

  React.useEffect(() => {
    if (mode === 'all') {
      const crop = allPagesRel ? toPoints(allPagesRel, currentPage) : null
      onResultChange(crop ? { mode: 'all', crop } : null)
    } else {
      const pageCrops: Record<number, CropRect> = {}
      for (const key of Object.keys(pageRels)) {
        const idx = Number(key)
        const c = toPoints(pageRels[idx], idx)
        if (c) pageCrops[idx] = c
      }
      onResultChange(
        Object.keys(pageCrops).length > 0 ? { mode: 'current', pageCrops } : null
      )
    }
  }, [mode, allPagesRel, pageRels, currentPage, toPoints, onResultChange])

  const activePx: PxRect | null =
    activeRel && containerSize.w > 0 && containerSize.h > 0
      ? relToPx(activeRel, containerSize.w, containerSize.h)
      : null

  /* ---------------- Pointer interaction ------------------------------------ */
  const posFromEvent = (e: React.PointerEvent): PxPoint => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    // The container has a border; the overlay lives inside it. Subtract the
    // border so pointer coordinates share the exact space as clientWidth and
    // the absolutely positioned crop rect (otherwise every hit is offset).
    return {
      x: clamp(e.clientX - r.left - el.clientLeft, 0, el.clientWidth),
      y: clamp(e.clientY - r.top - el.clientTop, 0, el.clientHeight),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = containerRef.current
    if (!el) return
    const box = { w: el.clientWidth, h: el.clientHeight }
    if (!box.w || !box.h) return
    // Capture the pointer: drags keep working even when the cursor leaves
    // the page preview, and the up-event can never be missed.
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // ignore — capture is best-effort
    }
    const pos = posFromEvent(e)
    const px = activeRel ? relToPx(activeRel, box.w, box.h) : null
    const hit = px ? hitTest(pos, px) : null
    if (hit && px) {
      drag.current = {
        mode: hit,
        anchor: pos,
        start: { ...px },
        box,
        lastRect: { ...px },
      }
    } else {
      const seed = { x: pos.x, y: pos.y, width: 0, height: 0 }
      drag.current = { mode: 'creating', anchor: pos, start: null, box, lastRect: seed }
      setRelFromPx(seed, box)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const pos = posFromEvent(e)
    const { w: cw, h: ch } = d.box
    if (d.mode === 'creating') {
      const r = createRect(d.anchor, pos, cw, ch)
      d.lastRect = r
      setRelFromPx(r, d.box)
      return
    }
    if (!d.start) return
    const dx = pos.x - d.anchor.x
    const dy = pos.y - d.anchor.y
    if (d.mode === 'moving') {
      const x = clamp(d.start.x + dx, 0, Math.max(0, cw - d.start.width))
      const y = clamp(d.start.y + dy, 0, Math.max(0, ch - d.start.height))
      setRelFromPx({ ...d.start, x, y }, d.box)
      return
    }
    const next = resizeWithHandles(d.mode, d.start, dx, dy, cw, ch)
    d.lastRect = next
    setRelFromPx(next, d.box)
  }

  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (d && d.mode === 'creating' && d.lastRect) {
      // Discard accidental tiny selections (e.g. a single click).
      if (d.lastRect.width < MIN_SIZE || d.lastRect.height < MIN_SIZE) {
        setRelFromPx(null, d.box)
      }
    }
  }

  /* ---------------- Toolbar actions ---------------------------------------- */
  const trim10 = () => setActiveRel({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })

  const resetCrop = () => setActiveRel(null)

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Loading pages…</p>
    </div>
  )
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">{error}</div>
  if (pages.length === 0) return null

  // Readout + emitted crop in PDF points for the visible page.
  const pdfCrop = activeRel ? toPoints(activeRel, currentPage) : null
  const pageCount = pages.length
  const hasAnyCrop = mode === 'all' ? !!allPagesRel : Object.keys(pageRels).length > 0

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
            style={{ maxWidth: '100%', lineHeight: 0, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img src={page.dataUrl} alt={`Page ${currentPage + 1}`} className="block max-w-full" draggable={false} />

            {/* Crop overlay */}
            {activePx && activePx.width > 0 && (
              <>
                {/* Dimmed outside region */}
                <div className="pointer-events-none absolute inset-0 bg-black/40" style={{
                  clipPath: `polygon(0 0, 0 100%, ${activePx.x}px 100%, ${activePx.x}px ${activePx.y}px, ${activePx.x + activePx.width}px ${activePx.y}px, ${activePx.x + activePx.width}px ${activePx.y + activePx.height}px, ${activePx.x}px ${activePx.y + activePx.height}px, ${activePx.x}px 100%, 100% 100%, 100% 0)`,
                }} />
                {/* Selection border + thirds guide + handles */}
                <div
                  className="pointer-events-none absolute border-2 border-primary"
                  style={{ left: activePx.x, top: activePx.y, width: activePx.width, height: activePx.height }}
                >
                  <div className="absolute inset-0">
                    <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
                    <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
                    <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
                    <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
                  </div>
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
                    if (h === 'n' || h === 's') {
                      handleStyle.left = '50%'
                      handleStyle.transform = 'translateX(-50%)'
                      handleStyle.width = HANDLE_SIZE * 2
                    }
                    if (h === 'e' || h === 'w') {
                      handleStyle.top = '50%'
                      handleStyle.transform = 'translateY(-50%)'
                      handleStyle.height = HANDLE_SIZE * 2
                    }
                    handleStyle.cursor = HANDLE_CURSORS[('resize-' + h) as DragMode]
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
          <Button size="sm" variant="outline" onClick={resetCrop} disabled={!activeRel}>Reset crop</Button>
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
              const hasCrop = mode === 'all' ? !!allPagesRel : !!pageRels[idx]
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
