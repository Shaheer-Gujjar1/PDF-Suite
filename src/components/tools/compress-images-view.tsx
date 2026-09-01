'use client'

import * as React from 'react'
import { ImagePlus, Loader2, Shrink as ShrinkIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** No user options — compression is fully automatic. Emitted only so the
 *  tool page knows the file list is ready to process. */
export interface CompressImagesResult {
  readonly auto: true
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function CompressImagesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: CompressImagesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})

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

  /* ---------------- Emit readiness whenever the file list changes ------- */
  React.useEffect(() => {
    onChange(files.length > 0 ? { auto: true } : null)
  }, [files, onChange])

  return (
    <div className="space-y-4">
      {/* Auto banner */}
      <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <ShrinkIcon className="h-4 w-4" />
        </span>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Fully automatic.</span>{' '}
          No settings needed — dimensions and format are kept, and no file ever
          comes out larger than it went in.
        </p>
      </div>

      {/* File list */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Images ready to compress:
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
                    <span className="font-medium text-primary">Auto</span>
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

      {/* Info hint */}
      <div className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
        <ShrinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="text-muted-foreground">
          Each image is re-encoded at a smart quality level in its original
          format (JPG stays JPG, PNG stays PNG, WEBP stays WEBP — exotic inputs
          like GIF or BMP are saved as PNG). Already-optimized images are kept
          byte-for-byte, so results are never larger than the originals.
          Dimensions stay untouched — to change the size of an image, use the
          Resize Image tool. Everything compresses locally in your browser;
          files never leave your device.
        </p>
      </div>
    </div>
  )
}
