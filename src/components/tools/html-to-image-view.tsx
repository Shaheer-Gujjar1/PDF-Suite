'use client'

import * as React from 'react'
import {
  X, FileCode2, FileText, Upload, ImageIcon, Monitor, Tablet, Smartphone, Paintbrush,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export type HtmlImageFormat = 'png' | 'jpeg' | 'webp'

export interface HtmlToImageConfig {
  html: string
  /** Original file name when the HTML came from an upload ('' for pasted). */
  sourceName: string
  format: HtmlImageFormat
  /** 0.5–1 — JPEG/WebP encoding quality. */
  quality: number
  screenWidth: 'desktop' | 'tablet' | 'mobile'
  /** Resolution multiplier: 1x, 2x or 3x. */
  scale: 1 | 2 | 3
  /** Transparent is only available for PNG/WebP (JPEG flattens to white). */
  background: 'transparent' | 'white'
}

interface HtmlToImageViewProps {
  config: HtmlToImageConfig
  onConfigChange: (config: HtmlToImageConfig) => void
}

const SCREEN_WIDTHS: Record<HtmlToImageConfig['screenWidth'], number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
}

const FORMAT_META: Record<HtmlImageFormat, { label: string; ext: string }> = {
  png: { label: 'PNG', ext: 'png' },
  jpeg: { label: 'JPG', ext: 'jpg' },
  webp: { label: 'WebP', ext: 'webp' },
}

export function HtmlToImageView({ config, onConfigChange }: HtmlToImageViewProps) {
  const [tab, setTab] = React.useState<'paste' | 'upload'>('paste')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const hasContent = config.html.trim().length > 0

  const set = (key: keyof HtmlToImageConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    onConfigChange({ ...config, html: text, sourceName: file.name })
    e.target.value = ''
  }

  const clearContent = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    onConfigChange({ ...config, html: '', sourceName: '' })
  }

  // JPEG has no alpha channel — transparent background is PNG/WebP only.
  const transparentAllowed = config.format !== 'jpeg'
  const effectiveBackground = transparentAllowed ? config.background : 'white'

  const screenW = SCREEN_WIDTHS[config.screenWidth]

  // Live preview: scale the chosen render width into a fixed-size viewport.
  const previewData = React.useMemo(() => {
    const MAX_W = 480
    const k = Math.min(1, MAX_W / screenW)
    return { k, boxW: Math.round(screenW * k), boxH: 300 }
  }, [screenW])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {hasContent
            ? config.sourceName
              ? `Loaded ${config.sourceName} — pick your output settings below, then run.`
              : 'HTML code pasted — pick your output settings below, then run.'
            : 'Paste your HTML code or upload an .html file — use the tabs to switch.'}
        </p>
        {hasContent && (
          <Button variant="outline" size="sm" onClick={clearContent} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Input tabs — always visible so either source can be swapped in */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('paste')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
              tab === 'paste' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
            )}
          >
            <FileText className="h-4 w-4" /> Paste code
          </button>
          <button
            onClick={() => setTab('upload')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
              tab === 'upload' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
            )}
          >
            <Upload className="h-4 w-4" /> Upload file
          </button>
        </div>

        {/* Paste tab */}
        {tab === 'paste' && (
          <div className="space-y-2">
            <textarea
              value={config.html}
              onChange={(e) => onConfigChange({ ...config, html: e.target.value, sourceName: '' })}
              placeholder={'<!DOCTYPE html>\n<html>\n<head><style>\n  body { font-family: sans-serif; background: #0f172a; color: white; }\n</style></head>\n<body>\n  <h1>Hello Image!</h1>\n  <p>This will be rendered into a PNG.</p>\n</body>\n</html>'}
              className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-card p-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground">
              Full documents and snippets both work — options appear automatically once content is detected.
            </p>
          </div>
        )}

        {/* Upload tab */}
        {tab === 'upload' && (
          <div className="space-y-2">
            <label className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card p-6 transition-all hover:border-primary/50 hover:bg-primary/[0.03]">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <FileCode2 className="h-7 w-7" />
              </span>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {config.sourceName ? `Replace ${config.sourceName}` : 'Click to upload HTML file'}
                </p>
                <p className="text-xs text-muted-foreground">.html, .htm files supported — nothing is uploaded, reading happens locally</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
            {config.sourceName && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileCode2 className="h-3.5 w-3.5 text-primary" />
                Currently using <span className="font-medium text-foreground">{config.sourceName}</span>
                ({config.html.length.toLocaleString()} chars)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Options + preview — shown when content exists */}
      {hasContent && (
        <>
          {/* Live preview — reflects the chosen render width + background */}
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Live Preview</p>
              <span className="text-xs text-muted-foreground">
                {screenW}px render width · {effectiveBackground === 'transparent' ? 'transparent' : 'white'} background
              </span>
            </div>
            <div className="flex justify-center">
              <div
                className="relative overflow-hidden shadow-md ring-1 ring-black/10"
                style={{
                  width: previewData.boxW,
                  height: previewData.boxH,
                  backgroundColor: '#ffffff',
                  backgroundImage:
                    effectiveBackground === 'transparent'
                      ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)'
                      : undefined,
                  backgroundSize: effectiveBackground === 'transparent' ? '16px 16px' : undefined,
                }}
              >
                <iframe
                  srcDoc={config.html}
                  title="HTML Preview"
                  className="border-0"
                  style={{
                    width: screenW,
                    height: previewData.boxH / previewData.k,
                    transform: `scale(${previewData.k})`,
                    transformOrigin: 'top left',
                  }}
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Output format */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Format</Label>
                <div className="grid grid-cols-3 gap-1">
                  {(Object.keys(FORMAT_META) as HtmlImageFormat[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => set('format', f)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-xs font-medium transition-all',
                        config.format === f
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {FORMAT_META[f].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality (JPEG/WebP only) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {config.format === 'png' ? 'Quality — PNG is lossless' : `Quality: ${Math.round(config.quality * 100)}%`}
                </Label>
                <Slider
                  value={[Math.round(config.quality * 100)]}
                  min={50}
                  max={100}
                  step={1}
                  disabled={config.format === 'png'}
                  onValueChange={(v) => set('quality', v[0] / 100)}
                  className={cn('mt-2.5', config.format === 'png' && 'opacity-40')}
                />
              </div>

              {/* Render width */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Render width</Label>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'desktop', icon: Monitor, label: '1280' },
                      { id: 'tablet', icon: Tablet, label: '768' },
                      { id: 'mobile', icon: Smartphone, label: '375' },
                    ] as const
                  ).map((w) => (
                    <button
                      key={w.id}
                      onClick={() => set('screenWidth', w.id)}
                      title={`${w.label}px`}
                      className={cn(
                        'flex items-center justify-center rounded-lg border px-2 py-2 transition-all',
                        config.screenWidth === w.id
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      <w.icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Scale</Label>
                <div className="grid grid-cols-3 gap-1">
                  {([1, 2, 3] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => set('scale', s)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-xs font-medium transition-all',
                        config.scale === s
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Background */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Paintbrush className="h-3.5 w-3.5" /> Background
              </span>
              <button
                onClick={() => transparentAllowed && set('background', 'transparent')}
                disabled={!transparentAllowed}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all',
                  effectiveBackground === 'transparent'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40',
                  !transparentAllowed && 'cursor-not-allowed opacity-40 hover:border-border'
                )}
              >
                <span
                  className="h-3 w-3 rounded-sm border border-border"
                  style={{
                    backgroundImage: 'repeating-conic-gradient(#94a3b8 0% 25%, #ffffff 0% 50%)',
                    backgroundSize: '6px 6px',
                  }}
                />
                Transparent {!transparentAllowed && '(JPG only flattens to white)'}
              </button>
              <button
                onClick={() => set('background', 'white')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all',
                  effectiveBackground === 'white'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                )}
              >
                <span className="h-3 w-3 rounded-sm border border-border bg-white" />
                White
              </button>
            </div>

            {/* Output summary */}
            <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Output: {screenW * config.scale}px wide {FORMAT_META[config.format].label} image
              {config.format !== 'png' && ` at ${Math.round(config.quality * 100)}% quality`}
              {effectiveBackground === 'transparent' ? ' with transparency' : ''} — the height follows your content.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
