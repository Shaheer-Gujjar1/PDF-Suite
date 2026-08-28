'use client'

import * as React from 'react'
import { Globe as GlobeIcon, ImagePlus, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FaviconResult {
  /** Square sizes (px) embedded in the .ico, ascending. */
  sizes: number[]
}

interface FaviconViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: FaviconResult | null) => void
}

interface ImageMeta {
  url: string
  width: number
  height: number
}

const SIZE_OPTIONS = [16, 32, 48, 64, 128, 256]
const CLASSIC_SIZES = [16, 32, 48]
const FULL_SIZES = [16, 32, 48, 64, 128, 256]
const PREVIEW_SIZES = [16, 32, 48]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/** Draws the image contain-fitted at 16/32/48 px — a live "browser tab" preview. */
function FaviconPreview({ url }: { url: string }) {
  const refs = React.useRef<(HTMLCanvasElement | null)[]>([])

  React.useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      for (let i = 0; i < PREVIEW_SIZES.length; i++) {
        const canvas = refs.current[i]
        if (!canvas) continue
        const size = PREVIEW_SIZES[i]
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.clearRect(0, 0, size, size)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        const k = Math.min(size / img.naturalWidth, size / img.naturalHeight)
        const dw = Math.max(1, Math.round(img.naturalWidth * k))
        const dh = Math.max(1, Math.round(img.naturalHeight * k))
        ctx.drawImage(
          img,
          Math.floor((size - dw) / 2),
          Math.floor((size - dh) / 2),
          dw,
          dh
        )
      }
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div className="flex items-end gap-1.5" aria-hidden>
      {PREVIEW_SIZES.map((size, i) => (
        <div key={size} className="flex flex-col items-center gap-0.5">
          <canvas
            ref={(el) => {
              refs.current[i] = el
            }}
            style={{ width: size, height: size }}
            className="rounded border border-border/60 bg-muted"
          />
          <span className="text-[8px] leading-none text-muted-foreground">
            {size}px
          </span>
        </div>
      ))}
    </div>
  )
}

export function FaviconGeneratorView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: FaviconViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [sizes, setSizes] = React.useState<number[]>(FULL_SIZES)

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
        // Preview failed (exotic format) — the worker surfaces a clear
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

  /* ---------------- Emit result whenever sizes change -------------------- */
  React.useEffect(() => {
    if (files.length === 0 || sizes.length === 0) {
      onChange(null)
      return
    }
    onChange({ sizes: [...sizes].sort((a, b) => a - b) })
  }, [files, sizes, onChange])

  const toggleSize = (size: number) =>
    setSizes((prev) =>
      prev.includes(size)
        ? prev.filter((s) => s !== size)
        : [...prev, size].sort((a, b) => a - b)
    )

  return (
    <div className="space-y-4">
      {/* Icon sizes */}
      <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <GlobeIcon className="h-4 w-4" />
          </span>
          Icon sizes baked into the .ico
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSizes(CLASSIC_SIZES)}
            className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
          >
            Classic · 16 / 32 / 48
          </button>
          <button
            type="button"
            onClick={() => setSizes(FULL_SIZES)}
            className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
          >
            Full · 16 – 256
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SIZE_OPTIONS.map((size) => {
            const active = sizes.includes(size)
            return (
              <button
                key={size}
                type="button"
                onClick={() => toggleSize(size)}
                aria-pressed={active}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-background text-muted-foreground ring-1 ring-border hover:text-foreground'
                )}
              >
                {size}px
              </button>
            )
          })}
        </div>
        {sizes.length === 0 && (
          <p className="mt-3 text-xs font-medium text-destructive">
            Pick at least one size to enable generation.
          </p>
        )}
      </div>

      {/* Per-image list with live previews */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Preview — how each favicon will look in a browser tab:
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
                    {m && m.width > 1
                      ? ` · ${m.width}×${m.height} px`
                      : ''}
                    {' · '}
                    <span className="font-medium text-primary">
                      {sizes.length > 0
                        ? `${sizes.join('/')} → .ico + ${sizes.length} PNGs`
                        : '.ico'}
                    </span>
                  </p>
                </div>
                {m && m.width > 1 && <FaviconPreview url={m.url} />}
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
      <div className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
        <GlobeIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="text-muted-foreground">
          Drop your logo in any format — JPG, PNG, WEBP, GIF, BMP and more.
          You get one multi-size <span className="font-medium text-foreground">.ico</span>{' '}
          (all sizes packed inside a single file — browsers and Windows pick
          the sharpest one automatically) plus a ready-to-use PNG for every
          size, e.g. <span className="font-medium text-foreground">favicon-32x32.png</span>,
          for asset pipelines and meta tags. Non-square images are centered on
          a transparent square background, so nothing gets stretched.
          Everything is generated locally; files never leave your device.
        </p>
      </div>
    </div>
  )
}
