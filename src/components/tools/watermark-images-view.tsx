'use client'

import * as React from 'react'
import {
  ImagePlus,
  Loader2,
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

export interface WatermarkLayerState {
  id: string
  type: 'text' | 'image'
  /* text layers */
  text: string
  fontFamily: string
  /** 0 = auto (min(w, h) / 8). */
  fontSizePx: number
  color: string
  /* image (logo) layers */
  logo: File | null
  logoUrl: string | null
  /** Logo width as % of the image width. */
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
  /** true = drawn on top of the image, false = behind it. */
  over: boolean
}

export interface WatermarkImagesResult {
  layers: WatermarkLayerState[]
}

interface WatermarkImagesViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: WatermarkImagesResult | null) => void
}

interface ImageMeta {
  url: string
  width: number
  height: number
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
  return `wm_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 6)}`
}

function makeTextLayer(): WatermarkLayerState {
  return {
    id: uid(),
    type: 'text',
    text: '',
    fontFamily: FONTS[0].value,
    fontSizePx: 0,
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
    over: true,
  }
}

function makeLogoLayer(): WatermarkLayerState {
  return { ...makeTextLayer(), type: 'image' as const }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/* ------------------------------------------------------------------------ */
/* Live preview — mirrors the worker's drawWatermarkLayer() math exactly     */
/* (same auto size, rotation, tiling, margins, opacity and layering), so     */
/* what you see here is what gets baked into every output file.              */
/* ------------------------------------------------------------------------ */
function WatermarkPreview({
  file,
  layers,
}: {
  file: File
  layers: WatermarkLayerState[]
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [baseImg, setBaseImg] = React.useState<HTMLImageElement | null>(null)
  const [logoImgs, setLogoImgs] = React.useState<Record<string, HTMLImageElement>>({})

  React.useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => setBaseImg(img)
    img.onerror = () => setBaseImg(null)
    img.src = url
    return () => {
      URL.revokeObjectURL(url)
      setBaseImg(null)
    }
  }, [file])

  React.useEffect(() => {
    setLogoImgs({})
    if (layers.every((l) => l.type !== 'image' || !l.logo)) return
    let alive = true
    const urls: string[] = []
    for (const l of layers) {
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
  }, [layers])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !baseImg) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = baseImg.naturalWidth || 1
    const H = baseImg.naturalHeight || 1
    canvas.width = W
    canvas.height = H
    ctx.clearRect(0, 0, W, H)
    if (file.type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
    }

    const drawLayer = (L: WatermarkLayerState) => {
      let tw: number
      let th: number
      if (L.type === 'text') {
        const text = L.text || ''
        if (!text) return
        const size =
          L.fontSizePx > 0
            ? L.fontSizePx
            : Math.max(12, Math.round(Math.min(W, H) / 8))
        ctx.font = `${size}px ${L.fontFamily || 'sans-serif'}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        tw = ctx.measureText(text).width
        th = size
      } else {
        const logo = logoImgs[L.id]
        if (!logo) return
        const scale = Math.max(1, Math.min(100, L.scale || 25)) / 100
        tw = Math.max(1, Math.round(W * scale))
        th = Math.max(1, Math.round(logo.naturalHeight * (tw / logo.naturalWidth)))
      }
      const rad = ((L.rotation || 0) * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const bboxW = tw * cos + th * sin
      const bboxH = tw * sin + th * cos
      const mX = Math.max(0, L.marginX || 0)
      const mY = Math.max(0, L.marginY || 0)
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
        for (let yy = -stepY; yy < H + stepY; yy += stepY) {
          for (let xx = -stepX; xx < W + stepX; xx += stepX) {
            stamp(xx + stepX / 2, yy + stepY / 2)
          }
        }
      } else {
        const pos = L.position || 'bottom-right'
        const cx = pos.includes('left')
          ? mX + bboxW / 2
          : pos.includes('right')
            ? W - mX - bboxW / 2
            : W / 2
        const cy = pos.includes('top')
          ? mY + bboxH / 2
          : pos.includes('bottom')
            ? H - mY - bboxH / 2
            : H / 2
        stamp(cx, cy)
      }
    }

    for (const l of layers.filter((x) => x.over === false)) drawLayer(l)
    ctx.globalAlpha = 1
    ctx.drawImage(baseImg, 0, 0)
    for (const l of layers.filter((x) => x.over !== false)) drawLayer(l)
    ctx.globalAlpha = 1
  }, [baseImg, logoImgs, layers, file])

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/60"
      style={{
        backgroundImage:
          'linear-gradient(45deg, rgba(128,128,128,0.14) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.14) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.14) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.14) 75%)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
      }}
    >
      {baseImg ? (
        <canvas ref={canvasRef} className="mx-auto block h-auto max-h-[340px] w-auto max-w-full" />
      ) : (
        <div className="grid h-40 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Single watermark layer editor                                             */
/* ------------------------------------------------------------------------ */
function LayerCard({
  layer,
  index,
  onChange,
  onRemove,
}: {
  layer: WatermarkLayerState
  index: number
  onChange: (patch: Partial<WatermarkLayerState>) => void
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
        <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                Size {layer.fontSizePx > 0 ? `· ${layer.fontSizePx} px` : '· auto-fit'}
              </Label>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                Auto
                <Switch
                  checked={layer.fontSizePx === 0}
                  onCheckedChange={(v) => onChange({ fontSizePx: v ? 0 : 48 })}
                  aria-label="Automatic text size"
                />
              </span>
            </div>
            <Slider
              value={[layer.fontSizePx > 0 ? layer.fontSizePx : 48]}
              min={8}
              max={200}
              step={1}
              disabled={layer.fontSizePx === 0}
              onValueChange={(v) => onChange({ fontSizePx: v[0] })}
              aria-label="Text size in pixels"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
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
              Size · {layer.scale}% of image width
            </Label>
            <Slider
              value={[layer.scale]}
              min={5}
              max={100}
              step={1}
              onValueChange={(v) => onChange({ scale: v[0] })}
              aria-label="Logo size as percent of image width"
            />
          </div>
        </div>
      )}

      {/* Shared controls */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Tile across the image
            </Label>
            <Switch
              checked={layer.tile}
              onCheckedChange={(v) => onChange({ tile: v })}
              aria-label="Tile the watermark across the whole image"
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {layer.tile
              ? 'Repeats over the whole image — margins set the gap.'
              : 'Place once, then pick a spot on the right.'}
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Placement</Label>
          <div className="grid w-[96px] grid-cols-3 gap-1" role="group" aria-label="Watermark placement">
            {POSITIONS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={layer.tile}
                onClick={() => onChange({ position: p })}
                aria-label={`Place watermark ${p.replace('-', ' ')}`}
                aria-pressed={!layer.tile && layer.position === p}
                className={cn(
                  'h-7 w-7 rounded-md border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  !layer.tile && layer.position === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 hover:bg-secondary'
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Margins + layering */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Horizontal margin · {layer.marginX} px
          </Label>
          <Slider
            value={[layer.marginX]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => onChange({ marginX: v[0] })}
            aria-label="Horizontal margin"
          />
          <Label className="pt-1 text-xs font-medium text-muted-foreground">
            Vertical margin · {layer.marginY} px
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
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Layering</Label>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => onChange({ over: true })}
              aria-pressed={layer.over}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                layer.over
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Over image
            </button>
            <button
              type="button"
              onClick={() => onChange({ over: false })}
              aria-pressed={!layer.over}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                !layer.over
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Behind image
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            &ldquo;Behind&rdquo; only shows through transparent areas (PNG/WEBP).
          </p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Main view                                                                 */
/* ------------------------------------------------------------------------ */
export function WatermarkImagesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: WatermarkImagesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [layers, setLayers] = React.useState<WatermarkLayerState[]>([])
  const urlsRef = React.useRef<Record<string, string>>({})

  /* Revoke logo object URLs on unmount. */
  const layersRef = React.useRef<WatermarkLayerState[]>([])
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

  /* ---------------- Emit result whenever layers change ------------------- */
  React.useEffect(() => {
    if (files.length === 0 || layers.length === 0) {
      onChange(null)
      return
    }
    onChange({ layers })
  }, [files, layers, onChange])

  const patchLayer = (id: string, patch: Partial<WatermarkLayerState>) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const removeLayer = (id: string) =>
    setLayers((prev) => {
      const target = prev.find((l) => l.id === id)
      if (target?.logoUrl) URL.revokeObjectURL(target.logoUrl)
      return prev.filter((l) => l.id !== id)
    })

  return (
    <div className="space-y-4">
      {/* Watermark layers */}
      <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <StampIcon className="h-4 w-4" />
          </span>
          <p className="flex-1 text-sm font-medium">Watermark layers</p>
          <button
            type="button"
            onClick={() => setLayers((prev) => [...prev, makeTextLayer()])}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <TypeIcon className="h-3.5 w-3.5" />
            Add text
          </button>
          <button
            type="button"
            onClick={() => setLayers((prev) => [...prev, makeLogoLayer()])}
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
          >
            <StampIcon className="h-3.5 w-3.5" />
            Add logo
          </button>
        </div>

        {layers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
            <StampIcon className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">No watermarks yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a text or logo watermark — stack as many as you like. They
              apply to every queued image.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {layers.map((l, i) => (
              <LayerCard
                key={l.id}
                layer={l}
                index={i}
                onChange={(patch) => patchLayer(l.id, patch)}
                onRemove={() => removeLayer(l.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live preview */}
      {files.length > 0 && layers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Live preview — first image, scaled to fit. Output keeps full
            resolution.
          </p>
          <WatermarkPreview file={files[0].file} layers={layers} />
        </div>
      )}

      {/* Per-image list */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Queued images — every watermark layer is applied to each one:
        </p>
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {files.map((f) => {
            const m = meta[f.id]
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-2.5"
              >
                {m ? (
                  <img
                    src={m.url}
                    alt={f.file.name}
                    className="h-14 w-14 shrink-0 rounded-lg border border-border/60 bg-muted object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.file.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(f.file.size)}
                    {m && m.width > 1 ? ` · ${m.width}×${m.height} px` : ''}
                    {' · '}
                    <span className="font-medium text-primary">
                      +{layers.length} watermark{layers.length > 1 ? 's' : ''}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${f.file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Add more tile */}
      <button
        type="button"
        onClick={onAddMore}
        className={cn(
          'flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors',
          'hover:border-primary/50 hover:text-primary'
        )}
        aria-label="Add more images"
      >
        <ImagePlus className="h-4 w-4" />
        Add more images
      </button>

      {/* Hint */}
      <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
        <StampIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
        <p className="text-muted-foreground">
          Stamp text, a logo, or both — stack multiple layers and tune font,
          size, color, opacity, rotation, tiling and margins exactly like you
          need. Images keep their original size and format (JPG is flattened
          onto white since it has no transparency). Everything is generated
          locally; files never leave your device.
        </p>
      </div>
    </div>
  )
}
