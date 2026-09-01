'use client'

import * as React from 'react'
import { ImagePlus, Loader2, Shrink as ShrinkIcon, X } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type CompressTarget = 'keep' | 'png' | 'jpg' | 'jpeg' | 'webp'

export interface CompressImagesResult {
  /** Target format per image, keyed by file name ('keep' = preserve source). */
  formats: Record<string, CompressTarget>
  /** 0..1 — quality for lossy targets (JPG/WEBP). PNG ignores it. */
  quality: number
  /** Downscale so the longest edge is at most this many px (0 = keep original). */
  maxDim: number
}

interface CompressImagesViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: CompressImagesResult | null) => void
}

interface ImageMeta {
  url: string
  width: number
  height: number
}

const TARGETS: { value: CompressTarget; label: string }[] = [
  { value: 'keep', label: 'Keep original' },
  { value: 'jpg', label: 'JPG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'png', label: 'PNG' },
]

const DEFAULT_TARGET: CompressTarget = 'keep'

const MAX_DIMS: { value: string; label: string }[] = [
  { value: '0', label: 'Original size' },
  { value: '3840', label: '4K · 3840 px' },
  { value: '2560', label: '2560 px' },
  { value: '1920', label: 'Full HD · 1920 px' },
  { value: '1280', label: 'HD · 1280 px' },
  { value: '800', label: '800 px' },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function sourceExt(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return ext || '?'
}

export function CompressImagesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: CompressImagesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [formats, setFormats] = React.useState<Record<string, CompressTarget>>({})
  const [qualityPct, setQualityPct] = React.useState(70)
  const [maxDim, setMaxDim] = React.useState(0)

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
        // Preview failed (e.g. exotic format) — the worker surfaces a clear
        // error for this file when Run is pressed.
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

  /* ---------------- Emit result whenever formats/quality change --------- */
  React.useEffect(() => {
    if (files.length === 0) {
      onChange(null)
      return
    }
    const result: Record<string, CompressTarget> = {}
    for (const f of files) {
      result[f.file.name] = formats[f.id] ?? DEFAULT_TARGET
    }
    onChange({ formats: result, quality: qualityPct / 100, maxDim })
  }, [files, formats, qualityPct, maxDim, onChange])

  const setFormat = (id: string, target: CompressTarget) =>
    setFormats((prev) => ({ ...prev, [id]: target }))

  const setFormatForAll = (target: CompressTarget) =>
    setFormats(Object.fromEntries(files.map((f) => [f.id, target])))

  return (
    <div className="space-y-4">
      {/* Global settings */}
      <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShrinkIcon className="h-4 w-4" />
          </span>
          Compression settings
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Same format for all</Label>
            <p className="text-xs text-muted-foreground">
              Overrides the per-image choices below.
            </p>
            <Select onValueChange={(v) => setFormatForAll(v as CompressTarget)}>
              <SelectTrigger className="w-full sm:w-[190px]" aria-label="Set the same output format for all images">
                <SelectValue placeholder="Pick a format…" />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Quality · {qualityPct}%
            </Label>
            <p className="text-xs text-muted-foreground">
              Used by JPG and WEBP — lower means smaller. PNG is lossless.
            </p>
            <Slider
              value={[qualityPct]}
              min={10}
              max={100}
              step={1}
              onValueChange={(v) => setQualityPct(v[0])}
              className="w-full sm:max-w-[200px]"
              aria-label="Output quality for JPG and WEBP"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Max size</Label>
            <p className="text-xs text-muted-foreground">
              Shrink images whose longest edge exceeds this.
            </p>
            <Select
              value={String(maxDim)}
              onValueChange={(v) => setMaxDim(Number(v))}
            >
              <SelectTrigger className="w-full sm:w-[190px]" aria-label="Maximum image size in pixels">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_DIMS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Per-image format list */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Choose the output format for each image:
        </p>
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {files.map((f) => {
            const m = meta[f.id]
            const fmt = formats[f.id] ?? DEFAULT_TARGET
            const src = sourceExt(f.file.name).toUpperCase()
            const outLabel =
              fmt === 'keep'
                ? `same (${src === '?' ? 'auto' : src})`
                : fmt.toUpperCase()
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
                    {m && m.width > 1
                      ? ` · ${m.width}×${m.height} px${
                          maxDim > 0 && Math.max(m.width, m.height) > maxDim
                            ? ` → ${Math.round(
                                (m.width >= m.height
                                  ? maxDim
                                  : (m.width / m.height) * maxDim)
                              )}×${Math.round(
                                (m.height >= m.width
                                  ? maxDim
                                  : (m.height / m.width) * maxDim)
                              )} px`
                            : ''
                        }`
                      : ''}
                    {' · '}
                    <span className="font-medium text-primary">{outLabel}</span>
                  </p>
                </div>
                <Select
                  value={fmt}
                  onValueChange={(v) => setFormat(f.id, v as CompressTarget)}
                >
                  <SelectTrigger
                    className="h-8 w-[150px] shrink-0"
                    aria-label={`Output format for ${f.file.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

      {/* Info hint */}
      <div className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
        <ShrinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="text-muted-foreground">
          JPG and WEBP shrink the most — WEBP is usually the smallest for the
          same look. Keeping the original format only re-encodes the image, so
          PNG stays lossless while JPG uses the quality slider. GIF, BMP and
          other exotic inputs are saved as PNG when &ldquo;Keep original&rdquo;
          is selected. Everything compresses locally in your browser; files
          never leave your device.
        </p>
      </div>
    </div>
  )
}
