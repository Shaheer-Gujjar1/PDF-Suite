'use client'

import * as React from 'react'
import {
  FlipHorizontal,
  FlipVertical,
  ImagePlus,
  Loader2,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Transform applied to one image: quarter-turn angle + axis flips.
 *  Angles are always normalized to 0 | 90 | 180 | 270. */
export interface Rotation {
  angle: number
  flipH: boolean
  flipV: boolean
}

export interface RotateImagesResult {
  /** Per-image transform, keyed by file name (matches worker lookup). */
  rotations: Record<string, Rotation>
}

interface RotateImagesViewProps {
  files: { id: string; file: File }[]
  onRemove: (id: string) => void
  onAddMore: () => void
  onChange: (result: RotateImagesResult | null) => void
}

interface ImageMeta {
  url: string
  width: number
  height: number
}

/** Fresh images start rotated 90° clockwise — Run always does something
 *  visible, matching the PDF Rotate tool's default. */
const DEFAULT_ROTATION: Rotation = { angle: 90, flipH: false, flipV: false }

const normalize = (a: number) => (((a % 360) + 360) % 360)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function RotateImagesView({
  files,
  onRemove,
  onAddMore,
  onChange,
}: RotateImagesViewProps) {
  const [meta, setMeta] = React.useState<Record<string, ImageMeta>>({})
  const [rotations, setRotations] = React.useState<Record<string, Rotation>>({})

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
        // Preview failed (exotic format) — worker surfaces a clear error
        // for this file when Run is pressed.
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

  /* ---------------- Emit result whenever rotations change --------------- */
  React.useEffect(() => {
    if (files.length === 0) {
      onChange(null)
      return
    }
    const result: Record<string, Rotation> = {}
    for (const f of files) {
      result[f.file.name] = rotations[f.id] ?? DEFAULT_ROTATION
    }
    onChange({ rotations: result })
  }, [files, rotations, onChange])

  /* ---------------- Per-file transforms --------------------------------- */
  const update = (id: string, fn: (r: Rotation) => Rotation) =>
    setRotations((prev) => ({ ...prev, [id]: fn(prev[id] ?? DEFAULT_ROTATION) }))

  const rotateAll = (dir: 1 | -1) =>
    setRotations((prev) => {
      const next: Record<string, Rotation> = {}
      for (const f of files) {
        const cur = prev[f.id] ?? DEFAULT_ROTATION
        next[f.id] = { ...cur, angle: normalize(cur.angle + dir * 90) }
      }
      return next
    })

  const flipAll = (axis: 'flipH' | 'flipV') =>
    setRotations((prev) => {
      const next: Record<string, Rotation> = {}
      for (const f of files) {
        const cur = prev[f.id] ?? DEFAULT_ROTATION
        next[f.id] = { ...cur, [axis]: !cur[axis] }
      }
      return next
    })

  const resetAll = () =>
    setRotations(
      Object.fromEntries(files.map((f) => [f.id, { angle: 0, flipH: false, flipV: false }]))
    )

  /* ---------------- Render ----------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Global controls */}
      <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <RotateCw className="h-4 w-4" />
          </span>
          Rotation settings
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rotateAll(-1)}
            aria-label="Rotate all images 90 degrees counter-clockwise"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Rotate all left
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rotateAll(1)}
            aria-label="Rotate all images 90 degrees clockwise"
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Rotate all right
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => flipAll('flipH')}
            aria-label="Flip all images horizontally"
          >
            <FlipHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Flip all H
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => flipAll('flipV')}
            aria-label="Flip all images vertically"
          >
            <FlipVertical className="mr-1.5 h-3.5 w-3.5" />
            Flip all V
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetAll}
            aria-label="Reset all images to their original orientation"
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset all
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          New images start at 90° clockwise — adjust each one below. Rotations
          happen in exact quarter turns, so no pixel is ever resampled or
          blurred.
        </p>
      </div>

      {/* Per-image list */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Set the orientation for each image:
        </p>
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {files.map((f) => {
            const m = meta[f.id]
            const rot = rotations[f.id] ?? DEFAULT_ROTATION
            const swap = rot.angle === 90 || rot.angle === 270
            const outW = m && m.width > 1 ? (swap ? m.height : m.width) : 0
            const outH = m && m.width > 1 ? (swap ? m.width : m.height) : 0
            const unchanged = rot.angle === 0 && !rot.flipH && !rot.flipV
            const ops: string[] = []
            if (rot.angle !== 0) ops.push(`${rot.angle}°`)
            if (rot.flipH) ops.push('flip H')
            if (rot.flipV) ops.push('flip V')
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-2.5"
              >
                {/* Live-rotated thumbnail (matches the worker math exactly) */}
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60 bg-muted">
                  {m ? (
                    <img
                      src={m.url}
                      alt={f.file.name}
                      className="h-14 w-14 object-contain transition-transform duration-200"
                      style={{
                        transform: `rotate(${rot.angle}deg) scaleX(${rot.flipH ? -1 : 1}) scaleY(${rot.flipV ? -1 : 1})`,
                      }}
                      draggable={false}
                    />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.file.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(f.file.size)}
                    {m && m.width > 1 && (
                      <>
                        {' · '}
                        {m.width}×{m.height}
                        {' → '}
                        <span className="font-medium text-foreground">
                          {outW}×{outH}
                        </span>
                        {' px'}
                      </>
                    )}
                    {' · '}
                    {unchanged ? (
                      <span className="font-medium">no change</span>
                    ) : (
                      <span className="font-medium text-primary">{ops.join(' · ')}</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => update(f.id, (r) => ({ ...r, angle: normalize(r.angle - 90) }))}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label={`Rotate ${f.file.name} 90 degrees counter-clockwise`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(f.id, (r) => ({ ...r, angle: normalize(r.angle + 90) }))}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label={`Rotate ${f.file.name} 90 degrees clockwise`}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(f.id, (r) => ({ ...r, flipH: !r.flipH }))}
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-secondary',
                      rot.flipH ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label={`Flip ${f.file.name} horizontally`}
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(f.id, (r) => ({ ...r, flipV: !r.flipV }))}
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-secondary',
                      rot.flipV ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label={`Flip ${f.file.name} vertically`}
                  >
                    <FlipVertical className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update(f.id, () => ({ angle: 0, flipH: false, flipV: false }))
                    }
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label={`Reset ${f.file.name} to original orientation`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(f.id)}
                    className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${f.file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
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

      {/* Privacy hint */}
      <div className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm">
        <RotateCw className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="text-muted-foreground">
          Any image format your browser can read works here — JPG, PNG, WEBP,
          GIF, BMP, AVIF and more. Output keeps each image&apos;s original
          format. Everything rotates locally in your browser; files never
          leave your device.
        </p>
      </div>
    </div>
  )
}
