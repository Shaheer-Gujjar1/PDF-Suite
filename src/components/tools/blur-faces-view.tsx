'use client'

import * as React from 'react'
import {
  Circle,
  Copy,
  ImagePlus,
  Loader2,
  MousePointer2,
  ScanFace,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------------ */
/* Blur Face — drag rectangles / ellipses anywhere on the image, stack as    */
/* many as needed, dial the blur strength. Shape coords are normalized 0..1  */
/* so they scale to every image size; the worker mirrors this preview with   */
/* a three-pass box blur (processors['blur-faces']). Keep the radius math    */
/* (blurRadiusPx) and clip shapes in sync with the worker.                   */
/* ------------------------------------------------------------------------ */

export type BlurShapeType = 'rect' | 'ellipse'

export interface BlurShape {
  id: string
  type: BlurShapeType
  /** 0..1, top-left corner, relative to image dimensions. */
  x: number
  y: number
  /** 0..1 of image dimensions. */
  w: number
  h: number
}

export interface BlurFacesResult {
  /** Per-image shapes, keyed by file name (matches worker lookup). */
  shapes: Record<string, BlurShape[]>
  /** 1..100 — drives the censor radius, scaled by each image's size. */
  strength: number
}

type DrawMode = 'move' | BlurShapeType

interface BlurFacesViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: BlurFacesResult | null) => void
}

interface ImageMeta {
  url: string
  width: number
  height: number
}

const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, hsl(var(--border) / 0.35) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--border) / 0.35) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.35) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.35) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
}

let counter = 0
function uid(): string {
  counter += 1
  return `bf_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 6)}`
}

/** Fresh shapes land centred, slightly above middle — where faces usually are. */
function makeShape(type: BlurShapeType, geom?: Partial<BlurShape>): BlurShape {
  const w = type === 'ellipse' ? 0.26 : 0.3
  const h = type === 'ellipse' ? 0.3 : 0.22
  return {
    id: uid(),
    type,
    x: 0.5 - w / 2,
    y: 0.42 - h / 2,
    w,
    h,
    ...geom,
  }
}

/* ---------------- Shared math (mirrored by the worker) -------------------- */

/** Worker box radius: strength% of a quarter of the image's short side. */
function blurRadiusPx(strength: number, natW: number, natH: number): number {
  const base = (strength / 100) * 0.25 * Math.min(natW, natH)
  return Math.min(400, Math.max(2, Math.round(base)))
}

/** clip-path that reveals exactly the shape region of a full-size overlay. */
function clipPathFor(s: Pick<BlurShape, 'type' | 'x' | 'y' | 'w' | 'h'>): string {
  const p = (n: number) => `${(n * 100).toFixed(3)}%`
  if (s.type === 'rect') {
    return `inset(${p(s.y)} ${p(1 - s.x - s.w)} ${p(1 - s.y - s.h)} ${p(s.x)})`
  }
  return `ellipse(${p(s.w / 2)} ${p(s.h / 2)} at ${p(s.x + s.w / 2)} ${p(s.y + s.h / 2)})`
}

const HANDLES = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
] as const

function cursorFor(handle: string): string {
  if (handle === 'n' || handle === 's') return 'ns-resize'
  if (handle === 'e' || handle === 'w') return 'ew-resize'
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize'
  return 'nwse-resize'
}

/* ------------------------------------------------------------------------ */
/* Live stage — base image + per-shape blurred overlays + interaction layer  */
/* ------------------------------------------------------------------------ */
function BlurStage({
  file,
  shapes,
  activeShapeId,
  drawMode,
  strength,
  onSelect,
  onPatch,
  onAdd,
  onDeleteActive,
}: {
  file: File
  shapes: BlurShape[]
  activeShapeId: string | null
  drawMode: DrawMode
  strength: number
  onSelect: (id: string | null) => void
  onPatch: (id: string, patch: Partial<BlurShape>) => void
  onAdd: (type: BlurShapeType, geom: { x: number; y: number; w: number; h: number }) => void
  onDeleteActive: () => void
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const [src, setSrc] = React.useState<string | null>(null)
  const [baseImg, setBaseImg] = React.useState<HTMLImageElement | null>(null)
  const [disp, setDisp] = React.useState({ w: 0, h: 0 })
  const [ghost, setGhost] = React.useState<BlurShape | null>(null)
  const dragRef = React.useRef<
    | null
    | {
        kind: 'move' | 'resize' | 'draw'
        id?: string
        handle?: string
        startX: number
        startY: number
        orig?: BlurShape
      }
  >(null)

  /* Load the base image (url kept for the blurred overlay clones). */
  React.useEffect(() => {
    let cancelled = false
    setBaseImg(null)
    setSrc(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setSrc(url)
      setBaseImg(img)
    }
    img.onerror = () => {
      if (!cancelled) setBaseImg(null)
    }
    img.src = url
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file])

  /* Track the displayed size so the CSS blur matches the worker's radius. */
  React.useEffect(() => {
    const el = wrapRef.current
    if (!el || !baseImg) return
    const update = () => setDisp({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [baseImg])

  const natW = baseImg?.naturalWidth || 1
  const natH = baseImg?.naturalHeight || 1
  const radius = blurRadiusPx(strength, natW, natH)
  const shortSide = Math.min(disp.w, disp.h)
  const cssBlur = disp.w > 0 && shortSide > 0 ? Math.max(1, radius * (shortSide / Math.min(natW, natH))) : 0

  const toPct = (e: React.PointerEvent) => {
    const el = overlayRef.current!
    const rect = el.getBoundingClientRect()
    return {
      px: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      py: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const capture = (e: React.PointerEvent) => {
    try {
      overlayRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* ignore — drag still works while the pointer stays inside */
    }
  }

  const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const { px, py } = toPct(e)
    if (drawMode === 'move') {
      onSelect(null)
      return
    }
    const ghostType: BlurShapeType = drawMode === 'rect' ? 'rect' : 'ellipse'
    dragRef.current = { kind: 'draw', startX: px, startY: py }
    setGhost({ id: '__ghost', type: ghostType, x: px, y: py, w: 0, h: 0 })
    capture(e)
  }

  const startMove = (e: React.PointerEvent, s: BlurShape) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const { px, py } = toPct(e)
    onSelect(s.id)
    dragRef.current = { kind: 'move', id: s.id, orig: s, startX: px, startY: py }
    capture(e)
  }

  const startResize = (e: React.PointerEvent, s: BlurShape, handle: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const { px, py } = toPct(e)
    onSelect(s.id)
    dragRef.current = { kind: 'resize', id: s.id, handle, orig: s, startX: px, startY: py }
    capture(e)
  }

  const onOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const { px, py } = toPct(e)
    const MIN = 0.02
    if (d.kind === 'move' && d.orig && d.id) {
      const nx = Math.min(1 - d.orig.w, Math.max(0, d.orig.x + (px - d.startX)))
      const ny = Math.min(1 - d.orig.h, Math.max(0, d.orig.y + (py - d.startY)))
      onPatch(d.id, { x: nx, y: ny })
    } else if (d.kind === 'resize' && d.orig && d.id) {
      const o = d.orig
      const h = d.handle || 'se'
      let x1 = o.x
      let y1 = o.y
      let x2 = o.x + o.w
      let y2 = o.y + o.h
      if (h.includes('w')) x1 = Math.min(px, x2 - MIN)
      if (h.includes('e')) x2 = Math.max(px, x1 + MIN)
      if (h.includes('n')) y1 = Math.min(py, y2 - MIN)
      if (h.includes('s')) y2 = Math.max(py, y1 + MIN)
      x1 = Math.max(0, x1)
      y1 = Math.max(0, y1)
      x2 = Math.min(1, x2)
      y2 = Math.min(1, y2)
      onPatch(d.id, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
    } else if (d.kind === 'draw') {
      setGhost({
        id: '__ghost',
        type: drawMode === 'rect' ? 'rect' : 'ellipse',
        x: Math.min(d.startX, px),
        y: Math.min(d.startY, py),
        w: Math.abs(px - d.startX),
        h: Math.abs(py - d.startY),
      })
    }
  }

  const onOverlayPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.kind === 'draw' && ghost) {
      if (ghost.w >= 0.015 && ghost.h >= 0.015) {
        onAdd(ghost.type, { x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h })
      }
    }
    setGhost(null)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60" style={CHECKER_BG}>
      {baseImg && src ? (
        <div
          ref={wrapRef}
          className="relative mx-auto w-fit outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          tabIndex={0}
          role="application"
          aria-label="Blur area editor — drag to draw, drag shapes to move"
          onKeyDown={(e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && activeShapeId) {
              e.preventDefault()
              onDeleteActive()
            }
          }}
        >
          <img
            src={src}
            alt={file.name}
            className="block h-auto max-h-[560px] w-auto max-w-full select-none"
            draggable={false}
          />
          <div
            ref={overlayRef}
            className={cn(
              'absolute inset-0 touch-none select-none',
              drawMode === 'move' ? 'cursor-default' : 'cursor-crosshair'
            )}
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerCancel={onOverlayPointerUp}
          >
            {/* Blurred pixels — one clipped clone per shape (CSS stands in for
                the worker's box blur; radius math matches). */}
            {cssBlur > 0 &&
              shapes.map((s) => (
                <img
                  key={`blur-${s.id}`}
                  src={src}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none"
                  style={{ filter: `blur(${cssBlur}px)`, clipPath: clipPathFor(s) }}
                />
              ))}

            {/* Interaction outlines */}
            {shapes.map((s, i) => {
              const active = s.id === activeShapeId
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={-1}
                  aria-label={`${s.type === 'ellipse' ? 'Face blur' : 'Box blur'} ${i + 1}`}
                  onPointerDown={(e) => startMove(e, s)}
                  className={cn(
                    'absolute cursor-move',
                    active
                      ? 'border-2 border-primary'
                      : 'border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] hover:border-primary/80'
                  )}
                  style={{
                    left: `${s.x * 100}%`,
                    top: `${s.y * 100}%`,
                    width: `${s.w * 100}%`,
                    height: `${s.h * 100}%`,
                    borderRadius: s.type === 'ellipse' ? '50%' : 6,
                  }}
                >
                  {active && (
                    <>
                      <span className="absolute -top-6 left-0 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow">
                        {s.type === 'ellipse' ? 'Face' : 'Box'} {i + 1}
                      </span>
                      {HANDLES.map(([h, fx, fy]) => (
                        <span
                          key={h}
                          onPointerDown={(e) => startResize(e, s, h)}
                          aria-label={`Resize handle ${h}`}
                          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow"
                          style={{
                            left: `${fx * 100}%`,
                            top: `${fy * 100}%`,
                            cursor: cursorFor(h),
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
              )
            })}

            {/* Ghost while drawing a new area */}
            {ghost && ghost.w > 0.002 && ghost.h > 0.002 && (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-white bg-white/25 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                style={{
                  left: `${ghost.x * 100}%`,
                  top: `${ghost.y * 100}%`,
                  width: `${ghost.w * 100}%`,
                  height: `${ghost.h * 100}%`,
                  borderRadius: ghost.type === 'ellipse' ? '50%' : 6,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="grid h-64 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Main view — editing studio                                                */
/* ------------------------------------------------------------------------ */
export function BlurFacesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: BlurFacesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [shapesByFile, setShapesByFile] = React.useState<Record<string, BlurShape[]>>({})
  const [activeImageId, setActiveImageId] = React.useState<string | null>(null)
  const [activeShapeId, setActiveShapeId] = React.useState<string | null>(null)
  const [drawMode, setDrawMode] = React.useState<DrawMode>('ellipse')
  const [strength, setStrength] = React.useState(40)
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
        setMeta((prev) => ({ ...prev, [f.id]: { url, width: 1, height: 1 } }))
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

  /* Keep the active image valid. */
  React.useEffect(() => {
    if (files.length === 0) {
      setActiveImageId(null)
      return
    }
    setActiveImageId((prev) =>
      prev && files.some((f) => f.id === prev) ? prev : files[0].id
    )
  }, [files])

  const activeFile = files.find((f) => f.id === activeImageId) ?? files[0] ?? null
  const activeShapes: BlurShape[] = activeFile ? shapesByFile[activeFile.id] ?? [] : []
  const activeShape = activeShapes.find((s) => s.id === activeShapeId) ?? null
  const activeMeta = activeFile ? meta[activeFile.id] ?? null : null

  /* Keep the active shape valid (per image). */
  React.useEffect(() => {
    if (!activeFile) {
      setActiveShapeId(null)
      return
    }
    const list = shapesByFile[activeFile.id] ?? []
    if (activeShapeId && list.some((s) => s.id === activeShapeId)) return
    setActiveShapeId(null)
  }, [activeFile, shapesByFile, activeShapeId])

  /* ---------------- Emit result whenever anything changes ---------------- */
  React.useEffect(() => {
    if (files.length === 0) {
      onChange(null)
      return
    }
    const result: Record<string, BlurShape[]> = {}
    for (const f of files) {
      result[f.file.name] = (shapesByFile[f.id] ?? []).map((s) => ({ ...s }))
    }
    onChange({ shapes: result, strength })
  }, [files, shapesByFile, strength, onChange])

  /* ---------------- Mutators --------------------------------------------- */
  const setShapes = (fileId: string, fn: (prev: BlurShape[]) => BlurShape[]) =>
    setShapesByFile((prev) => ({ ...prev, [fileId]: fn(prev[fileId] ?? []) }))

  const addShape = (type: BlurShapeType, geom?: { x: number; y: number; w: number; h: number }) => {
    if (!activeFile) return
    const s = makeShape(type, geom)
    setShapes(activeFile.id, (prev) => [...prev, s])
    setActiveShapeId(s.id)
  }

  const patchShape = (id: string, patch: Partial<BlurShape>) => {
    if (!activeFile) return
    setShapes(activeFile.id, (prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    )
  }

  const removeShape = (id: string) => {
    if (!activeFile) return
    setShapes(activeFile.id, (prev) => prev.filter((s) => s.id !== id))
  }

  const duplicateShape = () => {
    if (!activeFile || !activeShape) return
    const copy: BlurShape = {
      ...activeShape,
      id: uid(),
      x: Math.min(0.98 - activeShape.w, activeShape.x + 0.06),
      y: Math.min(0.98 - activeShape.h, activeShape.y + 0.06),
    }
    setShapes(activeFile.id, (prev) => [...prev, copy])
    setActiveShapeId(copy.id)
  }

  const clearAll = () => {
    if (!activeFile) return
    setShapes(activeFile.id, () => [])
    setActiveShapeId(null)
  }

  /** Copy this image's areas onto every other image (fresh ids). */
  const applyToAll = () => {
    if (!activeFile) return
    const src = shapesByFile[activeFile.id] ?? []
    setShapesByFile((prev) => {
      const next = { ...prev }
      for (const f of files) {
        if (f.id === activeFile.id) continue
        next[f.id] = src.map((s) => ({ ...s, id: uid() }))
      }
      return next
    })
  }

  const shapeLabel = (s: BlurShape, i: number) =>
    `${s.type === 'ellipse' ? 'Face' : 'Box'} ${i + 1}`

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------- Canvas column ------------------------- */}
        <div className="space-y-3">
          {/* Toolbar: draw modes + selected-shape quick actions */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/95 p-1 shadow-sm">
              {(
                [
                  ['move', 'Select', MousePointer2],
                  ['ellipse', 'Face', Circle],
                  ['rect', 'Box', Square],
                ] as const
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDrawMode(m)}
                  aria-label={m === 'move' ? 'Select and move areas' : `Draw ${label} blur areas`}
                  aria-pressed={drawMode === m}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                    drawMode === m
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {activeShape && (
              <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/95 p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => patchShape(activeShape.id, { type: 'ellipse' })}
                  aria-label="Convert this area to a face (ellipse)"
                  aria-pressed={activeShape.type === 'ellipse'}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg transition-colors',
                    activeShape.type === 'ellipse'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                >
                  <Circle className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => patchShape(activeShape.id, { type: 'rect' })}
                  aria-label="Convert this area to a box (rectangle)"
                  aria-pressed={activeShape.type === 'rect'}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg transition-colors',
                    activeShape.type === 'rect'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <div className="mx-0.5 h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={duplicateShape}
                  aria-label="Duplicate this area"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeShape(activeShape.id)}
                  aria-label="Delete this area"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            {/* Live stage */}
            {activeFile ? (
              <BlurStage
                file={activeFile.file}
                shapes={activeShapes}
                activeShapeId={activeShapeId}
                drawMode={drawMode}
                strength={strength}
                onSelect={setActiveShapeId}
                onPatch={patchShape}
                onAdd={(type, geom) => addShape(type, geom)}
                onDeleteActive={() => {
                  if (activeShapeId) removeShape(activeShapeId)
                }}
              />
            ) : (
              <div
                className="grid h-64 place-items-center rounded-2xl border border-border/60 text-sm text-muted-foreground"
                style={CHECKER_BG}
              >
                No image selected
              </div>
            )}

            {/* Area counter */}
            {activeShapes.length > 0 && (
              <div className="absolute left-4 top-4 z-10 rounded-full bg-background/85 px-3 py-1 text-xs font-semibold shadow backdrop-blur">
                {activeShapes.length} blur area{activeShapes.length === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {drawMode !== 'move' && (
            <p className="text-center text-xs text-muted-foreground">
              Drag on the image to draw a {drawMode === 'ellipse' ? 'face' : 'box'} blur area —
              draw as many as you need, then switch to Select to fine-tune.
            </p>
          )}

          {/* Queued images film strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {files.map((f) => {
              const active = f.id === activeFile?.id
              const url = meta[f.id]?.url
              const count = (shapesByFile[f.id] ?? []).length
              return (
                <div key={f.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveImageId(f.id)}
                    aria-label={`Edit blur areas on ${f.file.name}`}
                    aria-pressed={active}
                    className={cn(
                      'relative block h-14 w-20 overflow-hidden rounded-lg border-2 bg-muted transition-all',
                      active
                        ? 'border-primary'
                        : 'border-transparent opacity-80 hover:opacity-100'
                    )}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <Loader2 className="mx-auto mt-5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {count > 0 && (
                      <span className="absolute bottom-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {count}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(f.id)}
                    aria-label={`Remove ${f.file.name}`}
                    className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 place-items-center rounded-full bg-destructive text-white shadow group-hover:grid"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={onAddMore}
              aria-label="Add more images"
              className="grid h-14 w-20 shrink-0 place-items-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ------------------------- Sidebar column ------------------------ */}
        <div className="space-y-3">
          {/* Blur strength */}
          <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
            <p className="text-sm font-semibold">Blur strength</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Amount</Label>
                <span className="text-xs font-semibold text-primary">{strength}%</span>
              </div>
              <Slider
                value={[strength]}
                min={1}
                max={100}
                step={1}
                onValueChange={(v) => setStrength(v[0])}
                aria-label="Blur strength"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Scales with each image&apos;s size, so the same amount censors
                faces equally across all files. Higher = stronger and wider smear.
              </p>
            </div>
          </div>

          {/* Areas manager */}
          <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Blur areas</p>
              <span className="text-xs text-muted-foreground">
                {activeShapes.length} on this image
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => addShape('ellipse')}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <Circle className="h-4 w-4 text-primary" />
                Add face blur
              </button>
              <button
                type="button"
                onClick={() => addShape('rect')}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <Square className="h-4 w-4 text-primary" />
                Add box blur
              </button>
            </div>

            {activeShapes.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {activeShapes.map((s, i) => {
                  const active = s.id === activeShapeId
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveShapeId(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setActiveShapeId(s.id)
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {s.type === 'ellipse' ? (
                        <Circle className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{shapeLabel(s, i)}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeShape(s.id)
                        }}
                        aria-label={`Delete ${shapeLabel(s, i)}`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={clearAll}
                    className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    Clear all
                  </button>
                  {files.length > 1 && (
                    <button
                      type="button"
                      onClick={applyToAll}
                      className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      Apply to all images
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-border bg-card/60 p-3 text-center text-[11px] text-muted-foreground">
                No blur areas yet — drag on the image with the Face or Box tool,
                or use the buttons above.
              </p>
            )}
          </div>

          {/* Selected area editor */}
          {activeShape ? (
            <div className="rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {activeShape.type === 'ellipse' ? (
                    <Circle className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-primary" />
                  )}
                  Area settings
                </p>
                <button
                  type="button"
                  onClick={() => removeShape(activeShape.id)}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Delete this area"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['ellipse', 'Face', Circle],
                      ['rect', 'Box', Square],
                    ] as const
                  ).map(([t, label, Icon]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patchShape(activeShape.id, { type: t })}
                      aria-pressed={activeShape.type === t}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                        activeShape.type === t
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                {activeMeta && activeMeta.width > 1 && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    {Math.round(activeShape.w * activeMeta.width)}×
                    {Math.round(activeShape.h * activeMeta.height)} px · position{' '}
                    {Math.round(activeShape.x * activeMeta.width)},{' '}
                    {Math.round(activeShape.y * activeMeta.height)}
                    <br />
                    Drag the area to move it, or pull any of its 8 handles to resize.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-5 text-center">
              <p className="text-sm font-medium">Nothing selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click a blur area on the canvas to move, reshape or delete it —
                press Delete to remove the selected one.
              </p>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Editing live — the preview blur matches the baked output exactly.
          </p>
        </div>
      </div>

      {/* Hint */}
      <div className="flex items-start gap-3 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4 text-sm">
        <ScanFace className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
        <p className="text-muted-foreground">
          Pick an image from the film strip, choose Face or Box above the
          canvas, and drag anywhere to drop a blur area — stack as many as you
          need, then nudge them with the Select tool. Use &ldquo;Apply to all
          images&rdquo; for batches shot from the same spot. Output keeps the
          original size and format; everything is censored locally, files
          never leave your device.
        </p>
      </div>
    </div>
  )
}
