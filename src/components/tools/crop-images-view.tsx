'use client'

import * as React from 'react'
import {
  Check,
  Copy,
  Crop as CropIcon,
  ImagePlus,
  Loader2,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface CropImagesResult {
  /** Natural-pixel crop rects, keyed by file name. */
  crops: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >
}

interface CropImagesViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: CropImagesResult | null) => void
}

type Ratio = 'free' | 'original' | '1:1' | '4:3' | '16:9'

/** Crop rect in relative (0..1) coordinates so it survives rescaling. */
interface RelRect {
  x: number
  y: number
  w: number
  h: number
}

interface ImageMeta {
  url: string
  width: number
  height: number
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

const HANDLE_SIZE = 12
const MIN_SIZE = 24
/** Default selection covers this fraction of the smaller container axis. */
const DEFAULT_COVER = 0.6

const RATIO_PRESETS: { id: Ratio; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
]

function ratioValue(ratio: Ratio, natural: ImageMeta | null): number | null {
  if (ratio === 'free') return null
  if (ratio === 'original') {
    return natural ? natural.width / natural.height : null
  }
  if (ratio === '1:1') return 1
  if (ratio === '4:3') return 4 / 3
  return 16 / 9
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

function relToPx(rel: RelRect, cw: number, ch: number): PxRect {
  return { x: rel.x * cw, y: rel.y * ch, width: rel.w * cw, height: rel.h * ch }
}

/**
 * Resize by moving ONLY the edges/corner the user grabbed.
 * Every untouched edge stays exactly where it is. When a ratio is active,
 * the dominant axis follows the pointer and the derived axis is anchored
 * on the opposite edge of the grabbed handle.
 */
function resizeWithHandles(
  dm: DragMode,
  start: PxRect,
  dx: number,
  dy: number,
  cw: number,
  ch: number,
  ratio: number | null
): PxRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  // 1) Move only the grabbed edges.
  if (dm.includes('w')) left = start.x + dx
  if (dm.includes('e')) right = start.x + start.width + dx
  if (dm.includes('n')) top = start.y + dy
  if (dm.includes('s')) bottom = start.y + start.height + dy

  // 2) Min size on each moved edge, anchored to the opposite edge.
  if (dm.includes('w') && right - left < MIN_SIZE) left = right - MIN_SIZE
  if (dm.includes('e') && right - left < MIN_SIZE) right = left + MIN_SIZE
  if (dm.includes('n') && bottom - top < MIN_SIZE) top = bottom - MIN_SIZE
  if (dm.includes('s') && bottom - top < MIN_SIZE) bottom = top + MIN_SIZE

  // 3) Keep inside the container without crossing the opposite edge.
  left = clamp(left, 0, cw)
  right = clamp(right, 0, cw)
  top = clamp(top, 0, ch)
  bottom = clamp(bottom, 0, ch)
  if (right - left < MIN_SIZE) {
    if (dm.includes('w')) left = Math.max(0, right - MIN_SIZE)
    else right = Math.min(cw, left + MIN_SIZE)
  }
  if (bottom - top < MIN_SIZE) {
    if (dm.includes('n')) top = Math.max(0, bottom - MIN_SIZE)
    else bottom = Math.min(ch, top + MIN_SIZE)
  }

  // 4) Ratio: dominant axis follows the pointer, other axis derived + anchored.
  if (ratio) {
    const heightDominant = dm === 'resize-n' || dm === 'resize-s'
    let w = right - left
    let h = bottom - top
    if (heightDominant) {
      w = h * ratio
      if (w > cw) {
        w = cw
        h = w / ratio
      }
    } else {
      h = w / ratio
      if (h > ch) {
        h = ch
        w = h * ratio
      }
    }
    if (dm.includes('w')) left = right - w
    else right = left + w
    if (dm.includes('n')) top = bottom - h
    else bottom = top + h
    left = clamp(left, 0, cw)
    right = clamp(right, 0, cw)
    top = clamp(top, 0, ch)
    bottom = clamp(bottom, 0, ch)
  }

  const width = right - left
  const height = bottom - top
  if (width < 2 || height < 2) return start
  return { x: left, y: top, width, height }
}

/** New rect drawn from an anchor point toward the pointer. */
function createRect(
  anchor: PxPoint,
  pos: PxPoint,
  cw: number,
  ch: number,
  ratio: number | null
): PxRect {
  const dirX = pos.x >= anchor.x ? 1 : -1
  const dirY = pos.y >= anchor.y ? 1 : -1
  const maxW = dirX === 1 ? cw - anchor.x : anchor.x
  const maxH = dirY === 1 ? ch - anchor.y : anchor.y
  let w = Math.min(Math.abs(pos.x - anchor.x), maxW)
  let h = Math.min(Math.abs(pos.y - anchor.y), maxH)
  if (ratio) {
    h = w / ratio
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
  }
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

/** Adjust an existing rect to a ratio, keeping its center. */
function fitRectToRatio(
  rect: PxRect,
  ratio: number,
  cw: number,
  ch: number
): PxRect {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  let w = rect.width
  let h = rect.height
  if (rect.width / rect.height > ratio) h = w / ratio
  else w = h * ratio
  const scale = Math.min(1, cw / w, ch / h)
  w *= scale
  h *= scale
  if (w < MIN_SIZE) {
    w = MIN_SIZE
    h = w / ratio
  }
  if (h < MIN_SIZE) {
    h = MIN_SIZE
    w = h * ratio
  }
  if (w > cw) {
    w = cw
    h = w / ratio
  }
  if (h > ch) {
    h = ch
    w = h * ratio
  }
  return {
    x: clamp(cx - w / 2, 0, Math.max(0, cw - w)),
    y: clamp(cy - h / 2, 0, Math.max(0, ch - h)),
    width: w,
    height: h,
  }
}

/** Centered default selection (used when a preset is clicked with no rect). */
function defaultRect(ratio: number | null, cw: number, ch: number): PxRect {
  const r = ratio ?? cw / ch
  let w = cw * DEFAULT_COVER
  let h = w / r
  if (h > ch * DEFAULT_COVER) {
    h = ch * DEFAULT_COVER
    w = h * r
  }
  return { x: (cw - w) / 2, y: (ch - h) / 2, width: w, height: h }
}

function hitTest(pos: PxPoint, rect: PxRect): DragMode | null {
  const { x, y } = pos
  const left = rect.x
  const top = rect.y
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const h = HANDLE_SIZE

  if (Math.abs(x - left) < h && Math.abs(y - top) < h) return 'resize-nw'
  if (Math.abs(x - right) < h && Math.abs(y - top) < h) return 'resize-ne'
  if (Math.abs(x - left) < h && Math.abs(y - bottom) < h) return 'resize-sw'
  if (Math.abs(x - right) < h && Math.abs(y - bottom) < h) return 'resize-se'
  if (Math.abs(y - top) < h && x > left && x < right) return 'resize-n'
  if (Math.abs(y - bottom) < h && x > left && x < right) return 'resize-s'
  if (Math.abs(x - left) < h && y > top && y < bottom) return 'resize-w'
  if (Math.abs(x - right) < h && y > top && y < bottom) return 'resize-e'
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function CropImagesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: CropImagesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [relCrops, setRelCrops] = React.useState<Record<string, RelRect>>({})
  const [ratio, setRatio] = React.useState<Ratio>('free')
  const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 })

  const containerRef = React.useRef<HTMLDivElement>(null)
  // Drag session state — only ever read/written inside pointer event
  // handlers, so mutating it outside render is safe (and lint-clean).
  // `ratio` locks the aspect ratio for the whole drag, `lastRect` keeps the
  // newest px rect so the drag-end check never depends on render timing.
  const drag = React.useRef<{
    mode: DragMode | 'creating'
    anchor: PxPoint
    start: PxRect | null
    box: { w: number; h: number }
    ratio: number | null
    lastRect: PxRect | null
  } | null>(null)

  const urlsRef = React.useRef<Record<string, string>>({})

  /* ---------------- Load image metadata (size + object URL) ------------- */
  React.useEffect(() => {
    let cancelled = false

    setMeta((prev) => {
      const next: Record<string, ImageMeta> = {}
      for (const f of files) {
        if (prev[f.id]) next[f.id] = prev[f.id]
      }
      for (const id of Object.keys(urlsRef.current)) {
        if (!next[id] && urlsRef.current[id]) {
          URL.revokeObjectURL(urlsRef.current[id])
          delete urlsRef.current[id]
        }
      }
      return next
    })

    const missing = files.filter((f) => !urlsRef.current[f.id])
    for (const f of missing) {
      const url = URL.createObjectURL(f.file)
      urlsRef.current[f.id] = url
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        setMeta((prev) => ({
          ...prev,
          [f.id]: {
            url,
            width: img.naturalWidth || 1,
            height: img.naturalHeight || 1,
          },
        }))
      }
      img.onerror = () => {
        if (cancelled) return
        setMeta((prev) => ({
          ...prev,
          [f.id]: { url, width: 1, height: 1 },
        }))
      }
      img.src = url
    }

    return () => {
      cancelled = true
    }
  }, [files])

  // Revoke everything on unmount.
  React.useEffect(() => {
    const urls = urlsRef.current
    return () => {
      for (const id of Object.keys(urls)) URL.revokeObjectURL(urls[id])
    }
  }, [])

  /* ---------------- Keep a valid active selection ------------------------ */
  React.useEffect(() => {
    if (files.length === 0) {
      setActiveId(null)
      return
    }
    if (!activeId || !files.some((f) => f.id === activeId)) {
      const firstWithoutCrop = files.find((f) => !relCrops[f.id]) ?? files[0]
      setActiveId(firstWithoutCrop.id)
    }
  }, [files, activeId, relCrops])

  /* ---------------- Editing state for the active image ------------------- */
  // NOTE: must be declared before the layout effect below — dependency arrays
  // evaluate synchronously during render, so referencing `activeMeta` from a
  // later `const` would throw a TDZ ReferenceError.
  const activeFile = files.find((f) => f.id === activeId) ?? null
  const activeMeta = activeId ? meta[activeId] ?? null : null
  const activeRel = activeId ? relCrops[activeId] ?? null : null

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
  // switching images (this was the source of stretched/contracted rects).
  React.useLayoutEffect(() => {
    updateSize()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(updateSize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeId, activeMeta, updateSize])

  /* ---------------- Emit result whenever crops change -------------------- */
  const croppedCount = files.filter((f) => relCrops[f.id]).length

  React.useEffect(() => {
    const crops: CropImagesResult['crops'] = {}
    for (const f of files) {
      const rel = relCrops[f.id]
      const m = meta[f.id]
      if (rel && m) {
        crops[f.file.name] = {
          x: Math.round(rel.x * m.width),
          y: Math.round(rel.y * m.height),
          width: Math.max(1, Math.round(rel.w * m.width)),
          height: Math.max(1, Math.round(rel.h * m.height)),
        }
      }
    }
    onChange(Object.keys(crops).length > 0 ? { crops } : null)
  }, [files, relCrops, meta, onChange])

  const setRelFromPx = React.useCallback(
    (rect: PxRect | null, box: { w: number; h: number }) => {
      if (!activeId) return
      setRelCrops((prev) => {
        const next = { ...prev }
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          delete next[activeId]
        } else {
          next[activeId] = {
            x: rect.x / box.w,
            y: rect.y / box.h,
            w: rect.width / box.w,
            h: rect.height / box.h,
          }
        }
        return next
      })
    },
    [activeId]
  )

  const activePx: PxRect | null =
    activeRel && containerSize.w > 0 && containerSize.h > 0
      ? relToPx(activeRel, containerSize.w, containerSize.h)
      : null

  /* ---------------- Pointer interaction ----------------------------------- */
  const posFromEvent = (e: React.PointerEvent): PxPoint => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: clamp(e.clientX - r.left, 0, r.width),
      y: clamp(e.clientY - r.top, 0, r.height),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!activeMeta || e.button !== 0) return
    const el = containerRef.current
    if (!el) return
    const box = { w: el.clientWidth, h: el.clientHeight }
    if (!box.w || !box.h) return
    // Capture the pointer: drags keep working even when the cursor leaves
    // the image, and the up-event can never be missed.
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // ignore — capture is best-effort
    }
    const pos = posFromEvent(e)
    const px = activeRel ? relToPx(activeRel, box.w, box.h) : null
    const hit = px ? hitTest(pos, px) : null
    // Lock the aspect ratio for the entire drag at pointer-down time.
    const dragRatio = ratioValue(ratio, activeMeta)
    if (hit && px) {
      drag.current = {
        mode: hit,
        anchor: pos,
        start: { ...px },
        box,
        ratio: dragRatio,
        lastRect: { ...px },
      }
    } else {
      const seed = { x: pos.x, y: pos.y, width: 0, height: 0 }
      drag.current = {
        mode: 'creating',
        anchor: pos,
        start: null,
        box,
        ratio: dragRatio,
        lastRect: seed,
      }
      setRelFromPx(seed, box)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const pos = posFromEvent(e)
    const { w: cw, h: ch } = d.box
    if (d.mode === 'creating') {
      const r = createRect(d.anchor, pos, cw, ch, d.ratio)
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
    const next = resizeWithHandles(d.mode, d.start, dx, dy, cw, ch, d.ratio)
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

  /* ---------------- Toolbar actions --------------------------------------- */
  const applyRatioPreset = (r: Ratio) => {
    setRatio(r)
    const el = containerRef.current
    if (!el || !activeMeta) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (!cw || !ch) return
    const box = { w: cw, h: ch }
    if (r === 'free') {
      // Free with nothing selected: show a default centered rect.
      if (!activeRel) setRelFromPx(defaultRect(null, cw, ch), box)
      return
    }
    const ratio = ratioValue(r, activeMeta)
    if (!ratio) return
    if (activeRel) {
      // Keep the user's placement: adjust the existing rect to the ratio.
      setRelFromPx(fitRectToRatio(relToPx(activeRel, cw, ch), ratio, cw, ch), box)
    } else {
      // No rect yet: immediately show one at the chosen ratio.
      setRelFromPx(defaultRect(ratio, cw, ch), box)
    }
  }

  const selectFull = () => {
    const el = containerRef.current
    if (!el || !activeId) return
    const box = { w: el.clientWidth, h: el.clientHeight }
    setRelFromPx({ x: 0, y: 0, width: box.w, height: box.h }, box)
  }

  const resetCrop = () => {
    if (!activeId) return
    setRelCrops((prev) => {
      const next = { ...prev }
      delete next[activeId]
      return next
    })
  }

  const copyToAll = () => {
    if (!activeRel) return
    setRelCrops(() => {
      const next: Record<string, RelRect> = {}
      for (const f of files) {
        next[f.id] = { ...activeRel }
      }
      return next
    })
  }

  const removeItem = (id: string) => {
    setRelCrops((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    onRemove(id)
  }

  /* ---------------- Render ------------------------------------------------- */
  const loadingMeta = files.some((f) => !meta[f.id])

  if (files.length === 0) return null

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Draw a crop region on each image — switch images below. When you are
          done, hit{' '}
          <span className="font-medium text-foreground">Run Crop Images</span>{' '}
          to apply.
        </p>
        {croppedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" />
            {croppedCount} of {files.length} cropped
          </span>
        )}
      </div>

      {/* Crop editor */}
      {loadingMeta && !activeMeta ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading images…</p>
        </div>
      ) : activeMeta && activeFile ? (
        <>
          {/* Ratio presets + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {RATIO_PRESETS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => applyRatioPreset(r.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    ratio === r.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/70'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={selectFull}
                className="gap-1.5"
              >
                <Square className="h-3.5 w-3.5" /> Full area
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={resetCrop}
                disabled={!activeRel}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={copyToAll}
                disabled={!activeRel || files.length < 2}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" /> Copy to all
              </Button>
            </div>
          </div>

          {/* Image + overlay */}
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
              {/* Active image */}
              <img
                src={activeMeta.url}
                alt={activeFile.file.name}
                className="block max-h-[60vh] w-auto max-w-full"
                draggable={false}
              />

              {activePx && activePx.width > 0 && (
                <>
                  {/* Dimmed area outside the crop */}
                  <div
                    className="pointer-events-none absolute inset-0 bg-black/40"
                    style={{
                      clipPath: `polygon(0 0, 0 100%, ${activePx.x}px 100%, ${activePx.x}px ${activePx.y}px, ${activePx.x + activePx.width}px ${activePx.y}px, ${activePx.x + activePx.width}px ${activePx.y + activePx.height}px, ${activePx.x}px ${activePx.y + activePx.height}px, ${activePx.x}px 100%, 100% 100%, 100% 0)`,
                    }}
                  />
                  {/* Selection border + thirds guide + handles */}
                  <div
                    className="pointer-events-none absolute border-2 border-primary"
                    style={{
                      left: activePx.x,
                      top: activePx.y,
                      width: activePx.width,
                      height: activePx.height,
                    }}
                  >
                    <div className="absolute inset-0">
                      <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
                      <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
                      <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
                      <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
                    </div>
                    {(['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const).map(
                      (h) => {
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
                        const dm = ('resize-' + h) as DragMode
                        handleStyle.cursor = HANDLE_CURSORS[dm]
                        return <div key={h} style={handleStyle} />
                      }
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Crop dimensions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Editing:{' '}
              <span className="font-medium text-foreground">
                {activeFile.file.name}
              </span>{' '}
              ({activeMeta.width}×{activeMeta.height})
            </p>
            {activePx && activeMeta && containerSize.w > 0 && (
              <p className="text-xs text-muted-foreground">
                Crop:{' '}
                <strong className="text-foreground">
                  {Math.max(
                    1,
                    Math.round(
                      (activePx.width / containerSize.w) * activeMeta.width
                    )
                  )}
                  ×
                  {Math.max(
                    1,
                    Math.round(
                      (activePx.height / containerSize.h) * activeMeta.height
                    )
                  )}
                </strong>{' '}
                px
              </p>
            )}
          </div>
        </>
      ) : null}

      {/* Batch queue strip */}
      <div className="border-t border-border/60 pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Click an image to edit it:
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {files.map((f) => {
            const m = meta[f.id]
            const done = !!relCrops[f.id]
            const isActive = activeId === f.id
            return (
              <div
                key={f.id}
                className={cn(
                  'group relative shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                  isActive
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(f.id)}
                  className="block cursor-pointer"
                  aria-label={`Edit ${f.file.name}`}
                >
                  {m ? (
                    <img
                      src={m.url}
                      alt={f.file.name}
                      className="h-20 w-28 bg-muted object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="grid h-20 w-28 place-items-center bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1.5 py-0.5 text-left text-[9px] font-medium text-white">
                    {f.file.name} · {formatBytes(f.file.size)}
                  </span>
                  {done && (
                    <span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(f.id)}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                  aria-label={`Remove ${f.file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}

          {/* Add more tile */}
          <button
            type="button"
            onClick={onAddMore}
            className="grid h-20 w-28 shrink-0 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            aria-label="Add more images"
          >
            <span className="flex flex-col items-center gap-1">
              <ImagePlus className="h-5 w-5" />
              <span className="text-[10px] font-medium">Add more</span>
            </span>
          </button>
        </div>
      </div>

      {/* No crop drawn hint */}
      {croppedCount === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
          <CropIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <p className="text-muted-foreground">
            Draw a crop region on at least one image to enable processing.
            Images without a crop will be skipped. Use{' '}
            <span className="font-medium text-foreground">Copy to all</span> to
            apply the same crop region to every image at once.
          </p>
        </div>
      )}
    </div>
  )
}
