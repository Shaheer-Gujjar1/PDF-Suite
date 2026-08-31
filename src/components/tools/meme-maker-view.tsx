'use client'

import * as React from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  CaseUpper,
  Copy,
  ImagePlus,
  Italic,
  Laugh,
  Loader2,
  Plus,
  Trash2,
  Type,
  Underline,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  DEFAULT_MEME_FONT,
  MEME_FONT_FAMILIES,
  ensureMemeFonts,
  resolveMemeFont,
} from '@/lib/meme-fonts'

/* ------------------------------------------------------------------------ */
/* Types & shared constants — the render math mirrors worker-source.ts       */
/* (`processors['meme-maker']`); keep MEME_* + draw logic in sync.           */
/* ------------------------------------------------------------------------ */

export interface MemeTextElement {
  id: string
  text: string
  /** 0..1 of the FINAL canvas (white bars included). */
  x: number
  y: number
  font: string
  /** Absolute px; 0 = auto-fit to 92% canvas width. */
  sizePx: number
  color: string
  strokeColor: string
  /** Outline width as a fraction of font size (0..0.5). */
  strokeWidth: number
  bold: boolean
  italic: boolean
  underline: boolean
  caps: boolean
  align: 'left' | 'center' | 'right'
}

export interface MemeState {
  mode: 'inside' | 'outside'
  /** Which white caption bars exist in 'outside' mode (top / bottom / both). */
  bars: 'top' | 'bottom' | 'both'
  elements: MemeTextElement[]
}

export interface MemeMakerResult {
  /** Per-image meme state, keyed by file name (matches worker lookup). */
  memes: Record<string, MemeState>
}

const MEME_BAR_FRAC = 0.16
const MEME_LINE_H = 1.15
const MEME_FIT_W = 0.92

const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg, hsl(var(--border) / 0.35) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--border) / 0.35) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.35) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.35) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
}

function buildMemeFont(el: Pick<MemeTextElement, 'font' | 'bold' | 'italic'>, px: number) {
  const weight = el.bold ? '700' : '400'
  const style = el.italic ? 'italic ' : ''
  const fam = resolveMemeFont(el.font)
  return `${style}${weight} ${px}px "${fam}", sans-serif`
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function makeElement(patch: Partial<MemeTextElement> = {}): MemeTextElement {
  return {
    id: uid('el'),
    text: 'Write your text here',
    x: 0.5,
    y: 0.12,
    font: DEFAULT_MEME_FONT,
    sizePx: 0,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0.09,
    bold: false,
    italic: false,
    underline: false,
    caps: true,
    align: 'center',
    ...patch,
  }
}

function makeMemeState(): MemeState {
  return { mode: 'inside', bars: 'both', elements: [makeElement()] }
}

/** Which white bars + final canvas height for a state — mirrors the worker. */
function memeLayout(
  state: Pick<MemeState, 'mode' | 'bars'>,
  imgH: number
): { top: number; bot: number; H: number } {
  const bar = state.mode === 'outside' ? Math.round(imgH * MEME_BAR_FRAC) : 0
  const bars = state.bars || 'both'
  const top =
    state.mode === 'outside' && (bars === 'top' || bars === 'both') ? bar : 0
  const bot =
    state.mode === 'outside' && (bars === 'bottom' || bars === 'both') ? bar : 0
  return { top, bot, H: imgH + top + bot }
}

/** Remap element ys between two layouts so text stays glued to the image. */
function remapY<T extends { y: number }>(
  els: T[],
  from: { top: number; H: number },
  to: { top: number; H: number }
): T[] {
  return els.map((el) => {
    const abs = el.y * from.H - from.top
    const y = (to.top + abs) / to.H
    return { ...el, y: Math.min(0.99, Math.max(0.01, y)) }
  })
}

interface ImageMeta {
  url: string
  width: number
  height: number
}

interface ElementLayout {
  px: number
  boxes: { x: number; y: number; w: number; h: number }[]
  bbox: { x: number; y: number; w: number; h: number }
}

/** Compute size/position of one element on the FINAL canvas — mirrors
 *  drawMemeText in worker-source.ts exactly. */
function layoutMemeElement(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  el: MemeTextElement
): ElementLayout | null {
  const raw = el.text || ''
  if (!raw.replace(/\s/g, '')) return null
  const txt = el.caps ? raw.toUpperCase() : raw
  const lines = txt.split('\n')
  let px: number
  if (!el.sizePx || el.sizePx <= 0) {
    px = Math.max(14, Math.round(W / 8))
    ctx.font = buildMemeFont(el, px)
    let maxw = 0
    for (const line of lines) maxw = Math.max(maxw, ctx.measureText(line).width)
    if (maxw > W * MEME_FIT_W && maxw > 0) px = Math.max(12, Math.floor(px * ((W * MEME_FIT_W) / maxw)))
  } else {
    px = el.sizePx
  }
  ctx.font = buildMemeFont(el, px)
  ctx.textAlign = el.align || 'center'
  ctx.textBaseline = 'alphabetic'
  const lh = px * MEME_LINE_H
  const blockH = lines.length * lh
  const ax = el.x * W
  const y0 = el.y * H - blockH / 2 + lh / 2 + px * 0.35
  const boxes: ElementLayout['boxes'] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const w = ctx.measureText(line).width
    const lx = el.align === 'left' ? ax : el.align === 'right' ? ax - w : ax - w / 2
    boxes.push({ x: lx - px * 0.1, y: y0 + i * lh - px * 0.9, w: w + px * 0.2, h: lh })
  }
  const bbox = boxes.length
    ? {
        x: Math.min(...boxes.map((b) => b.x)),
        y: Math.min(...boxes.map((b) => b.y)),
        w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
        h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
      }
    : { x: ax - px, y: y0 - px, w: px * 2, h: blockH }
  return { px, boxes, bbox }
}

function paintMemeElement(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  el: MemeTextElement
): ElementLayout | null {
  const lay = layoutMemeElement(ctx, W, H, el)
  if (!lay) return null
  const raw = el.text || ''
  const txt = el.caps ? raw.toUpperCase() : raw
  const lines = txt.split('\n')
  const lh = lay.px * MEME_LINE_H
  const ax = el.x * W
  const y0 = el.y * H - lines.length * lh / 2 + lh / 2 + lay.px * 0.35
  const sw = (el.strokeWidth || 0) * lay.px
  ctx.font = buildMemeFont(el, lay.px)
  ctx.textAlign = el.align || 'center'
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < lines.length; i++) {
    const ly = y0 + i * lh
    if (!lines[i]) continue
    if (sw > 0) {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.lineWidth = sw
      ctx.strokeStyle = el.strokeColor || '#000000'
      ctx.strokeText(lines[i], ax, ly)
    }
    ctx.fillStyle = el.color || '#ffffff'
    ctx.fillText(lines[i], ax, ly)
    if (el.underline) {
      const wU = ctx.measureText(lines[i]).width
      const ux = el.align === 'left' ? ax : el.align === 'right' ? ax - wU : ax - wU / 2
      ctx.fillRect(ux, ly + lay.px * 0.12, wU, Math.max(2, lay.px * 0.06))
    }
  }
  return lay
}

/* ------------------------------------------------------------------------ */
/* Live preview canvas with drag-to-position                                 */
/* ------------------------------------------------------------------------ */
function MemePreview({
  file,
  state,
  activeElementId,
  fontsReady,
  onSelect,
  onMove,
  onMetrics,
}: {
  file: File
  state: MemeState
  activeElementId: string | null
  fontsReady: boolean
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onMetrics: (m: Record<string, number>) => void
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [baseImg, setBaseImg] = React.useState<HTMLImageElement | null>(null)
  const layoutsRef = React.useRef<Record<string, ElementLayout>>({})
  const dragRef = React.useRef<{ id: string; dx: number; dy: number } | null>(null)

  /* Load the base image. */
  React.useEffect(() => {
    let cancelled = false
    setBaseImg(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setBaseImg(img)
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

  /* Redraw on any change. */
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !baseImg) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = baseImg.naturalWidth || 1
    const imgH = baseImg.naturalHeight || 1
    const { top, bot, H } = memeLayout(state, imgH)
    canvas.width = W
    canvas.height = H
    ctx.clearRect(0, 0, W, H)
    if (top + bot > 0 || file.type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
    }
    ctx.drawImage(baseImg, 0, top)

    const layouts: Record<string, ElementLayout> = {}
    const metrics: Record<string, number> = {}
    for (const el of state.elements) {
      const lay = paintMemeElement(ctx, W, H, el)
      if (lay) {
        layouts[el.id] = lay
        metrics[el.id] = lay.px
      }
    }
    layoutsRef.current = layouts

    /* Selection outline for the active element (preview only). */
    const active = activeElementId ? layouts[activeElementId] : null
    if (active) {
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.lineWidth = Math.max(2, Math.round(W / 400))
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.95)'
      ctx.strokeRect(
        active.bbox.x - 6,
        active.bbox.y - 6,
        active.bbox.w + 12,
        active.bbox.h + 12
      )
      ctx.restore()
    }
    onMetrics(metrics)
    /* fontsReady is a redraw trigger only (bundled fonts change metrics). */
  }, [baseImg, state, activeElementId, file, fontsReady, onMetrics])

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      cx: ((e.clientX - rect.left) * canvas.width) / rect.width,
      cy: ((e.clientY - rect.top) * canvas.height) / rect.height,
    }
  }

  const hitTest = (cx: number, cy: number) => {
    const pad = 10
    const entries = state.elements.filter((el) => layoutsRef.current[el.id])
    for (let i = entries.length - 1; i >= 0; i--) {
      const el = entries[i]
      const lay = layoutsRef.current[el.id]
      const inBox =
        cx >= lay.bbox.x - pad &&
        cx <= lay.bbox.x + lay.bbox.w + pad &&
        cy >= lay.bbox.y - pad &&
        cy <= lay.bbox.y + lay.bbox.h + pad
      if (inBox) return el
    }
    return null
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60" style={CHECKER_BG}>
      {baseImg ? (
        <canvas
          ref={canvasRef}
          className="mx-auto block h-auto max-h-[560px] w-auto max-w-full cursor-move touch-none select-none"
          onPointerDown={(e) => {
            const { cx, cy } = toCanvas(e)
            const hit = hitTest(cx, cy)
            if (hit) {
              onSelect(hit.id)
              const canvas = canvasRef.current!
              dragRef.current = {
                id: hit.id,
                dx: cx - hit.x * canvas.width,
                dy: cy - hit.y * canvas.height,
              }
              canvas.setPointerCapture(e.pointerId)
            } else {
              onSelect(null)
            }
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag) return
            const { cx, cy } = toCanvas(e)
            const canvas = canvasRef.current!
            const nx = Math.min(0.98, Math.max(0.02, (cx - drag.dx) / canvas.width))
            const ny = Math.min(0.99, Math.max(0.01, (cy - drag.dy) / canvas.height))
            onMove(drag.id, nx, ny)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
        />
      ) : (
        <div className="grid h-64 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Active element editor (sidebar)                                           */
/* ------------------------------------------------------------------------ */
function ElementCard({
  el,
  effectivePx,
  onChange,
  onRemove,
}: {
  el: MemeTextElement
  effectivePx: number
  onChange: (patch: Partial<MemeTextElement>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Type className="h-4 w-4 text-primary" />
          Text settings
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 text-muted-foreground hover:text-destructive"
          aria-label="Delete this text"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <div className="mt-3 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Text (Enter for a new line)</Label>
          <textarea
            value={el.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={2}
            className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-label="Meme text"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Font</Label>
          <Select value={el.font} onValueChange={(v) => onChange({ font: v })}>
            <SelectTrigger className="w-full" aria-label="Font family">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEME_FONT_FAMILIES.map((f) => (
                <SelectItem key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Every font ships with the app — each one renders for real,
            identically in the preview and the downloaded meme on any device.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Auto-fit size</Label>
            <Switch
              checked={el.sizePx === 0}
              onCheckedChange={(v) => onChange({ sizePx: v ? 0 : Math.max(20, effectivePx || 48) })}
              aria-label="Automatically fit the text size to the image width"
            />
          </div>
          {el.sizePx > 0 && (
            <>
              <Slider
                value={[el.sizePx]}
                min={12}
                max={400}
                step={2}
                onValueChange={(v) => onChange({ sizePx: v[0] })}
                className="w-full"
                aria-label="Text size in pixels"
              />
              <p className="text-[11px] text-muted-foreground">{el.sizePx} px</p>
            </>
          )}
          {el.sizePx === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Fits the longest line to 92% of the width — now {effectivePx || '…'} px.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Text color</Label>
            <input
              type="color"
              value={el.color}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background p-1"
              aria-label="Text fill color"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Outline color</Label>
            <input
              type="color"
              value={el.strokeColor}
              onChange={(e) => onChange({ strokeColor: e.target.value })}
              className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background p-1"
              aria-label="Text outline color"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">
            Outline width · {el.strokeWidth === 0 ? 'none' : `${Math.round((el.strokeWidth || 0) * (effectivePx || 0))} px`}
          </Label>
          <Slider
            value={[el.strokeWidth || 0]}
            min={0}
            max={0.3}
            step={0.01}
            onValueChange={(v) => onChange({ strokeWidth: v[0] })}
            className="w-full"
            aria-label="Outline width as a fraction of text size"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Alignment</Label>
          <div className="grid w-[120px] grid-cols-3 overflow-hidden rounded-lg border border-border">
            {(['left', 'center', 'right'] as const).map((a) => {
              const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChange({ align: a })}
                  aria-label={`Align ${a}`}
                  className={cn(
                    'grid h-8 place-items-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                    el.align === a && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Main view — iloveimg-style meme editing studio                            */
/* ------------------------------------------------------------------------ */
interface MemeMakerViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: MemeMakerResult | null) => void
}

export function MemeMakerView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: MemeMakerViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [memes, setMemes] = React.useState<Record<string, MemeState>>({})
  const [activeImageId, setActiveImageId] = React.useState<string | null>(null)
  const [activeElementId, setActiveElementId] = React.useState<string | null>(null)
  const [metrics, setMetrics] = React.useState<Record<string, number>>({})
  const [fontsReady, setFontsReady] = React.useState(false)
  const urlsRef = React.useRef<Record<string, string>>({})

  /* Load the bundled meme fonts once; redraw when they arrive. */
  React.useEffect(() => {
    let cancelled = false
    ensureMemeFonts()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setFontsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  /* ---------------- Initialize state for new files ---------------------- */
  React.useEffect(() => {
    setMemes((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of files) {
        if (!next[f.id]) {
          next[f.id] = makeMemeState()
          changed = true
        }
      }
      for (const id of Object.keys(next)) {
        if (!files.some((f) => f.id === id)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [files])

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
  const activeState: MemeState | null = activeFile
    ? memes[activeFile.id] ?? makeMemeState()
    : null
  const activeElement =
    activeState?.elements.find((e) => e.id === activeElementId) ?? null

  /* Keep the active element valid (per image). */
  React.useEffect(() => {
    if (!activeFile) return
    const st = memes[activeFile.id]
    if (!st) return
    if (activeElementId && st.elements.some((e) => e.id === activeElementId)) return
    setActiveElementId(st.elements.length > 0 ? st.elements[st.elements.length - 1].id : null)
  }, [activeFile, memes, activeElementId])

  /* ---------------- Emit result whenever memes change -------------------- */
  React.useEffect(() => {
    if (files.length === 0) {
      onChange(null)
      return
    }
    const result: Record<string, MemeState> = {}
    for (const f of files) {
      result[f.file.name] = memes[f.id] ?? makeMemeState()
    }
    onChange({ memes: result })
  }, [files, memes, onChange])

  /* ---------------- Mutators --------------------------------------------- */
  const patchActive = (patch: Partial<MemeState>) => {
    if (!activeFile) return
    setMemes((prev) => {
      const cur = prev[activeFile.id] ?? makeMemeState()
      return { ...prev, [activeFile.id]: { ...cur, ...patch } }
    })
  }

  const patchElement = (id: string, patch: Partial<MemeTextElement>) => {
    if (!activeFile) return
    setMemes((prev) => {
      const cur = prev[activeFile.id] ?? makeMemeState()
      return {
        ...prev,
        [activeFile.id]: {
          ...cur,
          elements: cur.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        },
      }
    })
  }

  const moveElement = (id: string, x: number, y: number) =>
    patchElement(id, { x, y })

  const addElement = () => {
    if (!activeFile || !activeState) return
    const el = makeElement({ text: 'New text', y: 0.5 })
    patchActive({ elements: [...activeState.elements, el] })
    setActiveElementId(el.id)
  }

  /** Add a caption pre-centred in the top/bottom bar (enables it if off). */
  const addTextAt = (which: 'top' | 'bottom') => {
    if (!activeFile || !activeState) return
    const imgH = (meta[activeFile.id]?.height ?? 1) || 1
    const from = memeLayout(activeState, imgH)
    let bars = activeState.bars || 'both'
    if (bars !== 'both' && bars !== which) bars = 'both'
    const target = { mode: 'outside' as const, bars }
    const to = memeLayout(target, imgH)
    const elements = remapY(activeState.elements, from, to)
    const y =
      which === 'top' ? to.top / 2 / to.H : (to.top + imgH + to.bot / 2) / to.H
    const el = makeElement({
      text: which === 'top' ? 'Top text' : 'Bottom text',
      y: Math.min(0.98, Math.max(0.02, y)),
    })
    patchActive({ ...target, elements: [...elements, el] })
    setActiveElementId(el.id)
  }

  const duplicateElement = () => {
    if (!activeElement || !activeState) return
    const el = makeElement({
      ...activeElement,
      id: uid('el'),
      y: Math.min(0.95, activeElement.y + 0.08),
    })
    patchActive({ elements: [...activeState.elements, el] })
    setActiveElementId(el.id)
  }

  const removeElement = (id: string) => {
    if (!activeFile || !activeState) return
    patchActive({ elements: activeState.elements.filter((e) => e.id !== id) })
  }

  /** Inside ↔ Outside: remap every element's y so text stays glued to the
   *  image content (bars are added/removed around it). */
  const toggleMode = (mode: 'inside' | 'outside') => {
    if (!activeFile || !activeState || activeState.mode === mode) return
    const imgH = (meta[activeFile.id]?.height ?? 1) || 1
    const from = memeLayout(activeState, imgH)
    const to = memeLayout({ ...activeState, mode }, imgH)
    patchActive({ mode, elements: remapY(activeState.elements, from, to) })
  }

  /** Which white caption bars exist while in 'outside' mode. */
  const setBars = (bars: 'top' | 'bottom' | 'both') => {
    if (
      !activeFile ||
      !activeState ||
      activeState.mode !== 'outside' ||
      (activeState.bars || 'both') === bars
    )
      return
    const imgH = (meta[activeFile.id]?.height ?? 1) || 1
    const from = memeLayout(activeState, imgH)
    const to = memeLayout({ ...activeState, bars }, imgH)
    patchActive({ bars, elements: remapY(activeState.elements, from, to) })
  }

  const elementLabel = (el: MemeTextElement, i: number) =>
    `Text ${i + 1} · ${el.text.trim().replace(/\s+/g, ' ').slice(0, 16) || 'empty'}`

  const handleMetrics = React.useCallback((m: Record<string, number>) => {
    setMetrics((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(m)])
      for (const k of keys) if (prev[k] !== m[k]) return m
      return prev
    })
  }, [])

  const effectivePx = activeElement ? metrics[activeElement.id] ?? 0 : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------- Canvas column ------------------------- */}
        <div className="space-y-3">
          {/* Floating text toolbar (iloveimg-style pill, ABOVE the canvas so
              it never blocks dragging the top caption) */}
          {activeElement && (
            <div className="flex justify-center">
              <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/95 p-1 shadow-lg backdrop-blur">
                <Select
                  value={activeElement.font}
                  onValueChange={(v) => patchElement(activeElement.id, { font: v })}
                >
                  <SelectTrigger
                    className="h-8 w-[120px] text-xs"
                    aria-label="Font family"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEME_FONT_FAMILIES.map((f) => (
                      <SelectItem key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(
                  [
                    ['bold', <Bold key="b" className="h-3.5 w-3.5" />, 'Bold'],
                    ['italic', <Italic key="i" className="h-3.5 w-3.5" />, 'Italic'],
                    ['underline', <Underline key="u" className="h-3.5 w-3.5" />, 'Underline'],
                    ['caps', <CaseUpper key="c" className="h-3.5 w-3.5" />, 'ALL-CAPS'],
                  ] as const
                ).map(([key, icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => patchElement(activeElement.id, { [key]: !activeElement[key] })}
                    aria-label={`${label} toggle`}
                    aria-pressed={activeElement[key]}
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                      activeElement[key] && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
                    )}
                  >
                    {icon}
                  </button>
                ))}
                <div className="mx-0.5 h-5 w-px bg-border" />
                {(['left', 'center', 'right'] as const).map((a) => {
                  const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => patchElement(activeElement.id, { align: a })}
                      aria-label={`Align ${a}`}
                      aria-pressed={activeElement.align === a}
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                        activeElement.align === a && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  )
                })}
                <div className="mx-0.5 h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={duplicateElement}
                  aria-label="Duplicate this text"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeElement(activeElement.id)}
                  aria-label="Delete this text"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="relative">
            {/* Live canvas */}
            {activeFile && activeState ? (
              <MemePreview
                file={activeFile.file}
                state={activeState}
                activeElementId={activeElementId}
                fontsReady={fontsReady}
                onSelect={setActiveElementId}
                onMove={moveElement}
                onMetrics={handleMetrics}
              />
            ) : (
              <div
                className="grid h-64 place-items-center rounded-2xl border border-border/60 text-sm text-muted-foreground"
                style={CHECKER_BG}
              >
                No image selected
              </div>
            )}

            {/* Floating add-text button */}
            <div className="absolute right-4 top-1/2 z-20 -translate-y-1/2">
              <button
                type="button"
                onClick={addElement}
                aria-label="Add a text box"
                className="relative grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
              >
                <Plus className="h-5 w-5" />
                {(activeState?.elements.length ?? 0) > 0 && (
                  <span className="absolute -left-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background">
                    {activeState?.elements.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Queued images film strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {files.map((f) => {
              const active = f.id === activeFile?.id
              const url = meta[f.id]?.url
              return (
                <div key={f.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveImageId(f.id)}
                    aria-label={`Edit meme for ${f.file.name}`}
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
              aria-label="Add more images"
              className="grid h-14 w-20 shrink-0 place-items-center rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ------------------------- Sidebar column ------------------------ */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
            <p className="text-sm font-semibold">Meme editor</p>

            {/* Inside / Outside toggle */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ['inside', 'Text inside'],
                  ['outside', 'Text outside'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMode(m)}
                  aria-pressed={activeState?.mode === m}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors',
                    activeState?.mode === m
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              &ldquo;Outside&rdquo; adds a classic white caption bar — pick
              top, bottom or both. Your text stays glued to the picture while
              the bars change.
            </p>

            {/* Top / Bottom / Both caption bars (outside mode only) */}
            {activeState?.mode === 'outside' && (
              <div className="mt-2">
                <Label className="text-xs font-medium">Caption bars</Label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {(
                    [
                      ['top', 'Top'],
                      ['bottom', 'Bottom'],
                      ['both', 'Both'],
                    ] as const
                  ).map(([b, label]) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBars(b)}
                      aria-label={`${label} caption bar${b === 'both' ? 's' : ''}`}
                      aria-pressed={(activeState.bars || 'both') === b}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                        (activeState.bars || 'both') === b
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onAddMore}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <ImagePlus className="h-4 w-4" />
                </span>
                Add image
              </button>
              <button
                type="button"
                onClick={addElement}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Type className="h-4 w-4" />
                </span>
                Add text
              </button>
              {activeState?.mode === 'outside' && (
                <>
                  <button
                    type="button"
                    onClick={() => addTextAt('top')}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <ArrowUpToLine className="h-4 w-4" />
                    </span>
                    Top text
                  </button>
                  <button
                    type="button"
                    onClick={() => addTextAt('bottom')}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <ArrowDownToLine className="h-4 w-4" />
                    </span>
                    Bottom text
                  </button>
                </>
              )}
            </div>

            {activeState && activeState.elements.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {activeState.elements.map((el, i) => {
                  const active = el.id === activeElementId
                  return (
                    <div
                      key={el.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveElementId(el.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setActiveElementId(el.id)
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      <Type className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{elementLabel(el, i)}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeElement(el.id)
                        }}
                        aria-label={`Delete ${elementLabel(el, i)}`}
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

          {activeElement ? (
            <>
              <ElementCard
                el={activeElement}
                effectivePx={effectivePx}
                onChange={(patch) => patchElement(activeElement.id, patch)}
                onRemove={() => removeElement(activeElement.id)}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Editing live — drag text on the canvas or type here; every
                change updates the preview instantly.
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-5 text-center">
              <p className="text-sm font-medium">Nothing selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click a text box on the canvas (or add one) to style it — the
                meme updates live as you type and drag.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Hint */}
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 text-sm">
        <Laugh className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
        <p className="text-muted-foreground">
          Pick an image from the film strip, then click any text on the canvas
          to drag it around. Use the floating toolbar for quick bold/italic/
          caps and duplicate; the sidebar has fonts, sizes and colors. What
          you see is exactly what gets baked into the download — original size
          and format, 100% locally.
        </p>
      </div>
    </div>
  )
}
