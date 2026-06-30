'use client'

import * as React from 'react'
import {
  Loader2, FileImage, X, FileText, ImageIcon,
  CheckSquare, Square, FileDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { loadPdfJs, usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface PdfToImagesConfig {
  mode: 'pages' | 'extract'
  format: 'png' | 'jpg'
  selectedPages: number[]
  selectedImages: number[]
  scale: number
}

interface PdfToImageViewProps {
  file: File
  config: PdfToImagesConfig
  onConfigChange: (config: PdfToImagesConfig) => void
  onRemoveFile?: () => void
}

export function PdfToImageView({ file, config, onConfigChange, onRemoveFile }: PdfToImageViewProps) {
  const { pages, loading: pagesLoading, error: pagesError } = usePdfThumbnails(file, 50, 0.5)
  const [extractedImages, setExtractedImages] = React.useState<{ index: number; dataUrl: string; w: number; h: number }[]>([])
  const [extractLoading, setExtractLoading] = React.useState(false)
  const [extractError, setExtractError] = React.useState<string | null>(null)

  const setConfig = (key: keyof PdfToImagesConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value })
  }

  // When mode switches to 'extract', detect embedded images
  React.useEffect(() => {
    if (config.mode !== 'extract' || extractedImages.length > 0) return
    let cancelled = false
    setExtractLoading(true)
    setExtractError(null)

    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const buf = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        const images: { index: number; dataUrl: string; w: number; h: number }[] = []
        let imgIdx = 0

        for (let p = 1; p <= doc.numPages; p++) {
          if (cancelled) break
          const page = await doc.getPage(p)
          const ops = await page.getOperatorList()
          const OPS = pdfjs.OPS

          for (let i = 0; i < ops.fnArray.length; i++) {
            if (cancelled) break
            const fn = ops.fnArray[i]
            // paintImageXObject, paintInlineImageXObject, paintImageMaskXObject
            if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageRuntimeObject) {
              const args = ops.argsArray[i]
              const imgName = args[0]
              try {
                let imgObj
                if (typeof imgName === 'string') {
                  imgObj = await new Promise((resolve) => page.objs.get(imgName, resolve))
                }
                if (imgObj && imgObj.bitmap) {
                  // Create a canvas from the bitmap
                  const canvas = document.createElement('canvas')
                  canvas.width = imgObj.width || imgObj.bitmap.width
                  canvas.height = imgObj.height || imgObj.bitmap.height
                  const ctx = canvas.getContext('2d')!
                  ctx.drawImage(imgObj.bitmap, 0, 0)
                  images.push({
                    index: imgIdx++,
                    dataUrl: canvas.toDataURL('image/png'),
                    w: canvas.width,
                    h: canvas.height,
                  })
                } else if (imgObj && imgObj.data && imgObj.width) {
                  // Raw image data
                  const canvas = document.createElement('canvas')
                  canvas.width = imgObj.width
                  canvas.height = imgObj.height
                  const ctx = canvas.getContext('2d')!
                  const imgData = ctx.createImageData(imgObj.width, imgObj.height)
                  // Handle RGB vs RGBA
                  if (imgObj.data.length === imgObj.width * imgObj.height * 3) {
                    // RGB → RGBA
                    for (let j = 0; j < imgObj.data.length; j += 3) {
                      imgData.data[j] = imgObj.data[j]
                      imgData.data[j + 1] = imgObj.data[j + 1]
                      imgData.data[j + 2] = imgObj.data[j + 2]
                      imgData.data[j + 3] = 255
                    }
                  } else {
                    imgData.data.set(imgObj.data)
                  }
                  ctx.putImageData(imgData, 0, 0)
                  images.push({
                    index: imgIdx++,
                    dataUrl: canvas.toDataURL('image/png'),
                    w: canvas.width,
                    h: canvas.height,
                  })
                }
              } catch (_) {}
            }
          }
          try { await page.cleanup() } catch (_) {}
        }
        try { await doc.destroy() } catch (_) {}

        if (!cancelled) {
          setExtractedImages(images)
          setExtractLoading(false)
          // Auto-select all extracted images
          if (images.length > 0) {
            onConfigChange({ ...config, selectedImages: images.map((img) => img.index) })
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setExtractError(e.message || String(e))
          setExtractLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [config.mode, file])

  // Auto-select all pages when pages load (first time)
  React.useEffect(() => {
    if (pages.length > 0 && config.selectedPages.length === 0 && config.mode === 'pages') {
      onConfigChange({ ...config, selectedPages: pages.map((p) => p.pageNum) })
    }
  }, [pages, config.selectedPages.length, config.mode])

  const togglePage = (pageNum: number) => {
    const current = config.selectedPages
    const next = current.includes(pageNum)
      ? current.filter((p) => p !== pageNum)
      : [...current, pageNum].sort((a, b) => a - b)
    setConfig('selectedPages', next)
  }

  const toggleImage = (imgIdx: number) => {
    const current = config.selectedImages
    const next = current.includes(imgIdx)
      ? current.filter((i) => i !== imgIdx)
      : [...current, imgIdx].sort((a, b) => a - b)
    setConfig('selectedImages', next)
  }

  const selectAllPages = () => setConfig('selectedPages', pages.map((p) => p.pageNum))
  const deselectAllPages = () => setConfig('selectedPages', [])
  const selectAllImages = () => setConfig('selectedImages', extractedImages.map((img) => img.index))
  const deselectAllImages = () => setConfig('selectedImages', [])

  const loading = config.mode === 'pages' ? pagesLoading : extractLoading
  const error = config.mode === 'pages' ? pagesError : extractError
  const selectedCount = config.mode === 'pages' ? config.selectedPages.length : config.selectedImages.length

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">
        {config.mode === 'pages' ? 'Rendering page previews…' : 'Detecting embedded images…'}
      </p>
    </div>
  )
  if (error) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
      {error}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {config.mode === 'pages'
            ? 'Select pages to convert to images.'
            : 'Images embedded in the PDF are shown below. Select which to extract.'}
        </p>
        {onRemoveFile && (
          <Button variant="outline" size="sm" onClick={onRemoveFile} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Change file
          </Button>
        )}
      </div>

      {/* Mode toggle + format + resolution */}
      <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Mode */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Mode</Label>
            <RadioGroup
              value={config.mode}
              onValueChange={(v) => {
                if (v === 'extract') {
                  setExtractedImages([])
                }
                onConfigChange({ ...config, mode: v as 'pages' | 'extract' })
              }}
              className="grid grid-cols-1 gap-1"
            >
              <Label htmlFor="r-pages" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="pages" id="r-pages" className="h-3 w-3" />
                <FileText className="h-3.5 w-3.5" /> Convert pages
              </Label>
              <Label htmlFor="r-extract" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="extract" id="r-extract" className="h-3 w-3" />
                <ImageIcon className="h-3.5 w-3.5" /> Extract images
              </Label>
            </RadioGroup>
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Image format</Label>
            <RadioGroup
              value={config.format}
              onValueChange={(v) => setConfig('format', v)}
              className="grid grid-cols-2 gap-1"
            >
              <Label htmlFor="r-png" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="png" id="r-png" className="h-3 w-3" />
                PNG
              </Label>
              <Label htmlFor="r-jpg" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="jpg" id="r-jpg" className="h-3 w-3" />
                JPG
              </Label>
            </RadioGroup>
          </div>

          {/* Resolution (pages mode only) */}
          {config.mode === 'pages' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Resolution: {config.scale}×</Label>
              <RadioGroup
                value={String(config.scale)}
                onValueChange={(v) => setConfig('scale', Number(v))}
                className="grid grid-cols-3 gap-1"
              >
                <Label htmlFor="r-1x" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="1" id="r-1x" className="h-3 w-3" /> 1×
                </Label>
                <Label htmlFor="r-2x" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="2" id="r-2x" className="h-3 w-3" /> 2×
                </Label>
                <Label htmlFor="r-3x" className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <RadioGroupItem value="3" id="r-3x" className="h-3 w-3" /> 3×
                </Label>
              </RadioGroup>
            </div>
          )}
        </div>
      </div>

      {/* Selection bar */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary">
          {selectedCount} selected
        </Badge>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={config.mode === 'pages' ? selectAllPages : selectAllImages}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={config.mode === 'pages' ? deselectAllPages : deselectAllImages}>
            Deselect all
          </Button>
        </div>
      </div>

      {/* Previews grid */}
      {config.mode === 'pages' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {pages.map((page) => {
            const isSelected = config.selectedPages.includes(page.pageNum)
            return (
              <button
                key={page.pageNum}
                onClick={() => togglePage(page.pageNum)}
                className={cn(
                  'group relative rounded-xl border-2 bg-card p-2 transition-all',
                  isSelected
                    ? 'border-primary ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
                  <img src={page.dataUrl} alt={`Page ${page.pageNum}`} className="h-full w-full object-contain" />
                  {/* Selection checkbox */}
                  <span className={cn(
                    'absolute left-1 top-1 grid h-5 w-5 place-items-center rounded border-2 transition-all',
                    isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/80 bg-black/40'
                  )}>
                    {isSelected && (
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {page.pageNum}
                  </span>
                </div>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">Page {page.pageNum}</p>
              </button>
            )
          })}
        </div>
      ) : (
        <div>
          {extractedImages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No embedded images detected in this PDF.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {extractedImages.map((img) => {
                const isSelected = config.selectedImages.includes(img.index)
                return (
                  <button
                    key={img.index}
                    onClick={() => toggleImage(img.index)}
                    className={cn(
                      'group relative rounded-xl border-2 bg-card p-2 transition-all',
                      isSelected
                        ? 'border-primary ring-1 ring-primary/20'
                        : 'border-border hover:border-primary/40'
                    )}
                  >
                    <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                      <img src={img.dataUrl} alt={`Image ${img.index + 1}`} className="h-full w-full object-contain" />
                      <span className={cn(
                        'absolute left-1 top-1 grid h-5 w-5 place-items-center rounded border-2 transition-all',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/80 bg-black/40'
                      )}>
                        {isSelected && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {img.w}×{img.h}
                      </span>
                    </div>
                    <p className="mt-1 text-center text-[10px] text-muted-foreground">Image {img.index + 1}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
