'use client'

import * as React from 'react'
import {
  Brush, Check, Crop as CropIcon, FlipHorizontal, FlipVertical, Frame as FrameIcon,
  Minus, Redo2, RotateCcw, RotateCw, Scaling, Shapes, SlidersHorizontal, Square,
  Trash2, Type, Undo2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface PhotoEditorResult {
  /** Edited PNG bytes, ready to download. */
  fileName: string
  data: ArrayBuffer
  width: number
  height: number
}

interface PhotoEditorViewProps {
  file: File
  onChange: (result: PhotoEditorResult | null) => void
}

/* ----------------------------- Data model ------------------------------- */

interface Adjustments {
  brightness: number // %, 100 = normal
  contrast: number // %, 100 = normal
  saturation: number // %, 100 = normal
  sepia: number // %, 0 = off
  blur: number // px at natural scale
}

interface FrameOpts {
  width: number // px at natural scale (0 = off)
  color: string
  radius: number // px corner radius at natural scale
}

interface Pt {
  x: number
  y: number
}

interface StrokeOverlay {
  kind: 'stroke'
  id: number
  color: string
  size: number
  points: Pt[]
}

interface ShapeOverlay {
  kind: 'shape'
  id: number
  shape: 'rect' | 'ellipse' | 'line'
  x: number
  y: number
  w: number
  h: number
  color: string
  size: number
  fill: boolean
}

interface TextOverlay {
  kind: 'text'
  id: number
  text: string
  x: number // left baseline origin
  y: number
  size: number
  color: string
  bold: boolean
  italic: boolean
}

type Overlay = StrokeOverlay | ShapeOverlay | TextOverlay

type EditorMode =
  | 'adjust'
  | 'crop'
  | 'transform'
  | 'resize'
  | 'draw'
  | 'text'
  | 'shapes'
  | 'frame'

const DEFAULT_ADJ: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sepia: 0,
  blur: 0,
}

const DEFAULT_FRAME: FrameOpts = { width: 0, color: '#ffffff', radius: 0 }

const ADJ_PRESETS: { id: string; label: string; adj: Adjustments }[] = [
  { id: 'none', label: 'Original', adj: { ...DEFAULT_ADJ } },
  { id: 'mono', label: 'Mono', adj: { ...DEFAULT_ADJ, saturation: 0, contrast: 110 } },
  { id: 'sepia', label: 'Sepia', adj: { ...DEFAULT_ADJ, sepia: 80, contrast: 105 } },
  { id: 'vivid', label: 'Vivid', adj: { ...DEFAULT_ADJ, saturation: 160, contrast: 115 } },
  { id: 'soft', label: 'Soft', adj: { ...DEFAULT_ADJ, brightness: 108, saturation: 90, blur: 0.6 } },
]

/* ------------------- Cropped-in selection geometry ----------------------- */
/* Faithful port of the proven crop-images selection system: mid-edge handles
   strictly single-axis, opposite edge anchored, min-size + container clamps
   respect the grab anchors, hardened hit-testing, pointer capture. */

const HANDLE_SIZE = 12
const MIN_SIZE = 20
const DEFAULT_COVER = 0.6

type Ratio = 'free' | 'original' | '1:1' | '4:3' | '16:9'

const RATIO_PRESETS: { id: Ratio; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '16:9', label: '16:9' },
]

function ratioValue(r: Ratio, w: number, h: number): number | null {
  if (r === 'free') return null
  if (r === 'original') return w / h
  if (r === '1:1') return 1
  if (r === '4:3') return 4 / 3
  return 16 / 9
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
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

/** Resize by moving ONLY the grabbed edges; opposite edges stay anchored. */
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

  // Parse the direction from the mode SUFFIX ('resize-n'.includes('e') is
  // true — never test the full string).
  const dir = dm.slice('resize-'.length)
  const grabW = dir.includes('w')
  const grabE = dir.includes('e')
  const grabN = dir.includes('n')
  const grabS = dir.includes('s')
  const isCorner = dir.length === 2

  if (grabW) left = start.x + dx
  if (grabE) right = start.x + start.width + dx
  if (grabN) top = start.y + dy
  if (grabS) bottom = start.y + start.height + dy

  if (grabW && right - left < MIN_SIZE) left = right - MIN_SIZE
  if (grabE && right - left < MIN_SIZE) right = left + MIN_SIZE
  if (grabN && bottom - top < MIN_SIZE) top = bottom - MIN_SIZE
  if (grabS && bottom - top < MIN_SIZE) bottom = top + MIN_SIZE

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

  // Ratio is enforced on corner drags only; width leads, height follows.
  if (ratio && isCorner) {
    const maxW = grabW ? right : cw - left
    const maxH = grabN ? bottom : ch - top
    let w = right - left
    let h = w / ratio
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    if (w > maxW) {
      w = maxW
      h = w / ratio
    }
    if (grabW) left = right - w
    else right = left + w
    if (grabN) top = bottom - h
    else bottom = top + h
  }

  const width = right - left
  const height = bottom - top
  if (width < 2 || height < 2) return start
  return { x: left, y: top, width, height }
}

/** New rect drawn from an anchor point toward the pointer. */
function createRect(anchor: PxPoint, pos: PxPoint, cw: number, ch: number, ratio: number | null): PxRect {
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
  if (w < 2 || h < 2) return { x: anchor.x, y: anchor.y, width: 0, height: 0 }
  return {
    x: dirX === 1 ? anchor.x : anchor.x - w,
    y: dirY === 1 ? anchor.y : anchor.y - h,
    width: w,
    height: h,
  }
}

function fitRectToRatio(rect: PxRect, ratio: number, cw: number, ch: number): PxRect {
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
  const hz = Math.min(HANDLE_SIZE, rect.width / 2)
  const vz = Math.min(HANDLE_SIZE, rect.height / 2)

  if (Math.abs(x - left) < hz && Math.abs(y - top) < vz) return 'resize-nw'
  if (Math.abs(x - right) < hz && Math.abs(y - top) < vz) return 'resize-ne'
  if (Math.abs(x - left) < hz && Math.abs(y - bottom) < vz) return 'resize-sw'
  if (Math.abs(x - right) < hz && Math.abs(y - bottom) < vz) return 'resize-se'
  if (Math.abs(y - top) < vz && x > left && x < right) return 'resize-n'
  if (Math.abs(y - bottom) < vz && x > left && x < right) return 'resize-s'
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

/* --------------------------- Canvas helpers ------------------------------ */

function cloneCanvas(src: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!src) return null
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  c.getContext('2d')?.drawImage(src, 0, 0)
  return c
}

/** Rough bounding box of an overlay, used for hit-testing + move-drag. */
function overlayBox(o: Overlay, measure: (t: TextOverlay) => number): PxRect {
  if (o.kind === 'stroke') {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of o.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const pad = o.size
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
  }
  if (o.kind === 'shape') {
    const x = Math.min(o.x, o.x + o.w)
    const y = Math.min(o.y, o.y + o.h)
    return { x, y, width: Math.abs(o.w), height: Math.abs(o.h) }
  }
  const w = measure(o)
  return { x: o.x, y: o.y - o.size, width: w, height: o.size * 1.3 }
}

function nearSegment(p: PxPoint, a: PxPoint, b: PxPoint, tol: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = clamp(t, 0, 1)
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) <= tol * tol
}

export function PhotoEditorView({ file, onChange }: PhotoEditorViewProps) {
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<EditorMode>('adjust')
  const [adj, setAdj] = React.useState<Adjustments>({ ...DEFAULT_ADJ })
  const [frame, setFrame] = React.useState<FrameOpts>({ ...DEFAULT_FRAME })
  const [overlays, setOverlays] = React.useState<Overlay[]>([])
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [baseVersion, setBaseVersion] = React.useState(0)
  // History depth as state so undo/redo buttons re-render reactively.
  const [histDepth, setHistDepth] = React.useState({ past: 0, future: 0 })
  // Natural dimensions of the base photo (mirrors baseRef without reading
  // refs during render).
  const [dims, setDims] = React.useState({ w: 0, h: 0 })
  const [containerW, setContainerW] = React.useState(0)

  // Crop state (display-space rect over the photo area).
  const [ratio, setRatio] = React.useState<Ratio>('free')
  const [cropRect, setCropRect] = React.useState<PxRect | null>(null)

  // Transform mode is click-to-apply; resize inputs bake on Apply.
  const [resizeW, setResizeW] = React.useState<number | ''>('')
  const [resizeH, setResizeH] = React.useState<number | ''>('')
  const [lockAspect, setLockAspect] = React.useState(true)

  // Draw/shapes settings.
  const [brushColor, setBrushColor] = React.useState('#ef4444')
  const [brushSize, setBrushSize] = React.useState(12)
  const [shapeKind, setShapeKind] = React.useState<'rect' | 'ellipse' | 'line'>('rect')
  const [shapeColor, setShapeColor] = React.useState('#ef4444')
  const [shapeSize, setShapeSize] = React.useState(6)
  const [shapeFill, setShapeFill] = React.useState(false)

  // Text settings (applied to the selected text overlay).
  const [textColor, setTextColor] = React.useState('#ffffff')
  const [textSize, setTextSize] = React.useState(48)
  const [textBold, setTextBold] = React.useState(true)
  const [textItalic, setTextItalic] = React.useState(false)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const baseRef = React.useRef<HTMLCanvasElement | null>(null)
  const origRef = React.useRef<HTMLCanvasElement | null>(null)
  const idRef = React.useRef(1)
  const measureRef = React.useRef<CanvasRenderingContext2D | null>(null)
  const preSnapRef = React.useRef<{ base: HTMLCanvasElement | null; overlays: Overlay[]; adj: Adjustments; frame: FrameOpts } | null>(null)

  const pastRef = React.useRef<{ base: HTMLCanvasElement | null; overlays: Overlay[]; adj: Adjustments; frame: FrameOpts }[]>([])
  const futureRef = React.useRef<{ base: HTMLCanvasElement | null; overlays: Overlay[]; adj: Adjustments; frame: FrameOpts }[]>([])

  // Drag sessions — only touched inside pointer handlers.
  const cropDrag = React.useRef<{
    mode: DragMode | 'creating'
    anchor: PxPoint
    start: PxRect | null
    box: { w: number; h: number }
    ratio: number | null
    lastRect: PxRect | null
  } | null>(null)
  const paintDrag = React.useRef<{ kind: 'stroke'; id: number } | { kind: 'shape'; id: number; anchor: Pt } | { kind: 'move'; id: number; grab: Pt; orig: Overlay } | null>(null)

  /* ------------------------- Load the image ------------------------------ */
  React.useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    setOverlays([])
    setAdj({ ...DEFAULT_ADJ })
    setFrame({ ...DEFAULT_FRAME })
    setCropRect(null)
    setSelectedId(null)
    pastRef.current = []
    futureRef.current = []
    setHistDepth({ past: 0, future: 0 })

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || 1
      c.height = img.naturalHeight || 1
      c.getContext('2d')!.drawImage(img, 0, 0)
      baseRef.current = c
      origRef.current = cloneCanvas(c)
      setDims({ w: c.width, h: c.height })
      setResizeW(c.width)
      setResizeH(c.height)
      setReady(true)
      setBaseVersion((v) => v + 1)
    }
    img.onerror = () => {
      if (cancelled) return
      setError('Could not read this image — try a different file.')
    }
    img.src = url

    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file])

  /* ------------------------ Container measure ---------------------------- */
  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      setContainerW((prev) => {
        const w = el.clientWidth
        return w === prev ? prev : w
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  const baseW = ready ? dims.w : 0
  const baseH = ready ? dims.h : 0

  // Display geometry: canvas shows base + frame, fitted into the container.
  const geom = React.useMemo(() => {
    const outerW = baseW + frame.width * 2
    const outerH = baseH + frame.width * 2
    const CONTAINER_H = 440
    const k = containerW > 0 && outerW > 0 ? Math.min(containerW / outerW, CONTAINER_H / outerH, 1) : 0
    return { k, dispW: Math.round(outerW * k), dispH: Math.round(outerH * k), photoX: frame.width * k, photoY: frame.width * k, photoW: baseW * k, photoH: baseH * k }
  }, [baseW, baseH, frame.width, containerW])

  /* --------------------------- Rendering ---------------------------------- */
  const filterString = React.useCallback((scaleK: number) => {
    const blurPx = adj.blur * scaleK
    return `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturation}%) sepia(${adj.sepia}%)` + (blurPx > 0.05 ? ` blur(${blurPx.toFixed(2)}px)` : '')
  }, [adj])

  const drawOverlays = React.useCallback((ctx: CanvasRenderingContext2D, k: number) => {
    for (const o of overlays) {
      if (o.kind === 'stroke') {
        if (o.points.length === 0) continue
        ctx.strokeStyle = o.color
        ctx.lineWidth = Math.max(1, o.size * k)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(o.points[0].x * k, o.points[0].y * k)
        for (let i = 1; i < o.points.length; i++) ctx.lineTo(o.points[i].x * k, o.points[i].y * k)
        if (o.points.length === 1) ctx.lineTo(o.points[0].x * k + 0.01, o.points[0].y * k)
        ctx.stroke()
      } else if (o.kind === 'shape') {
        ctx.strokeStyle = o.color
        ctx.fillStyle = o.color
        ctx.lineWidth = Math.max(1, o.size * k)
        if (o.shape === 'rect') {
          const x = Math.min(o.x, o.x + o.w) * k
          const y = Math.min(o.y, o.y + o.h) * k
          const w = Math.abs(o.w) * k
          const h = Math.abs(o.h) * k
          if (o.fill) ctx.fillRect(x, y, w, h)
          else ctx.strokeRect(x, y, w, h)
        } else if (o.shape === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse((o.x + o.w / 2) * k, (o.y + o.h / 2) * k, Math.abs(o.w / 2) * k, Math.abs(o.h / 2) * k, 0, 0, Math.PI * 2)
          if (o.fill) ctx.fill()
          else ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(o.x * k, o.y * k)
          ctx.lineTo((o.x + o.w) * k, (o.y + o.h) * k)
          ctx.stroke()
        }
      } else {
        ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '700' : '400'} ${o.size * k}px sans-serif`
        ctx.fillStyle = o.color
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(o.text, o.x * k, o.y * k)
      }
    }
  }, [overlays])

  const measureTextW = React.useCallback((t: TextOverlay): number => {
    if (!measureRef.current) {
      const c = document.createElement('canvas')
      measureRef.current = c.getContext('2d')
    }
    const ctx = measureRef.current
    if (!ctx) return t.text.length * t.size * 0.6
    ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700' : '400'} 100px sans-serif`
    return (ctx.measureText(t.text || ' ').width / 100) * t.size
  }, [])

  const renderAt = React.useCallback((canvas: HTMLCanvasElement, k: number, showSelection = false) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !baseRef.current) return
    const fw = frame.width * k
    const outerW = baseW * k + fw * 2
    const outerH = baseH * k + fw * 2
    canvas.width = Math.max(1, Math.round(outerW))
    canvas.height = Math.max(1, Math.round(outerH))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Rounded-corner clip (outer radius; the photo clip is inset by frame).
    if (frame.radius > 0 && fw >= 0) {
      const r = frame.radius * k
      ctx.beginPath()
      const rr = Math.min(r, outerW / 2, outerH / 2)
      ctx.roundRect(0, 0, outerW, outerH, rr)
      ctx.clip()
    }

    if (fw > 0) {
      ctx.fillStyle = frame.color
      ctx.fillRect(0, 0, outerW, outerH)
    }
    ctx.save()
    if (frame.radius > 0) {
      const r = Math.max(0, Math.min(frame.radius * k - fw, (outerW - fw * 2) / 2, (outerH - fw * 2) / 2))
      ctx.beginPath()
      ctx.roundRect(fw, fw, outerW - fw * 2, outerH - fw * 2, r)
      ctx.clip()
    }
    ctx.filter = filterString(k)
    ctx.drawImage(baseRef.current, fw, fw, baseW * k, baseH * k)
    ctx.filter = 'none'
    ctx.translate(fw, fw)
    drawOverlays(ctx, k)
    if (showSelection && selectedId != null) {
      const sel = overlays.find((o) => o.id === selectedId)
      if (sel) {
        const b = overlayBox(sel, measureTextW)
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth = Math.max(1, 1.5 * k)
        ctx.setLineDash([6 * k, 4 * k])
        ctx.strokeRect(b.x * k - 4 * k, b.y * k - 4 * k, (b.width + 8) * k, (b.height + 8) * k)
        ctx.setLineDash([])
      }
    }
    ctx.restore()
  }, [baseW, baseH, frame, filterString, drawOverlays, selectedId, overlays, measureTextW])

  // Live preview render.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!ready || !canvas || geom.k <= 0) return
    renderAt(canvas, geom.k, true)
  }, [ready, geom, renderAt, baseVersion])

  /* ------------------------ Full-res export ------------------------------- */
  const exportFull = React.useCallback(async (): Promise<PhotoEditorResult | null> => {
    if (!baseRef.current || baseW === 0) return null
    const c = document.createElement('canvas')
    renderAt(c, 1)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) return null
    const data = await blob.arrayBuffer()
    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-') || 'photo'
    return { fileName: `${baseName}-edited.png`, data, width: c.width, height: c.height }
  }, [file.name, renderAt, baseW])

  // Emit the rendered result (debounced) whenever anything visual changes.
  React.useEffect(() => {
    if (!ready || error) return
    const t = setTimeout(() => {
      exportFull().then((r) => onChange(r)).catch(() => onChange(null))
    }, 500)
    return () => clearTimeout(t)
  }, [ready, error, adj, overlays, frame, baseVersion, exportFull, onChange])

  /* --------------------------- History ------------------------------------ */
  const snapshot = () => ({
    base: cloneCanvas(baseRef.current),
    overlays: overlays.map((o) => (o.kind === 'stroke' ? { ...o, points: [...o.points] } : { ...o })),
    adj: { ...adj },
    frame: { ...frame },
  })

  const pushHistory = () => {
    pastRef.current.push(snapshot())
    if (pastRef.current.length > 25) pastRef.current.shift()
    futureRef.current = []
    setHistDepth({ past: pastRef.current.length, future: 0 })
  }

  const restore = (s: { base: HTMLCanvasElement | null; overlays: Overlay[]; adj: Adjustments; frame: FrameOpts }) => {
    baseRef.current = s.base
    // Keep the render dims in lock-step with the restored canvas — otherwise
    // the export would draw the old canvas into the stale (e.g. rotated)
    // dimensions.
    if (s.base) setDims({ w: s.base.width, h: s.base.height })
    setOverlays(s.overlays)
    setAdj({ ...s.adj })
    setFrame({ ...s.frame })
    setSelectedId(null)
    setCropRect(null)
    setBaseVersion((v) => v + 1)
  }

  const undo = () => {
    const s = pastRef.current.pop()
    if (!s) return
    futureRef.current.push(snapshot())
    restore(s)
    setHistDepth({ past: pastRef.current.length, future: futureRef.current.length })
  }

  const redo = () => {
    const s = futureRef.current.pop()
    if (!s) return
    pastRef.current.push(snapshot())
    restore(s)
    setHistDepth({ past: pastRef.current.length, future: futureRef.current.length })
  }

  /* --------------------- Destructive base ops ----------------------------- */
  const applyTransform = (op: 'cw' | 'ccw' | 'flipH' | 'flipV') => {
    const src = baseRef.current
    if (!src) return
    pushHistory()
    const swap = op === 'cw' || op === 'ccw'
    const dst = document.createElement('canvas')
    dst.width = swap ? src.height : src.width
    dst.height = swap ? src.width : src.height
    const ctx = dst.getContext('2d')!
    if (op === 'cw') {
      ctx.translate(dst.width / 2, dst.height / 2)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(src, -src.width / 2, -src.height / 2)
    } else if (op === 'ccw') {
      ctx.translate(dst.width / 2, dst.height / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.drawImage(src, -src.width / 2, -src.height / 2)
    } else if (op === 'flipH') {
      ctx.translate(dst.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(src, 0, 0)
    } else {
      ctx.translate(0, dst.height)
      ctx.scale(1, -1)
      ctx.drawImage(src, 0, 0)
    }
    baseRef.current = dst
    setDims({ w: dst.width, h: dst.height })

    // Remap overlay coordinates into the new space.
    const W = src.width
    const H = src.height
    const mapPt = (p: Pt): Pt => {
      if (op === 'cw') return { x: H - p.y, y: p.x }
      if (op === 'ccw') return { x: p.y, y: W - p.x }
      if (op === 'flipH') return { x: W - p.x, y: p.y }
      return { x: p.x, y: H - p.y }
    }
    setOverlays((prev) =>
      prev.map((o) => {
        if (o.kind === 'stroke') return { ...o, points: o.points.map(mapPt) }
        if (o.kind === 'shape') {
          const a = mapPt({ x: o.x, y: o.y })
          const b = mapPt({ x: o.x + o.w, y: o.y + o.h })
          return { ...o, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
        }
        // Text anchors at the left baseline — remap the point (glyphs stay
        // horizontal; this is a basic editor).
        return { ...o, ...mapPt({ x: o.x, y: o.y }) }
      })
    )
    setCropRect(null)
    setBaseVersion((v) => v + 1)
  }

  const applyCrop = () => {
    const k = geom.k
    const src = baseRef.current
    if (!src || !cropRect || k <= 0) return
    const cx = Math.round(cropRect.x / k)
    const cy = Math.round(cropRect.y / k)
    const cw2 = Math.max(1, Math.round(cropRect.width / k))
    const ch2 = Math.max(1, Math.round(cropRect.height / k))
    pushHistory()
    const dst = document.createElement('canvas')
    dst.width = cw2
    dst.height = ch2
    dst.getContext('2d')!.drawImage(src, cx, cy, cw2, ch2, 0, 0, cw2, ch2)
    baseRef.current = dst
    setDims({ w: cw2, h: ch2 })
    setOverlays((prev) =>
      prev.map((o) => {
        if (o.kind === 'stroke') return { ...o, points: o.points.map((p) => ({ x: p.x - cx, y: p.y - cy })) }
        if (o.kind === 'shape') return { ...o, x: o.x - cx, y: o.y - cy }
        return { ...o, x: o.x - cx, y: o.y - cy }
      })
    )
    setResizeW(cw2)
    setResizeH(ch2)
    setCropRect(null)
    setMode('adjust')
    setBaseVersion((v) => v + 1)
  }

  const applyResize = () => {
    const src = baseRef.current
    const w = typeof resizeW === 'number' ? resizeW : 0
    const h = typeof resizeH === 'number' ? resizeH : 0
    if (!src || w < 1 || h < 1 || (w === src.width && h === src.height)) return
    pushHistory()
    const dst = document.createElement('canvas')
    dst.width = w
    dst.height = h
    const ctx = dst.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, w, h)
    baseRef.current = dst
    setDims({ w, h })
    const sx = w / src.width
    const sy = h / src.height
    const sm = (sx + sy) / 2
    setOverlays((prev) =>
      prev.map((o) => {
        if (o.kind === 'stroke') return { ...o, points: o.points.map((p) => ({ x: p.x * sx, y: p.y * sy })), size: Math.max(1, o.size * sm) }
        if (o.kind === 'shape') return { ...o, x: o.x * sx, y: o.y * sy, w: o.w * sx, h: o.h * sy, size: Math.max(1, o.size * sm) }
        return { ...o, x: o.x * sx, y: o.y * sy, size: Math.max(6, o.size * sm) }
      })
    )
    setBrushSize((b) => Math.max(2, Math.round(b * sm)))
    setTextSize((s) => Math.max(8, Math.round(s * sm)))
    setBaseVersion((v) => v + 1)
  }

  /* --------------------- Overlay hit-testing ------------------------------ */
  const hitOverlay = React.useCallback(
    (p: Pt): Overlay | null => {
      for (let i = overlays.length - 1; i >= 0; i--) {
        const o = overlays[i]
        const tol = Math.max(10 / geom.k, o.kind === 'stroke' || o.kind === 'shape' ? o.size : o.size * 0.3)
        if (o.kind === 'stroke') {
          const pts = o.points
          for (let j = 0; j < pts.length - 1; j++) {
            if (nearSegment(p, pts[j], pts[j + 1], tol)) return o
          }
          if (pts.length === 1 && nearSegment(p, pts[0], pts[0], tol)) return o
        } else if (o.kind === 'shape') {
          const b = overlayBox(o, measureTextW)
          if (o.shape === 'line') {
            if (nearSegment(p, { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, tol)) return o
          } else if (o.shape === 'ellipse') {
            const cx = o.x + o.w / 2
            const cy = o.y + o.h / 2
            const rx = Math.abs(o.w / 2) + tol
            const ry = Math.abs(o.h / 2) + tol
            const dx = (p.x - cx) / (rx || 1)
            const dy = (p.y - cy) / (ry || 1)
            if (dx * dx + dy * dy <= 1) return o
          } else if (p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol) {
            return o
          }
        } else {
          const b = overlayBox(o, measureTextW)
          if (p.x >= b.x - 4 && p.x <= b.x + b.width + 4 && p.y >= b.y - 4 && p.y <= b.y + b.height + 4) return o
        }
      }
      return null
    },
    [overlays, geom.k, measureTextW]
  )

  /* --------------------- Canvas pointer handling -------------------------- */
  const imgPos = (e: React.PointerEvent): Pt => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const r = canvas.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - r.left) / r.width) * (baseW + frame.width * 2) - frame.width, 0, baseW),
      y: clamp(((e.clientY - r.top) / r.height) * (baseH + frame.width * 2) - frame.width, 0, baseH),
    }
  }

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!ready || e.button !== 0) return
    if (mode !== 'draw' && mode !== 'shapes' && mode !== 'text') return
    const canvas = e.currentTarget as HTMLCanvasElement
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    const pos = imgPos(e)

    if (mode === 'draw') {
      pushHistory()
      const id = idRef.current++
      const stroke: StrokeOverlay = { kind: 'stroke', id, color: brushColor, size: brushSize, points: [pos] }
      setOverlays((prev) => [...prev, stroke])
      paintDrag.current = { kind: 'stroke', id }
      return
    }

    const hit = hitOverlay(pos)
    if (hit) {
      pushHistory()
      setSelectedId(hit.id)
      paintDrag.current = { kind: 'move', id: hit.id, grab: pos, orig: hit }
      return
    }
    setSelectedId(null)

    if (mode === 'shapes') {
      pushHistory()
      const id = idRef.current++
      const shape: ShapeOverlay = { kind: 'shape', id, shape: shapeKind, x: pos.x, y: pos.y, w: 0, h: 0, color: shapeColor, size: shapeSize, fill: shapeFill }
      setOverlays((prev) => [...prev, shape])
      paintDrag.current = { kind: 'shape', id, anchor: pos }
    } else {
      // Text mode: click on empty canvas plants a new text there.
      pushHistory()
      const id = idRef.current++
      const size = Math.max(12, Math.round(baseH * 0.08))
      const t: TextOverlay = { kind: 'text', id, text: 'Your text', x: pos.x, y: pos.y, size, color: textColor, bold: textBold, italic: textItalic }
      setOverlays((prev) => [...prev, t])
      setSelectedId(id)
      setTextSize(size)
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const d = paintDrag.current
    if (!d) return
    const pos = imgPos(e)
    if (d.kind === 'stroke') {
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.kind !== 'stroke' || o.id !== d.id) return o
          const last = o.points[o.points.length - 1]
          if (last && Math.abs(last.x - pos.x) < 1 && Math.abs(last.y - pos.y) < 1) return o
          return { ...o, points: [...o.points, pos] }
        })
      )
    } else if (d.kind === 'shape') {
      setOverlays((prev) =>
        prev.map((o) => (o.kind === 'shape' && o.id === d.id ? { ...o, w: pos.x - d.anchor.x, h: pos.y - d.anchor.y } : o))
      )
    } else {
      const dx = pos.x - d.grab.x
      const dy = pos.y - d.grab.y
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id !== d.id) return o
          if (o.kind === 'stroke') return { ...o, points: d.orig.kind === 'stroke' ? d.orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) : o.points }
          if (o.kind === 'shape') return { ...o, x: d.orig.x + dx, y: d.orig.y + dy }
          return { ...o, x: d.orig.x + dx, y: d.orig.y + dy }
        })
      )
    }
  }

  const onCanvasPointerUp = () => {
    const d = paintDrag.current
    paintDrag.current = null
    if (!d || d.kind !== 'shape') return
    // Discard accidental tiny shapes (single click).
    setOverlays((prev) => {
      const o = prev.find((x) => x.id === d.id)
      if (o && o.kind === 'shape' && Math.abs(o.w) < 6 && Math.abs(o.h) < 6) {
        return prev.filter((x) => x.id !== d.id)
      }
      return prev
    })
  }

  const deleteSelected = () => {
    if (selectedId == null) return
    pushHistory()
    setOverlays((prev) => prev.filter((o) => o.id !== selectedId))
    setSelectedId(null)
  }

  const updateSelectedText = (patch: Partial<TextOverlay>) => {
    if (selectedId == null) return
    setOverlays((prev) => prev.map((o) => (o.id === selectedId && o.kind === 'text' ? { ...o, ...patch } : o)))
  }

  const updateSelectedShape = (patch: Partial<ShapeOverlay>) => {
    if (selectedId == null) return
    setOverlays((prev) => prev.map((o) => (o.id === selectedId && o.kind === 'shape' ? { ...o, ...patch } : o)))
  }

  const selected = overlays.find((o) => o.id === selectedId) ?? null

  /* ------------------------- Crop interaction ----------------------------- */
  const cropPosFromEvent = (e: React.PointerEvent): PxPoint => {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    return {
      x: clamp(e.clientX - r.left - el.clientLeft, 0, el.clientWidth),
      y: clamp(e.clientY - r.top - el.clientTop, 0, el.clientHeight),
    }
  }

  const onCropPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const box = { w: el.clientWidth, h: el.clientHeight }
    if (!box.w || !box.h) return
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    const pos = cropPosFromEvent(e)
    const dragRatio = ratioValue(ratio, baseW, baseH)
    const hit = cropRect ? hitTest(pos, cropRect) : null
    if (hit && cropRect) {
      const cornerHit = hit === 'resize-nw' || hit === 'resize-ne' || hit === 'resize-sw' || hit === 'resize-se'
      let startRect: PxRect = { ...cropRect }
      if (dragRatio && cornerHit) {
        const snapped = fitRectToRatio(cropRect, dragRatio, box.w, box.h)
        if (Math.abs(snapped.width - cropRect.width) > 0.5 || Math.abs(snapped.height - cropRect.height) > 0.5) {
          setCropRect(snapped)
        }
        startRect = snapped
      }
      cropDrag.current = { mode: hit, anchor: pos, start: startRect, box, ratio: dragRatio, lastRect: { ...startRect } }
    } else {
      cropDrag.current = { mode: 'creating', anchor: pos, start: null, box, ratio: dragRatio, lastRect: { x: pos.x, y: pos.y, width: 0, height: 0 } }
      setCropRect({ x: pos.x, y: pos.y, width: 0, height: 0 })
    }
  }

  const onCropPointerMove = (e: React.PointerEvent) => {
    const d = cropDrag.current
    if (!d) return
    const pos = cropPosFromEvent(e)
    const { w: cw, h: ch } = d.box
    if (d.mode === 'creating') {
      const r = createRect(d.anchor, pos, cw, ch, d.ratio)
      d.lastRect = r
      setCropRect(r)
      return
    }
    if (!d.start) return
    const dx = pos.x - d.anchor.x
    const dy = pos.y - d.anchor.y
    if (d.mode === 'moving') {
      const x = clamp(d.start.x + dx, 0, Math.max(0, cw - d.start.width))
      const y = clamp(d.start.y + dy, 0, Math.max(0, ch - d.start.height))
      setCropRect({ ...d.start, x, y })
      return
    }
    const next = resizeWithHandles(d.mode, d.start, dx, dy, cw, ch, d.ratio)
    d.lastRect = next
    setCropRect(next)
  }

  const onCropPointerUp = () => {
    const d = cropDrag.current
    cropDrag.current = null
    if (d && d.mode === 'creating' && d.lastRect) {
      if (d.lastRect.width < MIN_SIZE || d.lastRect.height < MIN_SIZE) setCropRect(null)
    }
  }

  const cropCursor = React.useMemo(() => {
    if (mode !== 'crop' || !cropRect) return 'crosshair'
    // Light-weight hover cursor: rely on the handles' own cursors + move.
    return 'default'
  }, [mode, cropRect])

  const enterCropMode = () => {
    setMode('crop')
    setSelectedId(null)
    if (!cropRect && containerRef.current) {
      const photoW = geom.photoW
      const photoH = geom.photoH
      if (photoW > 0) setCropRect(defaultRect(null, photoW, photoH))
    }
  }

    /* ------------------------------ UI -------------------------------------- */
  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex min-h-[280px] items-center justify-center gap-2 rounded-2xl border border-border/60 bg-secondary/30 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading photo…
      </div>
    )
  }

  const modeBtn = (id: EditorMode, label: string, Icon: typeof Brush) => (
    <button
      key={id}
      onClick={() => (id === 'crop' ? enterCropMode() : setMode(id))}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium transition-all',
        mode === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-secondary/40 p-1.5">
        <div className="flex flex-wrap items-center">
          {modeBtn('adjust', 'Filter & light', SlidersHorizontal)}
          {modeBtn('crop', 'Crop', CropIcon)}
          {modeBtn('transform', 'Transform', RotateCw)}
          {modeBtn('resize', 'Resize', Scaling)}
          {modeBtn('draw', 'Draw', Brush)}
          {modeBtn('text', 'Text', Type)}
          {modeBtn('shapes', 'Shapes', Shapes)}
          {modeBtn('frame', 'Frame', FrameIcon)}
        </div>
        <div className="flex items-center gap-1 pr-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={undo} disabled={histDepth.past === 0} title="Undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={redo} disabled={histDepth.future === 0} title="Redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            title="Discard all edits and start over"
            onClick={() => {
              if (!origRef.current) return
              pushHistory()
              restore({ base: cloneCanvas(origRef.current), overlays: [], adj: { ...DEFAULT_ADJ }, frame: { ...DEFAULT_FRAME } })
              setResizeW(origRef.current.width)
              setResizeH(origRef.current.height)
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      {/* Canvas stage */}
      <div
        ref={containerRef}
        className="flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl border border-border/60 p-4"
        style={{
          backgroundImage: 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)',
          backgroundSize: '16px 16px',
        }}
      >
        <div className="relative" style={{ width: geom.dispW, height: geom.dispH }}>
          <canvas
            ref={canvasRef}
            style={{ width: geom.dispW, height: geom.dispH, touchAction: 'none' }}
            className={cn(
              'shadow-md ring-1 ring-black/10',
              mode === 'draw' && 'cursor-crosshair',
              mode === 'shapes' && 'cursor-crosshair',
              mode === 'text' && 'cursor-text'
            )}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
          />

          {/* Crop selection layer (display space over the photo area) */}
          {mode === 'crop' && (
            <div
              className="absolute overflow-hidden"
              style={{ left: geom.photoX, top: geom.photoY, width: geom.photoW, height: geom.photoH, touchAction: 'none', cursor: cropCursor }}
              onPointerDown={onCropPointerDown}
              onPointerMove={onCropPointerMove}
              onPointerUp={onCropPointerUp}
              onPointerCancel={onCropPointerUp}
            >
              {cropRect && cropRect.width >= 2 && cropRect.height >= 2 && (
                <div
                  className="absolute border-2 border-white"
                  style={{
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                    cursor: 'move',
                  }}
                >
                  {(
                    [
                      ['nw', { top: -5, left: -5 }],
                      ['n', { top: -5, left: '50%', marginLeft: -5 }],
                      ['ne', { top: -5, right: -5 }],
                      ['e', { top: '50%', right: -5, marginTop: -5 }],
                      ['se', { bottom: -5, right: -5 }],
                      ['s', { bottom: -5, left: '50%', marginLeft: -5 }],
                      ['sw', { bottom: -5, left: -5 }],
                      ['w', { top: '50%', left: -5, marginTop: -5 }],
                    ] as const
                  ).map(([h, pos]) => (
                    <span
                      key={h}
                      className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border border-primary bg-white shadow"
                      style={{ ...pos, cursor: HANDLE_CURSORS[('resize-' + h) as DragMode] }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mode panels */}
      {mode === 'adjust' && (
        <div
          className="space-y-4 rounded-2xl border border-border/70 bg-secondary/40 p-4"
          onPointerDownCapture={() => {
            preSnapRef.current = snapshot()
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Filters:</span>
            {ADJ_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  pushHistory()
                  setAdj({ ...p.adj })
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                  adj.brightness === p.adj.brightness && adj.contrast === p.adj.contrast && adj.saturation === p.adj.saturation && adj.sepia === p.adj.sepia && adj.blur === p.adj.blur
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['Brightness', 'brightness', 0, 200, '%'],
                ['Contrast', 'contrast', 0, 200, '%'],
                ['Saturation', 'saturation', 0, 200, '%'],
                ['Warmth', 'sepia', 0, 100, '%'],
                ['Blur', 'blur', 0, 10, 'px'],
              ] as const
            ).map(([label, key, min, max, unit]) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {label}: {key === 'blur' ? adj[key].toFixed(1) : adj[key]}
                  {unit}
                </Label>
                <Slider
                  value={[adj[key]]}
                  min={min}
                  max={max}
                  step={key === 'blur' ? 0.1 : 1}
                  onValueChange={(v) => setAdj((prev) => ({ ...prev, [key]: v[0] }))}
                  onValueCommit={() => {
                    if (preSnapRef.current) {
                      pastRef.current.push(preSnapRef.current)
                      if (pastRef.current.length > 25) pastRef.current.shift()
                      futureRef.current = []
                      preSnapRef.current = null
                      setHistDepth({ past: pastRef.current.length, future: 0 })
                    }
                  }}
                  className="mt-2"
                />
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { pushHistory(); setAdj({ ...DEFAULT_ADJ }) }}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset adjustments
          </Button>
        </div>
      )}

      {mode === 'crop' && (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-secondary/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Ratio:</span>
            {RATIO_PRESETS.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRatio(r.id)
                  if (!cropRect || !geom.photoW || !geom.photoH) return
                  const rv = ratioValue(r.id, baseW, baseH)
                  if (!rv) return
                  setCropRect(fitRectToRatio(cropRect, rv, geom.photoW, geom.photoH))
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                  ratio === r.id ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                )}
              >
                {r.label}
              </button>
            ))}
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setCropRect({ x: 0, y: 0, width: geom.photoW, height: geom.photoH })}>
              <Square className="h-3.5 w-3.5" /> Full area
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <p className="text-xs text-muted-foreground">
              {cropRect && geom.k > 0
                ? `Selection: ${Math.round(cropRect.width / geom.k)} x ${Math.round(cropRect.height / geom.k)} px — drag on the photo to draw a new one.`
                : 'Drag on the photo to select the area to keep.'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setCropRect(null); setMode('adjust') }}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={applyCrop} disabled={!cropRect || cropRect.width < MIN_SIZE || cropRect.height < MIN_SIZE}>
                <Check className="h-3.5 w-3.5" /> Apply crop
              </Button>
            </div>
          </div>
        </div>
      )}

      {mode === 'transform' && (
        <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button variant="outline" className="gap-2" onClick={() => applyTransform('ccw')}>
              <RotateCcw className="h-4 w-4" /> Rotate left
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => applyTransform('cw')}>
              <RotateCw className="h-4 w-4" /> Rotate right
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => applyTransform('flipH')}>
              <FlipHorizontal className="h-4 w-4" /> Flip horizontal
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => applyTransform('flipV')}>
              <FlipVertical className="h-4 w-4" /> Flip vertical
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Each action applies immediately — use Undo to revert.</p>
        </div>
      )}

      {mode === 'resize' && (
        <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Width (px)</Label>
              <Input
                type="number"
                className="h-9 w-32"
                value={resizeW}
                min={1}
                onChange={(e) => {
                  const v = e.target.value === '' ? '' : Math.max(1, Math.round(Number(e.target.value) || 1))
                  setResizeW(v)
                  if (lockAspect && typeof v === 'number' && baseW > 0) setResizeH(Math.max(1, Math.round((v / baseW) * baseH)))
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Height (px)</Label>
              <Input
                type="number"
                className="h-9 w-32"
                value={resizeH}
                min={1}
                onChange={(e) => {
                  const v = e.target.value === '' ? '' : Math.max(1, Math.round(Number(e.target.value) || 1))
                  setResizeH(v)
                  if (lockAspect && typeof v === 'number' && baseH > 0) setResizeW(Math.max(1, Math.round((v / baseH) * baseW)))
                }}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch checked={lockAspect} onCheckedChange={setLockAspect} id="pe-lock" />
              <Label htmlFor="pe-lock" className="text-xs text-muted-foreground">Lock aspect ratio</Label>
            </div>
            <Button size="sm" className="gap-1.5" onClick={applyResize}>
              <Check className="h-3.5 w-3.5" /> Apply resize
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Current size: {baseW} x {baseH} px. The preview updates after applying.</p>
        </div>
      )}

      {mode === 'draw' && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/70 bg-secondary/40 p-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium text-muted-foreground">Color</Label>
            <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-card" />
          </div>
          <div className="min-w-[160px] flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Brush size: {brushSize}px</Label>
            <Slider value={[brushSize]} min={2} max={60} step={1} onValueChange={(v) => setBrushSize(v[0])} className="mt-2" />
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { if (overlays.some((o) => o.kind === 'stroke')) { pushHistory(); setOverlays((prev) => prev.filter((o) => o.kind !== 'stroke')) } }}>
            <Trash2 className="h-3.5 w-3.5" /> Clear drawings
          </Button>
          <p className="w-full text-xs text-muted-foreground">Draw directly on the photo — each stroke can be undone.</p>
        </div>
      )}

      {mode === 'text' && (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-secondary/40 p-4">
          {selected && selected.kind === 'text' ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Text content</Label>
                <textarea
                  value={selected.text}
                  onChange={(e) => updateSelectedText({ text: e.target.value })}
                  className="min-h-[60px] w-full resize-y rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[160px] flex-1 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Size: {selected.size}px</Label>
                  <Slider value={[selected.size]} min={8} max={300} step={1} onValueChange={(v) => updateSelectedText({ size: v[0] })} className="mt-2" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium text-muted-foreground">Color</Label>
                  <input type="color" value={selected.color} onChange={(e) => updateSelectedText({ color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border bg-card" />
                </div>
                <button onClick={() => updateSelectedText({ bold: !selected.bold })} className={cn('rounded-lg border px-3 py-1.5 text-xs font-bold transition-all', selected.bold ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground')}>
                  B
                </button>
                <button onClick={() => updateSelectedText({ italic: !selected.italic })} className={cn('rounded-lg border px-3 py-1.5 text-xs italic transition-all', selected.italic ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground')}>
                  I
                </button>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={deleteSelected}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Drag the text on the photo to move it. Click empty space to add another text.</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Click anywhere on the photo to place a text — then edit it here. Click an existing text to select and move it.</p>
          )}
        </div>
      )}

      {mode === 'shapes' && (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-secondary/40 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-1">
              {(
                [
                  ['rect', Square],
                  ['ellipse', Shapes],
                  ['line', Minus],
                ] as const
              ).map(([k, Icon]) => (
                <button key={k} onClick={() => setShapeKind(k)} title={k} className={cn('rounded-lg border p-2 transition-all', shapeKind === k ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-muted-foreground">Color</Label>
              <input type="color" value={shapeColor} onChange={(e) => setShapeColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-card" />
            </div>
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Stroke: {shapeSize}px</Label>
              <Slider value={[shapeSize]} min={2} max={40} step={1} onValueChange={(v) => setShapeSize(v[0])} className="mt-2" />
            </div>
            {shapeKind !== 'line' && (
              <div className="flex items-center gap-2">
                <Switch checked={shapeFill} onCheckedChange={setShapeFill} id="pe-fill" />
                <Label htmlFor="pe-fill" className="text-xs text-muted-foreground">Filled</Label>
              </div>
            )}
            {selected && selected.kind === 'shape' && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={deleteSelected}>
                <Trash2 className="h-3.5 w-3.5" /> Delete selected
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Drag on the photo to draw a {shapeKind}. Click an existing shape to select and drag it around.
          </p>
        </div>
      )}

      {mode === 'frame' && (
        <div
          className="space-y-4 rounded-2xl border border-border/70 bg-secondary/40 p-4"
          onPointerDownCapture={() => {
            preSnapRef.current = snapshot()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Border width: {frame.width}px</Label>
              <Slider
                value={[frame.width]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => setFrame((prev) => ({ ...prev, width: v[0] }))}
                onValueCommit={() => {
                  if (preSnapRef.current) {
                    pastRef.current.push(preSnapRef.current)
                    if (pastRef.current.length > 25) pastRef.current.shift()
                    futureRef.current = []
                    preSnapRef.current = null
                    setHistDepth({ past: pastRef.current.length, future: 0 })
                  }
                }}
                className="mt-2"
              />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <Label className="text-xs font-medium text-muted-foreground">Color</Label>
              <input type="color" value={frame.color} onChange={(e) => setFrame((prev) => ({ ...prev, color: e.target.value }))} className="h-8 w-10 cursor-pointer rounded border border-border bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Corner radius: {frame.radius}px</Label>
              <Slider
                value={[frame.radius]}
                min={0}
                max={200}
                step={2}
                onValueChange={(v) => setFrame((prev) => ({ ...prev, radius: v[0] }))}
                onValueCommit={() => {
                  if (preSnapRef.current) {
                    pastRef.current.push(preSnapRef.current)
                    if (pastRef.current.length > 25) pastRef.current.shift()
                    futureRef.current = []
                    preSnapRef.current = null
                    setHistDepth({ past: pastRef.current.length, future: 0 })
                  }
                }}
                className="mt-2"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Rounded corners stay transparent in the exported PNG.</p>
        </div>
      )}
    </div>
  )
}


