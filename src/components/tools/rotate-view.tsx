'use client'

import * as React from 'react'
import {
  RotateCw,
  RotateCcw,
  Loader2,
  FileText,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface RotateConfig {
  angle: number
}

interface RotateViewProps {
  file: File
  config: RotateConfig
  onConfigChange: (config: RotateConfig) => void
  onRemoveFile?: () => void
}

export function RotateView({ file, config, onConfigChange, onRemoveFile }: RotateViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 1, 0.8)
  const page = pages[0]

  const rotateLeft = () => {
    const newAngle = (config.angle + 270) % 360
    onConfigChange({ angle: newAngle })
  }

  const rotateRight = () => {
    const newAngle = (config.angle + 90) % 360
    onConfigChange({ angle: newAngle })
  }

  const angleLabel = config.angle === 0 ? 'Original' : `${config.angle}°`

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Loading page preview…</p>
    </div>
  )
  if (error) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
      {error}
    </div>
  )
  if (!page) return null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Rotate all pages in the PDF. Preview updates in real-time.
        </p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">
            {angleLabel}
          </span>
          {onRemoveFile && (
            <Button variant="outline" size="sm" onClick={onRemoveFile} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Change file
            </Button>
          )}
        </div>
      </div>

      {/* Preview + Controls */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        {/* Page preview */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="overflow-hidden rounded-xl border-2 border-border bg-muted shadow-sm">
              <img
                src={page.dataUrl}
                alt="Page 1 preview"
                className="block max-h-[350px] max-w-full transition-transform duration-300"
                style={{ transform: `rotate(${config.angle}deg)` }}
              />
            </div>
            <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-md">
              {config.angle}°
            </span>
          </div>
        </div>

        {/* Rotate controls — card buttons */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Rotate direction</h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Rotate Left */}
            <button
              type="button"
              onClick={rotateLeft}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all',
                'hover:border-primary hover:shadow-md hover:-translate-y-0.5',
                'border-border bg-card'
              )}
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <RotateCcw className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold">Rotate Left</span>
              <span className="text-xs text-muted-foreground">90° counter-clockwise</span>
            </button>

            {/* Rotate Right */}
            <button
              type="button"
              onClick={rotateRight}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all',
                'hover:border-primary hover:shadow-md hover:-translate-y-0.5',
                'border-border bg-card'
              )}
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <RotateCw className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold">Rotate Right</span>
              <span className="text-xs text-muted-foreground">90° clockwise</span>
            </button>
          </div>

          {/* Quick angle presets */}
          <div className="pt-2">
            <p className="mb-2 text-xs text-muted-foreground">Or jump to a specific angle:</p>
            <div className="flex gap-2">
              {[0, 90, 180, 270].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onConfigChange({ angle: a })}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                    config.angle === a
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                  )}
                >
                  {a === 0 ? '0°' : `${a}°`}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-xs text-muted-foreground">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            Rotation applies to <strong>all pages</strong> in the document.
            Current rotation: <strong>{config.angle}°</strong> from original.
          </div>
        </div>
      </div>
    </div>
  )
}
