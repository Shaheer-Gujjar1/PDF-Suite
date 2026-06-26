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
  GripVertical, X, Plus, Loader2, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '@/lib/zip'
import { cn } from '@/lib/utils'

export interface WordFile {
  id: string
  file: File
}

interface WordToPdfViewProps {
  files: WordFile[]
  onReorder: (files: WordFile[]) => void
  onRemove: (id: string) => void
  onAddMore: () => void
}

const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'

let mammothPromise: Promise<any> | null = null
function loadMammoth(): Promise<any> {
  if (mammothPromise) return mammothPromise
  if ((window as any).mammoth) return Promise.resolve((window as any).mammoth)
  mammothPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = MAMMOTH_URL
    script.onload = () => {
      if ((window as any).mammoth) resolve((window as any).mammoth)
      else reject(new Error('mammoth failed to load'))
    }
    script.onerror = () => reject(new Error('Failed to load mammoth'))
    document.head.appendChild(script)
  })
  return mammothPromise
}

interface DocPreview {
  html: string
  loading: boolean
  error: string | null
}

function useDocxPreviews(files: WordFile[]): Map<string, DocPreview> {
  const [previews, setPreviews] = React.useState<Map<string, DocPreview>>(new Map())

  React.useEffect(() => {
    let cancelled = false
    const newPreviews = new Map<string, DocPreview>()
    files.forEach((f) => {
      const existing = previews.get(f.id)
      if (existing) {
        newPreviews.set(f.id, existing)
      } else {
        newPreviews.set(f.id, { html: '', loading: true, error: null })
      }
    })
    setPreviews(new Map(newPreviews))

    ;(async () => {
      try {
        const mammoth = await loadMammoth()
        for (const f of files) {
          if (cancelled) break
          const existing = newPreviews.get(f.id)
          if (existing && !existing.loading) continue
          try {
            const arrayBuffer = await f.file.arrayBuffer()
            const result = await mammoth.convertToHtml({ arrayBuffer })
            if (!cancelled) {
              newPreviews.set(f.id, { html: result.value, loading: false, error: null })
              setPreviews(new Map(newPreviews))
            }
          } catch (e: any) {
            if (!cancelled) {
              newPreviews.set(f.id, { html: '', loading: false, error: e.message || String(e) })
              setPreviews(new Map(newPreviews))
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          files.forEach((f) => {
            newPreviews.set(f.id, { html: '', loading: false, error: 'Failed to load document engine' })
          })
          setPreviews(new Map(newPreviews))
        }
      }
    })()

    return () => { cancelled = true }
  }, [files])

  return previews
}

export function WordToPdfView({ files, onReorder, onRemove, onAddMore }: WordToPdfViewProps) {
  const previews = useDocxPreviews(files)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = files.findIndex((f) => f.id === active.id)
      const newIndex = files.findIndex((f) => f.id === over.id)
      onReorder(arrayMove(files, oldIndex, newIndex))
    }
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((f) => f.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((wf, idx) => {
              const preview = previews.get(wf.id)
              return (
                <SortableWordCard
                  key={wf.id}
                  wf={wf}
                  index={idx}
                  preview={preview}
                  onRemove={onRemove}
                />
              )
            })}

            {/* Add more card */}
            <button
              onClick={onAddMore}
              className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-4 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/[0.03] hover:text-primary"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                <Plus className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">Add more Word files</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>

      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{files.length} Word file{files.length > 1 ? 's' : ''}</span>
          <span className="text-muted-foreground">
            · {formatBytes(files.reduce((acc, f) => acc + f.file.size, 0))} total
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Drag to reorder · Convert in this sequence
        </p>
      </div>
    </div>
  )
}

interface SortableWordCardProps {
  wf: WordFile
  index: number
  preview?: DocPreview
  onRemove: (id: string) => void
}

function SortableWordCard({ wf, index, preview, onRemove }: SortableWordCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: wf.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-xl border bg-card p-2.5 transition-shadow',
        isDragging
          ? 'border-primary shadow-lg shadow-primary/20 z-10'
          : 'border-border hover:border-primary/50 hover:shadow-md'
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
          onClick={() => onRemove(wf.id)}
          className="text-muted-foreground transition-colors hover:text-destructive"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Document preview — looks like a page with rendered HTML content */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-white shadow-inner">
        {preview?.loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          </div>
        ) : preview?.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-2">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-center text-[8px] text-muted-foreground/60">Preview unavailable</p>
          </div>
        ) : preview?.html ? (
          <div
            className="docx-preview h-full overflow-hidden p-2 text-[5px] leading-tight text-gray-800"
            dangerouslySetInnerHTML={{
              __html: preview.html
                .replace(/<h1/g, '<h1 style="font-size:7px;font-weight:bold;margin:2px 0;color:#333"')
                .replace(/<h2/g, '<h2 style="font-size:6px;font-weight:bold;margin:2px 0;color:#333"')
                .replace(/<h3/g, '<h3 style="font-size:5.5px;font-weight:bold;margin:2px 0;color:#333"')
                .replace(/<p/g, '<p style="margin:1px 0"')
                .replace(/<strong/g, '<strong style="font-weight:bold"')
                .replace(/<ul/g, '<ul style="padding-left:8px"')
                .replace(/<ol/g, '<ol style="padding-left:8px"')
                .replace(/<table/g, '<table style="border-collapse:collapse;width:100%"')
                .replace(/<td/g, '<td style="border:0.5px solid #ddd;padding:1px"')
                .replace(/<th/g, '<th style="border:0.5px solid #ddd;padding:1px;font-weight:bold"')
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Filename + size */}
      <div className="mt-2 min-w-0">
        <p className="truncate text-xs font-medium">{wf.file.name}</p>
        <p className="text-[10px] text-muted-foreground">{formatBytes(wf.file.size)}</p>
      </div>
    </div>
  )
}
