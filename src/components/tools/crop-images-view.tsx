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

type DragMode =
  | 'none'
  | 'creating'
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
const MIN_SIZE = 24

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

function clampRect(rect: PxRect, cw: number, ch: number): PxRect {
  let { x, y, width, height } = rect
  x = Math.max(0, x)
  y = Math.max(0, y)
  if (x + width > cw) width = cw - x
  if (y + height > ch) height = ch - y
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) }
}

/** Enforce a ratio on a rect while keeping it inside the container. */
function fitRatio(
  rect: PxRect,
  ratio: number,
  cw: number,
  ch: number
): PxRect {
  const r = clampRect(rect, cw, ch)
  let width = r.width
  let height = width / ratio
  if (height > ch) {
    height = ch
    width = height * ratio
  }
  if (width > cw) {
    width = cw
    height = width / ratio
  }
  return clampRect({ x: r.x, y: r.y, width, height }, cw, ch)
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
  const dragMode = React.useRef<DragMode>('none')
  const dragStart = React.useRef({ x: 0, y: 0, rect: null as PxRect | null })
  const urlsRef = React.useRef<Record<string, string>>({})

  /* ---------------- Load image metadata (size + object URL) ------------- */
  React.useEffect(() => {
    let cancelled = false

    // Prune metadata + revoke URLs for removed files.
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

    // Load metadata for new files.
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
      const firstWithoutCrop =
        files.find((f) => !relCrops[f.id]) ?? files[0]
      setActiveId(firstWithoutCrop.id)
    }
  }, [files, activeId, relCrops])

  /* ---------------- Track container size --------------------------------- */
  React.useEffect(() => {
    if (!containerRef.current) return
    const update = () => {
      if (containerRef.current) {
        setContainerSize({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight,
        })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [activeId, meta])

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

  /* ---------------- Editing state for the active image ------------------- */
  const activeFile = files.find((f) => f.id === activeId) ?? null
  const activeMeta = activeId ? meta[activeId] ?? null : null
  const activeRel = activeId ? relCrops[activeId] ?? null : null
  const activeRatio = ratioValue(ratio, activeMeta)

  const setPxRect = React.useCallback(
    (rect: PxRect | null) => {
      if (!activeId || !containerSize.w || !containerSize.h) return
      setRelCrops((prev) => {
        const next = { ...prev }
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          delete next[activeId]
        } else {
          next[activeId] = {
            x: rect.x / containerSize.w,
            y: rect.y / containerSize.h,
            w: rect.width / containerSize.w,
            h: rect.height / containerSize.h,
          }
        }
        return next
      })
    },
    [activeId, containerSize]
  )

  const activePx: PxRect | null =
    activeRel && containerSize.w > 0 && containerSize.h > 0
      ? {
          x: activeRel.x * containerSize.w,
          y: activeRel.y * containerSize.h,
          width: activeRel.w * containerSize.w,
          height: activeRel.h * containerSize.h,
        }
      : null

  /* ---------------- Mouse interaction ------------------------------------ */
  const getMousePos = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    }
  }

  const hitTest = (pos: { x: number; y: number }, rect: PxRect): DragMode => {
    if (!rect || rect.width === 0) return 'none'
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
    return 'none'
  }

  const applyDragRatio = (
    dm: DragMode,
    rect: PxRect,
    startRect: PxRect
  ): PxRect => {
    if (!activeRatio || containerSize.w === 0 || containerSize.h === 0)
      return rect
    const ratio = activeRatio
    const r = { ...rect }
    const isHeightDominant = dm === 'resize-n' || dm === 'resize-s'
    if (isHeightDominant) {
      const width = r.height * ratio
      if (dm === 'resize-n' || dm.includes('w')) {
        r.x = startRect.x + startRect.width - width
      }
      r.width = width
    } else {
      const height = r.width / ratio
      if (dm === 'resize-n' || dm.includes('n')) {
        r.y = startRect.y + startRect.height - height
      }
      r.height = height
    }
    return r
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!activeMeta) return
    const pos = getMousePos(e)
    if (activePx) {
      const hit = hitTest(pos, activePx)
      if (hit !== 'none') {
        dragMode.current = hit
        dragStart.current = { x: pos.x, y: pos.y, rect: { ...activePx } }
        return
      }
    }
    dragMode.current = 'creating'
    dragStart.current = { x: pos.x, y: pos.y, rect: null }
    setPxRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragMode.current === 'none') return
    const pos = getMousePos(e)
    const start = dragStart.current
    const { w: cw, h: ch } = containerSize
    if (cw === 0 || ch === 0) return

    if (dragMode.current === 'creating') {
      const dirX = pos.x >= start.x ? 1 : -1
      const dirY = pos.y >= start.y ? 1 : -1
      let width = Math.abs(pos.x - start.x)
      let height = Math.abs(pos.y - start.y)
      const maxW = dirX === 1 ? cw - start.x : start.x
      const maxH = dirY === 1 ? ch - start.y : start.y
      if (activeRatio) {
        height = width / activeRatio
        if (height > maxH) {
          height = maxH
          width = height * activeRatio
        }
        if (width > maxW) {
          width = maxW
          height = width / activeRatio
        }
      } else {
        width = Math.min(width, maxW)
        height = Math.min(height, maxH)
      }
      const x = dirX === 1 ? start.x : start.x - width
      const y = dirY === 1 ? start.y : start.y - height
      setPxRect(clampRect({ x, y, width, height }, cw, ch))
      return
    }

    if (dragMode.current === 'moving' && start.rect) {
      const dx = pos.x - start.x
      const dy = pos.y - start.y
      const newX = Math.max(
        0,
        Math.min(start.rect.x + dx, cw - start.rect.width)
      )
      const newY = Math.max(
        0,
        Math.min(start.rect.y + dy, ch - start.rect.height)
      )
      setPxRect({ ...start.rect, x: newX, y: newY })
      return
    }

    if (start.rect) {
      const dm = dragMode.current
      const dx = pos.x - start.x
      const dy = pos.y - start.y
      let { x, y, width, height } = start.rect
      if (dm.includes('w')) {
        x = start.rect.x + dx
        width = start.rect.width - dx
      }
      if (dm.includes('e')) width = start.rect.width + dx
      if (dm.includes('n')) {
        y = start.rect.y + dy
        height = start.rect.height - dy
      }
      if (dm.includes('s')) height = start.rect.height + dy
      if (width < MIN_SIZE) {
        if (dm.includes('w')) x = start.rect.x + start.rect.width - MIN_SIZE
        width = MIN_SIZE
      }
      if (height < MIN_SIZE) {
        if (dm.includes('n')) y = start.rect.y + start.rect.height - MIN_SIZE
        height = MIN_SIZE
      }
      let rect = clampRect({ x, y, width, height }, cw, ch)
      rect = applyDragRatio(dm, rect, start.rect)
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        rect = start.rect
      }
      setPxRect(rect)
    }
  }

  const handleMouseUp = () => {
    if (dragMode.current === 'creating' && activePx) {
      if (activePx.width < MIN_SIZE || activePx.height < MIN_SIZE) {
        setPxRect(null)
      }
    }
    dragMode.current = 'none'
  }

  /* ---------------- Toolbar actions -------------------------------------- */
  const selectFull = () => {
    if (!activeId || containerSize.w === 0) return
    setPxRect({
      x: 0,
      y: 0,
      width: containerSize.w,
      height: containerSize.h,
    })
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

  /* ---------------- Render ------------------------------------------------ */
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
                  onClick={() => setRatio(r.id)}
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
                disabled={!activeMeta}
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
              style={{ maxWidth: '100%', lineHeight: 0 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
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
                  {/* Thirds guide */}
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
                        const cursors: Record<string, string> = {
                          nw: 'nwse-resize',
                          ne: 'nesw-resize',
                          sw: 'nesw-resize',
                          se: 'nwse-resize',
                          n: 'ns-resize',
                          s: 'ns-resize',
                          e: 'ew-resize',
                          w: 'ew-resize',
                        }
                        handleStyle.cursor = cursors[h]
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
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>
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
                </span>
              </div>
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
