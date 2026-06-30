'use client'

import * as React from 'react'
import {
  Loader2, X, FileCode2, Link2, RectangleVertical, RectangleHorizontal,
  Maximize, FileText, Monitor, Tablet, Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export interface HtmlToPdfConfig {
  source: 'file' | 'url' | 'paste'
  html: string
  url: string
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
  const [fetching, setFetching] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)

  const set = (key: keyof HtmlToPdfConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value })
  }

  const fetchUrl = async () => {
    if (!config.url.trim()) return
    setFetching(true)
    setFetchError(null)

    // Normalize URL — add https:// if missing
    let url = config.url.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    // Validate URL
    try { new URL(url) } catch {
      setFetchError('Invalid URL. Please enter a valid website address.')
      setFetching(false)
      return
    }

    // Try multiple CORS proxies in sequence — public proxies can be unreliable
    const proxies = [
      (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    ]

    let html: string | null = null
    let lastError = ''

    for (let i = 0; i < proxies.length; i++) {
      try {
        const proxyUrl = proxies[i](url)
        const res = await fetch(proxyUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/html,*/*' },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) { lastError = `Proxy ${i + 1} returned status ${res.status}`; continue }
        const text = await res.text()
        if (!text || text.length < 50) { lastError = `Proxy ${i + 1} returned empty content`; continue }
        html = text
        break
      } catch (e: any) {
        lastError = `Proxy ${i + 1}: ${e.message || e.name || 'error'}`
        continue
      }
    }

    if (html) {
      console.log('[html-to-pdf] Fetched HTML:', html.length, 'chars')
      // Fix relative URLs by adding a <base> tag
      const baseUrl = new URL(url).origin
      const fixedHtml = html.includes('<base')
        ? html
        : html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}">`)
      onConfigChange({ ...config, html: fixedHtml, source: 'url' })
      setFetchError(null)
    } else {
      setFetchError(
        `Could not fetch the URL after trying ${proxies.length} proxies. ` +
        `Last error: ${lastError}. ` +
        `This may happen if the site blocks automated requests or all proxies are down. ` +
        `Try again, or copy the page's HTML source and use "Paste HTML code" instead.`
      )
    }
    setFetching(false)
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

  const hasContent = config.html.trim().length > 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {hasContent
            ? 'Content loaded — configure options below and run.'
            : 'Upload an HTML file, paste HTML code, or enter a website URL.'}
        </p>
        {onRemoveFile && hasContent && (
          <Button variant="outline" size="sm" onClick={onRemoveFile} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Source tabs */}
      {!hasContent && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Upload file */}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-5 transition-all hover:border-primary/50 hover:bg-primary/[0.03]">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <FileCode2 className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">Upload HTML file</span>
            <span className="text-xs text-muted-foreground">.html, .htm</span>
            <input
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) {
                  const text = await file.text()
                  set('html', text)
                  set('source', 'file')
                }
                e.target.value = ''
              }}
            />
          </label>

          {/* URL fetch */}
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Link2 className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">From URL</span>
            <div className="flex w-full gap-1">
              <Input
                value={config.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://example.com"
                className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') fetchUrl() }}
              />
              <Button size="sm" className="h-8 px-2" onClick={fetchUrl} disabled={fetching || !config.url.trim()}>
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Go'}
              </Button>
            </div>
            {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}
          </div>

          {/* Paste HTML */}
          <button
            onClick={() => set('source', 'paste')}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-5 transition-all hover:border-primary/50 hover:bg-primary/[0.03]"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium">Paste HTML code</span>
            <span className="text-xs text-muted-foreground">Write or paste markup</span>
          </button>
        </div>
      )}

      {/* Paste HTML textarea */}
      {!hasContent && config.source === 'paste' && (
        <div className="space-y-2">
          <Label>HTML Code</Label>
          <textarea
            value={config.html}
            onChange={(e) => set('html', e.target.value)}
            placeholder={'<!DOCTYPE html>\n<html>\n<head><title>My Page</title></head>\n<body>\n  <h1>Hello PDF!</h1>\n  <p>This will be rendered into a PDF.</p>\n</body>\n</html>'}
            className="min-h-[200px] w-full resize-y rounded-xl border border-border bg-card p-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <Button size="sm" onClick={() => set('source', 'paste')} disabled={!config.html.trim()}>
            Use this HTML
          </Button>
        </div>
      )}

      {/* Options bar (shown when content is loaded) */}
      {hasContent && (
        <>
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

              {/* Screen width (for URL source) */}
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
                {config.onePage
                  ? 'The entire page becomes one tall PDF page'
                  : 'Content is split into standard A4/Letter pages'}
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
