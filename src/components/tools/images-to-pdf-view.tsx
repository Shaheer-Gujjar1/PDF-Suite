'use client'

import * as React from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  RotateCw, GripVertical, X, Plus, Loader2,
  RectangleVertical, RectangleHorizontal, Maximize,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface ImagesToPdfPage {
  id: string
  file: File
  rotation: number
  selected: boolean
}

export interface ImagesToPdfConfig {
  pages: { id: string; rotation: number }[]
  orientation: 'portrait' | 'landscape'
  pageSize: 'fit' | 'a4' | 'letter'
  margin: number
  output: 'single' | 'multiple' | 'mixed'
  selectedIds: string[]
}

interface ImagesToPdfViewProps {
  files: { id: string; file: File }[]
  config: ImagesToPdfConfig
  onConfigChange: (config: ImagesToPdfConfig) => void
  onRemove: (id: string) => void
  onAddMore: () => void
}

const PAGE_DIMS: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
}

export function ImagesToPdfView({ files, config, onConfigChange, onRemove, onAddMore }: ImagesToPdfViewProps) {
  // Build the page list from files + config state
  const [pages, setPages] = React.useState<ImagesToPdfPage[]>([])
  const [previewUrls, setPreviewUrls] = React.useState<Map<string, string>>(new Map())

  // Sync pages when files change
  React.useEffect(() => {
    setPages((prev) => {
      const fileIds = new Set(files.map((f) => f.id))
      // Keep existing pages that still have files, add new ones
      const kept = prev.filter((p) => fileIds.has(p.id))
      const existingIds = new Set(kept.map((p) => p.id))
      const newPages = files
        .filter((f) => !existingIds.has(f.id))
        .map((f) => ({ id: f.id, file: f.file, rotation: 0, selected: false }))
      return [...kept, ...newPages]
    })
  }, [files])

  // Create/cleanup preview URLs
  React.useEffect(() => {
    const newUrls = new Map<string, string>()
    pages.forEach((p) => {
      const url = URL.createObjectURL(p.file)
      newUrls.set(p.id, url)
    })
    setPreviewUrls(newUrls)
    return () => {
      newUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [pages])

  // Emit config whenever pages or settings change (guard against infinite loops)
  const lastEmit = React.useRef<string>('')
  React.useEffect(() => {
    const newConfig = {
      pages: pages.map((p) => ({ id: p.id, rotation: p.rotation })),
      orientation: config.orientation,
      pageSize: config.pageSize,
      margin: config.margin,
      output: config.output,
      selectedIds: pages.filter((p) => p.selected).map((p) => p.id),
    }
    const sig = JSON.stringify(newConfig)
    if (sig !== lastEmit.current) {
      lastEmit.current = sig
      onConfigChange(newConfig)
    }
  }, [pages, config.orientation, config.pageSize, config.margin, config.output, onConfigChange])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setPages((prev) => {
        const oldIndex = prev.findIndex((p) => p.id === active.id)
        const newIndex = prev.findIndex((p) => p.id === over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }

  const rotate = (id: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p)))
  }

  const toggleSelect = (id: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)))
  }

  const remove = (id: string) => {
    onRemove(id)
  }

  const setConfig = (key: keyof ImagesToPdfConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value })
  }

  const selectedCount = pages.filter((p) => p.selected).length
  const pageCount = pages.length

  // Page preview dimensions for the layout preview
  const previewDims = React.useMemo(() => {
    if (config.pageSize === 'fit') return { w: 120, h: 80, label: 'Fit to image' }
    const [pw, ph] = PAGE_DIMS[config.pageSize] || PAGE_DIMS.a4
    const isPortrait = config.orientation === 'portrait'
    const w = isPortrait ? Math.min(pw, ph) : Math.max(pw, ph)
    const h = isPortrait ? Math.max(pw, ph) : Math.min(pw, ph)
    const scale = 120 / Math.max(w, h)
    return { w: w * scale, h: h * scale, label: `${config.pageSize.toUpperCase()} ${config.orientation}` }
  }, [config.pageSize, config.orientation])

  return (
    <div className="space-y-5">
      {/* Options bar */}
      <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Orientation */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Orientation</Label>
            <RadioGroup
              value={config.orientation}
              onValueChange={(v) => setConfig('orientation', v)}
              className="grid grid-cols-2 gap-1"
            >
              <Label htmlFor="r-portrait" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="portrait" id="r-portrait" className="h-3 w-3" />
                <RectangleVertical className="h-3.5 w-3.5" /> Portrait
              </Label>
              <Label htmlFor="r-landscape" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="landscape" id="r-landscape" className="h-3 w-3" />
                <RectangleHorizontal className="h-3.5 w-3.5" /> Landscape
              </Label>
            </RadioGroup>
          </div>

          {/* Page size */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Page size</Label>
            <Select value={config.pageSize} onValueChange={(v) => setConfig('pageSize', v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fit">Fit to image</SelectItem>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="letter">US Letter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Margin */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Margin: {config.margin}pt</Label>
            <Slider
              value={[config.margin]}
              min={0}
              max={72}
              step={6}
              onValueChange={(v) => setConfig('margin', v[0])}
              className="mt-2"
            />
          </div>

          {/* Output mode */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Output</Label>
            <Select value={config.output} onValueChange={(v) => setConfig('output', v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single PDF (all images)</SelectItem>
                <SelectItem value="multiple">Separate PDFs (one per image)</SelectItem>
                <SelectItem value="mixed">Mixed (selected → 1 PDF, rest → separate)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Page layout preview */}
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
          <span className="text-xs font-medium text-muted-foreground">Page preview:</span>
          <div className="flex items-center gap-2">
            <div
              className="relative rounded border-2 border-primary/40 bg-white shadow-sm"
              style={{ width: previewDims.w, height: previewDims.h }}
            >
              {/* Margin indicator */}
              {config.margin > 0 && config.pageSize !== 'fit' && (
                <div
                  className="absolute border border-dashed border-primary/30"
                  style={{
                    inset: `${(config.margin / 72) * 20}px`,
                  }}
                />
              )}
              {/* Image placeholder */}
              <div className="absolute inset-2 flex items-center justify-center">
                <Maximize className="h-4 w-4 text-primary/30" />
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{previewDims.label}</span>
          </div>
        </div>
      </div>

      {/* Mixed mode hint */}
      {config.output === 'mixed' && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          <span className="font-medium text-amber-600 dark:text-amber-400">Mixed mode:</span>
          Click the checkbox on each image to select it. Selected images go into one PDF; the rest become individual PDFs.
          <Badge variant="secondary" className="ml-auto">{selectedCount} selected</Badge>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pageCount} image{pageCount > 1 ? 's' : ''} · Drag to reorder · Click rotate or remove
        </p>
      </div>

      {/* Image grid with drag-reorder */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {pages.map((page, idx) => (
              <SortableImageCard
                key={page.id}
                page={page}
                index={idx}
                previewUrl={previewUrls.get(page.id)}
                showSelect={config.output === 'mixed'}
                onRotate={rotate}
                onRemove={remove}
                onToggleSelect={toggleSelect}
              />
            ))}

            {/* Add more card */}
            <button
              onClick={onAddMore}
              className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-4 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/[0.03] hover:text-primary"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                <Plus className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">Add more images</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface SortableImageCardProps {
  page: ImagesToPdfPage
  index: number
  previewUrl?: string
  showSelect: boolean
  onRotate: (id: string) => void
  onRemove: (id: string) => void
  onToggleSelect: (id: string) => void
}

function SortableImageCard({ page, index, previewUrl, showSelect, onRotate, onRemove, onToggleSelect }: SortableImageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-xl border bg-card p-2.5 transition-shadow',
        isDragging ? 'border-primary shadow-lg shadow-primary/20 z-10' : 'border-border hover:border-primary/50 hover:shadow-md',
        page.selected && 'ring-2 ring-primary/30'
      )}
    >
      {/* Top bar */}
      <div className="mb-2 flex items-center justify-between">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {index + 1}
        </span>
        <button
          onClick={() => onRemove(page.id)}
          className="text-muted-foreground transition-colors hover:text-destructive"
          aria-label="Remove image"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Image preview */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={page.file.name}
            className="h-full w-full object-contain transition-transform duration-300"
            style={{ transform: `rotate(${page.rotation}deg)` }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          </div>
        )}
        {/* Rotation badge */}
        {page.rotation > 0 && (
          <span className="absolute right-1 top-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            {page.rotation}°
          </span>
        )}
        {/* Select checkbox (mixed mode) */}
        {showSelect && (
          <button
            onClick={() => onToggleSelect(page.id)}
            className={cn(
              'absolute left-1 top-1 grid h-5 w-5 place-items-center rounded border-2 transition-all',
              page.selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white/80 bg-black/40 hover:border-primary'
            )}
            aria-label={page.selected ? 'Deselect' : 'Select'}
          >
            {page.selected && (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Filename + actions */}
      <div className="mt-2 min-w-0">
        <p className="truncate text-xs font-medium">{page.file.name}</p>
        <div className="mt-1.5 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 gap-1 px-1 text-xs"
            onClick={() => onRotate(page.id)}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Rotate
          </Button>
        </div>
      </div>
    </div>
  )
}
