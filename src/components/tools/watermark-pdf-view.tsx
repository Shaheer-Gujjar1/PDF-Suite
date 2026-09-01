'use client'

import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Stamp as StampIcon,
  Trash2,
  Type as TypeIcon,
  X,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loadPdfJs } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export type WmPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface WatermarkPdfLayerState {
  id: string
  type: 'text' | 'image'
  /* text layers */
  text: string
  fontFamily: string
  /** 0 = auto (min(pageW, pageH) / 8 pt). */
  fontSizePt: number
  color: string
  /* image (logo) layers */
  logo: File | null
  logoUrl: string | null
  /** Logo width as % of the page width. */
  scale: number
  /* shared */
  /** 0..1 */
  opacity: number
  /** degrees, clockwise */
  rotation: number
  tile: boolean
  position: WmPosition
  marginX: number
  marginY: number
}

export interface WatermarkPdfResult {
  layers: WatermarkPdfLayerState[]
}

interface WatermarkPdfViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: WatermarkPdfResult | null) => void
}

const FONTS: { value: string; label: string }[] = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
]

const POSITIONS: WmPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

let counter = 0
function uid(): string {
  counter += 1
  return `wmpdf_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 6)}`
}

function makeTextLayer(): WatermarkPdfLayerState {
  return {
    id: uid(),
    type: 'text',
    text: '',
    fontFamily: FONTS[0].value,
    fontSizePt: 0,
    color: '#ffffff',
    logo: null,
    logoUrl: null,
    scale: 25,
    opacity: 0.5,
    rotation: 0,
    tile: false,
    position: 'bottom-right',
    marginX: 16,
    marginY: 16,
  }
}

function makeLogoLayer(): WatermarkPdfLayerState {
  return { ...makeTextLayer(), type: 'image' as const }
}

/* ------------------------------------------------------------------------ */
/* Live preview — page 1 of the active PDF rendered with pdf.js, with the    */
/* watermark layers drawn on top using the exact math the worker uses        */
/* (same auto size, rotation, tiling, margins and opacity, in page points),  */
/* so what you see here is what gets baked into every output page.           */
/* ------------------------------------------------------------------------ */
function WatermarkPdfPreview({
  file,
  layers,
}: {
  file: File
  layers: WatermarkPdfLayerState[]
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [base, setBase] = React.useState<{
    canvas: HTMLCanvasElement
    wPt: number
    hPt: number
  } | null>(null)
  const [logoImgs, setLogoImgs] = React.useState<Record<string, HTMLImageElement>>({})
  const [error, setError] = React.useState<string | null>(null)

  /* Ref mirror so the logo effect below doesn't need `layers` as a dep. */
  const layersRef = React.useRef(layers)
  React.useEffect(() => {
    layersRef.current = layers
  }, [layers])

  /* Render page 1 of the active PDF once per file change. */
  React.useEffect(() => {
    let cancelled = false
    setBase(null)
    setError(null)
    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const buf = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        if (cancelled) {
          try { await doc.destroy() } catch {}
          return
        }
        const page = await doc.getPage(1)
        const vp1 = page.getViewport({ scale: 1 })
        /* ~900 px wide render for a crisp preview, capped to 3x. */
        const scale = Math.min(3, Math.max(0.5, 900 / vp1.width))
        const vp = page.getViewport({ scale })
        const c = document.createElement('canvas')
        c.width = Math.ceil(vp.width)
        c.height = Math.ceil(vp.height)
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, c.width, c.height)
        await page.render({ canvasContext: ctx, viewport: vp }).promise
        try { await page.cleanup() } catch {}
        try { await doc.destroy() } catch {}
        if (!cancelled) setBase({ canvas: c, wPt: vp1.width, hPt: vp1.height })
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setBase(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  /* Reload logos ONLY when the actual set of logo files changes. */
  const logoKey = layers
    .map((l) => (l.type === 'image' && l.logo ? `${l.id}:${l.logo.name}:${l.logo.size}` : ''))
    .join('|')

  React.useEffect(() => {
    const current = layersRef.current
    setLogoImgs({})
    if (current.every((l) => l.type !== 'image' || !l.logo)) return
    let alive = true
    const urls: string[] = []
    for (const l of current) {
      if (l.type !== 'image' || !l.logo) continue
      const url = URL.createObjectURL(l.logo)
      urls.push(url)
      const img = new Image()
      img.onload = () => {
        if (alive) setLogoImgs((prev) => ({ ...prev, [l.id]: img }))
      }
      img.src = url
    }
    return () => {
      alive = false
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [logoKey])

  /* Composite: page + all layers, mirroring the worker's math exactly. */
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !base) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = base.canvas.width
    canvas.height = base.canvas.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base.canvas, 0, 0)

    const W = base.wPt // page width in pt
    const H = base.hPt // page height in pt
    const s = canvas.width / W // preview px per pt

    const drawLayer = (L: WatermarkPdfLayerState) => {
      let tw: number
      let th: number
      if (L.type === 'text') {
        const text = L.text || ''
        if (!text) return
        const sizePt =
          L.fontSizePt > 0
            ? L.fontSizePt
            : Math.max(12, Math.round(Math.min(W, H) / 8))
        const size = sizePt * s
        ctx.font = `${size}px ${L.fontFamily || 'sans-serif'}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        tw = ctx.measureText(text).width
        th = size
      } else {
        const logo = logoImgs[L.id]
        if (!logo) return
        const scale = Math.max(1, Math.min(100, L.scale || 25)) / 100
        tw = Math.max(1, W * scale * s)
        th = Math.max(1, logo.naturalHeight * (tw / logo.naturalWidth))
      }
      const rad = ((L.rotation || 0) * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const bboxW = tw * cos + th * sin
      const bboxH = tw * sin + th * cos
      const mX = Math.max(0, L.marginX || 0) * s
      const mY = Math.max(0, L.marginY || 0) * s
      const stamp = (cx: number, cy: number) => {
        ctx.save()
        ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity == null ? 0.5 : L.opacity))
        ctx.translate(cx, cy)
        ctx.rotate(rad)
        if (L.type === 'text') {
          ctx.fillStyle = L.color || '#000000'
          ctx.fillText(L.text, 0, 0)
        } else {
          ctx.drawImage(logoImgs[L.id], -tw / 2, -th / 2, tw, th)
        }
        ctx.restore()
      }
      if (L.tile) {
        const stepX = bboxW + mX * 2
        const stepY = bboxH + mY * 2
        for (let yy = -stepY; yy < canvas.height + stepY; yy += stepY) {
          for (let xx = -stepX; xx < canvas.width + stepX; xx += stepX) {
            stamp(xx + stepX / 2, yy + stepY / 2)
          }
        }
      } else {
        const pos = L.position || 'bottom-right'
        const cx = pos.includes('left')
          ? mX + bboxW / 2
          : pos.includes('right')
            ? canvas.width - mX - bboxW / 2
            : canvas.width / 2
        const cy = pos.includes('top')
          ? mY + bboxH / 2
          : pos.includes('bottom')
            ? canvas.height - mY - bboxH / 2
            : canvas.height / 2
        stamp(cx, cy)
      }
    }

    for (const l of layers) drawLayer(l)
    ctx.globalAlpha = 1
  }, [base, logoImgs, layers])

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-white">
      {base ? (
        <canvas
          ref={canvasRef}
          className="mx-auto block h-auto max-h-[560px] w-auto max-w-full"
        />
      ) : error ? (
        <div className="grid h-64 place-items-center px-6 text-center text-sm text-destructive">
          Preview failed: {error}
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
/* Single watermark layer editor (rendered for the ACTIVE layer only)        */
/* ------------------------------------------------------------------------ */
function LayerCard({
  layer,
  index,
  onChange,
  onRemove,
}: {
  layer: WatermarkPdfLayerState
  index: number
  onChange: (patch: Partial<WatermarkPdfLayerState>) => void
  onRemove: () => void
}) {
  const isText = layer.type === 'text'
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
          {isText ? <TypeIcon className="h-4 w-4" /> : <StampIcon className="h-4 w-4" />}
        </span>
        <p className="flex-1 text-sm font-medium">
          {isText ? 'Text watermark' : 'Logo watermark'}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            layer {index + 1}
          </span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="Remove this watermark layer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Type-specific controls */}
      {isText ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Text</Label>
            <Input
              value={layer.text}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder="Your watermark text…"
              aria-label="Watermark text"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Font</Label>
              <Select
                value={layer.fontFamily}
                onValueChange={(v) => onChange({ fontFamily: v })}
              >
                <SelectTrigger aria-label="Watermark font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Color</Label>
              <input
                type="color"
                value={layer.color}
                onChange={(e) => onChange({ color: e.target.value })}
                aria-label="Watermark color"
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-transparent p-1"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                Size {layer.fontSizePt > 0 ? `· ${layer.fontSizePt} pt` : '· auto-fit'}
              </Label>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                Auto
                <Switch
                  checked={layer.fontSizePt === 0}
                  onCheckedChange={(v) => onChange({ fontSizePt: v ? 0 : 48 })}
                  aria-label="Automatic text size"
                />
              </span>
            </div>
            <Slider
              value={[layer.fontSizePt > 0 ? layer.fontSizePt : 48]}
              min={8}
              max={200}
              step={1}
              disabled={layer.fontSizePt === 0}
              onValueChange={(v) => onChange({ fontSizePt: v[0] })}
              aria-label="Text size in points"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Logo image</Label>
            <div className="flex items-center gap-3">
              {layer.logoUrl ? (
                <img
                  src={layer.logoUrl}
                  alt="Watermark logo"
                  className="h-12 w-12 shrink-0 rounded-lg border border-border/60 bg-muted object-contain p-1"
                  draggable={false}
                />
              ) : (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted">
                  <StampIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <label className="min-w-0 flex-1 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) onChange({ logo: f, logoUrl: URL.createObjectURL(f) })
                    e.target.value = ''
                  }}
                />
                <span className="block truncate rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary/70">
                  {layer.logo ? layer.logo.name : 'Choose a PNG/JPG logo…'}
                </span>
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Size · {layer.scale}% of page width
            </Label>
            <Slider
              value={[layer.scale]}
              min={5}
              max={100}
              step={1}
              onValueChange={(v) => onChange({ scale: v[0] })}
              aria-label="Logo size as percent of page width"
            />
          </div>
        </div>
      )}

      {/* Shared controls */}
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Opacity · {Math.round(layer.opacity * 100)}%
            </Label>
            <Slider
              value={[Math.round(layer.opacity * 100)]}
              min={5}
              max={100}
              step={1}
              onValueChange={(v) => onChange({ opacity: v[0] / 100 })}
              aria-label="Watermark opacity"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Rotation · {layer.rotation}°
            </Label>
            <Slider
              value={[layer.rotation]}
              min={-180}
              max={180}
              step={1}
              onValueChange={(v) => onChange({ rotation: v[0] })}
              aria-label="Watermark rotation"
            />
          </div>
        </div>

        {/* Placement */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Tile across the page
            </Label>
            <Switch
              checked={layer.tile}
              onCheckedChange={(v) => onChange({ tile: v })}
              aria-label="Tile the watermark across the whole page"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="grid w-[78px] shrink-0 grid-cols-3 gap-1" role="group" aria-label="Watermark placement">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={layer.tile}
                  onClick={() => onChange({ position: p })}
                  aria-label={`Place watermark ${p.replace('-', ' ')}`}
                  aria-pressed={!layer.tile && layer.position === p}
                  className={cn(
                    'h-6 w-6 rounded-md border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    !layer.tile && layer.position === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/60 hover:bg-secondary'
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {layer.tile
                ? 'Repeats over the whole page — margins set the gap between stamps.'
                : 'Pick one of the 9 spots — margins push it away from the edges.'}
            </p>
          </div>
        </div>

        {/* Margins */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              H-margin · {layer.marginX}
            </Label>
            <Slider
              value={[layer.marginX]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => onChange({ marginX: v[0] })}
              aria-label="Horizontal margin"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              V-margin · {layer.marginY}
            </Label>
            <Slider
              value={[layer.marginY]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => onChange({ marginY: v[0] })}
              aria-label="Vertical margin"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Main view — the same visual editing studio as Watermark Image, adapted    */
/* to PDF pages (page 1 live preview, page thumbnails, all pages stamped)    */
/* ------------------------------------------------------------------------ */
export function WatermarkPdfView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: WatermarkPdfViewProps) {
  const [layers, setLayers] = React.useState<WatermarkPdfLayerState[]>([])
  const [activeLayerId, setActiveLayerId] = React.useState<string | null>(null)
  const [activeFileId, setActiveFileId] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({})

  /* Revoke logo object URLs on unmount. */
  const layersRef = React.useRef<WatermarkPdfLayerState[]>([])
  React.useEffect(() => {
    layersRef.current = layers
  }, [layers])
  React.useEffect(
    () => () => {
      for (const l of layersRef.current) {
        if (l.logoUrl) URL.revokeObjectURL(l.logoUrl)
      }
    },
    []
  )

  /* ---------------- Render page-1 thumbnails for each PDF ---------------- */
  React.useEffect(() => {
    let cancelled = false
    setThumbs((prev) => {
      const next: Record<string, string> = {}
      for (const f of files) if (prev[f.id]) next[f.id] = prev[f.id]
      return next
    })
    ;(async () => {
      for (const f of files) {
        if (cancelled) break
        try {
          const pdfjs = await loadPdfJs()
          const buf = await f.file.arrayBuffer()
          const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
          const page = await doc.getPage(1)
          const vp1 = page.getViewport({ scale: 1 })
          const scale = Math.max(0.1, 80 / vp1.width)
          const vp = page.getViewport({ scale })
          const c = document.createElement('canvas')
          c.width = Math.ceil(vp.width)
          c.height = Math.ceil(vp.height)
          const ctx = c.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, c.height)
          await page.render({ canvasContext: ctx, viewport: vp }).promise
          const dataUrl = c.toDataURL('image/png')
          try { await page.cleanup() } catch {}
          try { await doc.destroy() } catch {}
          if (!cancelled) setThumbs((prev) => ({ ...prev, [f.id]: dataUrl }))
        } catch {
          /* thumbnail failed — the tile just shows a spinner-less blank */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [files])

  /* ---------------- Emit result whenever layers change ------------------- */
  React.useEffect(() => {
    if (files.length === 0 || layers.length === 0) {
      onChange(null)
      return
    }
    onChange({ layers })
  }, [files, layers, onChange])

  /* Keep the previewed PDF valid as the queue changes. */
  React.useEffect(() => {
    if (files.length === 0) {
      setActiveFileId(null)
      return
    }
    setActiveFileId((prev) =>
      prev && files.some((f) => f.id === prev) ? prev : files[0].id
    )
  }, [files])

  /* Keep the active layer valid as layers come and go. */
  React.useEffect(() => {
    if (layers.length === 0) {
      setActiveLayerId(null)
      return
    }
    setActiveLayerId((prev) =>
      prev && layers.some((l) => l.id === prev) ? prev : layers[layers.length - 1].id
    )
  }, [layers])

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0] ?? null
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null

  const patchLayer = (id: string, patch: Partial<WatermarkPdfLayerState>) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const removeLayer = (id: string) =>
    setLayers((prev) => {
      const target = prev.find((l) => l.id === id)
      if (target?.logoUrl) URL.revokeObjectURL(target.logoUrl)
      return prev.filter((l) => l.id !== id)
    })

  const addLayer = (type: 'text' | 'image') => {
    const layer = type === 'text' ? makeTextLayer() : makeLogoLayer()
    setLayers((prev) => [...prev, layer])
    setActiveLayerId(layer.id)
  }

  /* dir +1 = one step towards the top of the visual stack (drawn later). */
  const moveLayer = (id: string, dir: -1 | 1) =>
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const layerLabel = (l: WatermarkPdfLayerState, i: number) =>
    l.type === 'text'
      ? `Text ${i + 1} · ${l.text.trim().slice(0, 16) || 'empty'}`
      : `Logo ${i + 1} · ${(l.logo?.name || 'no file').replace(/\.[^.]+$/, '').slice(0, 16)}`

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------- Canvas column ------------------------- */}
        <div className="space-y-3">
          <div className="relative">
            {/* Floating layer toolbar (switch + reorder) */}
            {layers.length > 0 && (
              <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/95 p-1 shadow-lg backdrop-blur">
                  <button
                    type="button"
                    onClick={() => activeLayer && moveLayer(activeLayer.id, 1)}
                    disabled={!activeLayer || layers.indexOf(activeLayer) === layers.length - 1}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Bring layer forward (moves it on top)"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => activeLayer && moveLayer(activeLayer.id, -1)}
                    disabled={!activeLayer || layers.indexOf(activeLayer) === 0}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Send layer backward (moves it underneath)"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <Select
                    value={activeLayerId ?? undefined}
                    onValueChange={(v) => setActiveLayerId(v)}
                  >
                    <SelectTrigger
                      className="h-8 w-[200px] sm:w-[250px]"
                      aria-label="Active watermark layer"
                    >
                      <SelectValue placeholder="Pick a layer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {layers.map((l, i) => (
                        <SelectItem key={l.id} value={l.id}>
                          {layerLabel(l, i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Live page preview */}
            {activeFile ? (
              <WatermarkPdfPreview file={activeFile.file} layers={layers} />
            ) : (
              <div className="grid h-64 place-items-center rounded-2xl border border-border/60 text-sm text-muted-foreground">
                No PDF selected
              </div>
            )}

            {/* Floating add-layer button */}
            <div className="absolute right-4 top-1/2 z-20 -translate-y-1/2">
              {addOpen && (
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setAddOpen(false)}
                  aria-hidden
                />
              )}
              {addOpen && (
                <div className="absolute bottom-14 right-0 z-20 w-48 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      addLayer('text')
                      setAddOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
                  >
                    <TypeIcon className="h-4 w-4 text-primary" />
                    Text watermark
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addLayer('image')
                      setAddOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
                  >
                    <StampIcon className="h-4 w-4 text-primary" />
                    Image watermark
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAddOpen((o) => !o)}
                aria-label="Add a watermark layer"
                aria-expanded={addOpen}
                className="relative grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
              >
                <Plus className="h-5 w-5" />
                {layers.length > 0 && (
                  <span className="absolute -left-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background">
                    {layers.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Queued PDFs film strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {files.map((f) => {
              const active = f.id === activeFile?.id
              const url = thumbs[f.id]
              return (
                <div key={f.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveFileId(f.id)}
                    aria-label={`Preview ${f.file.name}`}
                    aria-pressed={active}
                    className={cn(
                      'block h-14 w-20 overflow-hidden rounded-lg border-2 bg-muted transition-all',
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
              aria-label="Add more PDFs"
              className="grid h-14 w-20 shrink-0 place-items-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ------------------------- Sidebar column ------------------------ */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
            <p className="text-sm font-semibold">Watermark layers</p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => addLayer('image')}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <StampIcon className="h-4 w-4" />
                </span>
                Add image watermark
              </button>
              <button
                type="button"
                onClick={() => addLayer('text')}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <TypeIcon className="h-4 w-4" />
                </span>
                Add text watermark
              </button>
            </div>

            {layers.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {layers.map((l, i) => {
                  const active = l.id === activeLayerId
                  return (
                    <div
                      key={l.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveLayerId(l.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setActiveLayerId(l.id)
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {l.type === 'text' ? (
                        <TypeIcon className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <StampIcon className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{layerLabel(l, i)}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeLayer(l.id)
                        }}
                        aria-label={`Delete ${layerLabel(l, i)}`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {activeLayer ? (
            <>
              <LayerCard
                layer={activeLayer}
                index={layers.indexOf(activeLayer)}
                onChange={(patch) => patchLayer(activeLayer.id, patch)}
                onRemove={() => removeLayer(activeLayer.id)}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Editing live — every change appears on the page instantly.
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-5 text-center">
              <p className="text-sm font-medium">Nothing selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a text or logo watermark, then select it here to edit —
                the page preview updates live as you type and drag.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Hint */}
      <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
        <StampIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <p className="text-muted-foreground">
          Pick a PDF from the film strip, add text or logo layers with the
          round + button, and edit them live — what you see on the page is
          exactly what gets stamped onto every page of the downloaded file.
          Stack as many layers as you like; your PDF&apos;s content and quality
          are never re-encoded. Everything runs locally; files never leave
          your device.
        </p>
      </div>
    </div>
  )
}
