'use client'

import * as React from 'react'
import {
  Loader2, X, FileCode2, RectangleVertical, RectangleHorizontal,
  Maximize, FileText, Monitor, Tablet, Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export interface HtmlToPdfConfig {
  html: string
  orientation: 'portrait' | 'landscape'
  pageSize: 'a4' | 'letter'
  screenWidth: 'desktop' | 'tablet' | 'mobile'
  onePage: boolean
  margin: number
}

interface HtmlToPdfViewProps {
  config: HtmlToPdfConfig
  onConfigChange: (config: HtmlToPdfConfig) => void
  onRemoveFile?: () => void
}

const PAGE_DIMS: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

const SCREEN_WIDTHS: Record<string, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
}

export function HtmlToPdfView({ config, onConfigChange, onRemoveFile }: HtmlToPdfViewProps) {
  const [mode, setMode] = React.useState<'upload' | 'paste'>('upload')
  const [fileName, setFileName] = React.useState<string>('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const hasContent = config.html.trim().length > 0

  const set = (key: keyof HtmlToPdfConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setFileName(file.name)
    onConfigChange({ ...config, html: text })
    e.target.value = ''
  }

  const clearContent = () => {
    setFileName('')
    onConfigChange({ ...config, html: '' })
    onRemoveFile?.()
  }

  // Calculate page preview dimensions
  const previewData = React.useMemo(() => {
    const [pw, ph] = PAGE_DIMS[config.pageSize] || PAGE_DIMS.a4
    const isPortrait = config.orientation === 'portrait'
    const realW = isPortrait ? Math.min(pw, ph) : Math.max(pw, ph)
    const realH = isPortrait ? Math.max(pw, ph) : Math.min(pw, ph)
    const MAX_H = 120
    const scale = MAX_H / realH
    const w = realW * scale
    const h = realH * scale
    const marginPx = config.margin * scale
    const label = `${config.pageSize === 'a4' ? 'A4' : 'Letter'} · ${config.orientation}`
    return { w, h, label, marginPx, realW, realH }
  }, [config.pageSize, config.orientation, config.margin])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {hasContent
            ? `Content loaded${fileName ? ` from ${fileName}` : ''} — configure options and run.`
            : 'Upload an HTML file or paste HTML code below.'}
        </p>
        {hasContent && (
          <Button variant="outline" size="sm" onClick={clearContent} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Input area — shown when no content */}
      {!hasContent && (
        <div className="space-y-3">
          {/* Mode tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('upload')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
                mode === 'upload' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
              )}
            >
              <FileCode2 className="h-4 w-4" /> Upload file
            </button>
            <button
              onClick={() => setMode('paste')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all',
                mode === 'paste' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
              )}
            >
              <FileText className="h-4 w-4" /> Paste code
            </button>
          </div>

          {/* Upload mode */}
          {mode === 'upload' && (
            <label className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card p-6 transition-all hover:border-primary/50 hover:bg-primary/[0.03]">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <FileCode2 className="h-7 w-7" />
              </span>
              <div className="text-center">
                <p className="text-sm font-medium">Click to upload HTML file</p>
                <p className="text-xs text-muted-foreground">.html, .htm files supported</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          )}

          {/* Paste mode */}
          {mode === 'paste' && (
            <div className="space-y-2">
              <textarea
                value={config.html}
                onChange={(e) => {
                  console.log('[html-to-pdf-view] textarea onChange, value length:', e.target.value.length)
                  onConfigChange({ ...config, html: e.target.value })
                }}
                placeholder={'<!DOCTYPE html>\n<html>\n<head><title>My Page</title></head>\n<body>\n  <h1>Hello PDF!</h1>\n  <p>This will be rendered into a PDF.</p>\n</body>\n</html>'}
                className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-card p-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground">
                Type or paste HTML — options appear automatically when content is detected.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Options + preview — shown when content exists */}
      {hasContent && (
        <>
          {/* Live HTML preview — reflects render width, orientation, margin */}
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Live Preview</p>
              <span className="text-xs text-muted-foreground">
                {SCREEN_WIDTHS[config.screenWidth]}px · {config.orientation} · {config.pageSize === 'a4' ? 'A4' : 'Letter'} · {config.margin}pt margin
              </span>
            </div>
            {/* Page frame — shows orientation + page proportions */}
            <div className="flex justify-center">
              <div
                className="relative bg-white shadow-md ring-1 ring-black/5 transition-all duration-300"
                style={{
                  width: previewData.w * 3, // Scale up for visibility
                  height: config.onePage ? 'auto' : previewData.h * 3,
                  minHeight: previewData.h * 3,
                }}
              >
                {/* Margin indicator */}
                {config.margin > 0 && (
                  <div
                    className="absolute border border-dashed border-primary/20 pointer-events-none"
                    style={{
                      top: previewData.marginPx * 3,
                      right: previewData.marginPx * 3,
                      bottom: previewData.marginPx * 3,
                      left: previewData.marginPx * 3,
                    }}
                  />
                )}
                {/* HTML content rendered at the selected screen width */}
                <div
                  className="absolute overflow-hidden"
                  style={{
                    top: previewData.marginPx * 3 || 4,
                    right: previewData.marginPx * 3 || 4,
                    bottom: previewData.marginPx * 3 || 4,
                    left: previewData.marginPx * 3 || 4,
                  }}
                >
                  <iframe
                    srcDoc={config.html}
                    title="HTML Preview"
                    className="border-0"
                    style={{
                      width: SCREEN_WIDTHS[config.screenWidth],
                      height: '100%',
                      transform: `scale(${(previewData.w * 3 - (previewData.marginPx * 3 || 4) * 2) / SCREEN_WIDTHS[config.screenWidth]})`,
                      transformOrigin: 'top left',
                    }}
                    sandbox="allow-same-origin"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Orientation */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Orientation</Label>
                <RadioGroup
                  value={config.orientation}
                  onValueChange={(v) => set('orientation', v)}
                  className="grid grid-cols-2 gap-1"
                >
                  <Label htmlFor="r-port" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value="portrait" id="r-port" className="h-3 w-3" />
                    <RectangleVertical className="h-3.5 w-3.5" /> Portrait
                  </Label>
                  <Label htmlFor="r-land" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value="landscape" id="r-land" className="h-3 w-3" />
                    <RectangleHorizontal className="h-3.5 w-3.5" /> Landscape
                  </Label>
                </RadioGroup>
              </div>

              {/* Page size */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Page size</Label>
                <Select value={config.pageSize} onValueChange={(v) => set('pageSize', v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="letter">US Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Render width */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Render width</Label>
                <RadioGroup
                  value={config.screenWidth}
                  onValueChange={(v) => set('screenWidth', v)}
                  className="grid grid-cols-3 gap-1"
                >
                  <Label htmlFor="r-dt" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value="desktop" id="r-dt" className="sr-only" />
                    <Monitor className="h-3.5 w-3.5" />
                  </Label>
                  <Label htmlFor="r-tb" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value="tablet" id="r-tb" className="sr-only" />
                    <Tablet className="h-3.5 w-3.5" />
                  </Label>
                  <Label htmlFor="r-mb" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value="mobile" id="r-mb" className="sr-only" />
                    <Smartphone className="h-3.5 w-3.5" />
                  </Label>
                </RadioGroup>
              </div>

              {/* Margin */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Margin: {config.margin}pt</Label>
                <Slider
                  value={[config.margin]}
                  min={0}
                  max={72}
                  step={6}
                  onValueChange={(v) => set('margin', v[0])}
                  className="mt-2"
                />
              </div>
            </div>

            {/* One-page toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => set('onePage', !config.onePage)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all',
                  config.onePage
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                )}
              >
                <Maximize className="h-3.5 w-3.5" />
                {config.onePage ? 'One long page (no splitting)' : 'Split into A4 pages'}
              </button>
              <span className="text-xs text-muted-foreground">
                {config.onePage ? 'Entire page becomes one tall PDF' : 'Content split into standard pages'}
              </span>
            </div>
          </div>

          {/* Page layout preview */}
          <div className="flex items-center justify-center gap-4 rounded-lg border border-border/60 bg-secondary/30 p-4">
            <div
              className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/5 transition-all duration-300"
              style={{ width: previewData.w, height: config.onePage ? previewData.h * 1.5 : previewData.h }}
            >
              {config.margin > 0 && (
                <div
                  className="absolute border border-dashed border-primary/30"
                  style={{ top: previewData.marginPx, right: previewData.marginPx, bottom: previewData.marginPx, left: previewData.marginPx }}
                />
              )}
              <div className="absolute flex items-center justify-center" style={{ top: previewData.marginPx || 2, right: previewData.marginPx || 2, bottom: previewData.marginPx || 2, left: previewData.marginPx || 2 }}>
                <FileText className="h-5 w-5 text-primary/20" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{previewData.label}</span>
              {config.margin > 0 && <span className="text-xs text-muted-foreground">{config.margin}pt margin</span>}
              <span className="text-xs text-muted-foreground">{SCREEN_WIDTHS[config.screenWidth]}px render width</span>
              <span className="text-xs text-muted-foreground">{config.onePage ? 'Single long page' : 'Multiple pages'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
