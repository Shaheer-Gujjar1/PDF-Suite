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
import { GripVertical, X, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { usePdfFirstPages } from '@/hooks/use-pdf'
import { formatBytes } from '@/lib/zip'
import { cn } from '@/lib/utils'

export interface PdfFile {
  id: string
  file: File
}

interface PdfToWordViewProps {
  files: PdfFile[]
  onReorder: (files: PdfFile[]) => void
  onRemove: (id: string) => void
}

export function PdfToWordView({ files, onReorder, onRemove }: PdfToWordViewProps) {
  const { thumbs, loading } = usePdfFirstPages(files)

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
            {files.map((pf, idx) => {
              const thumb = thumbs.get(pf.id)
              return (
                <SortablePdfCard
                  key={pf.id}
                  pf={pf}
                  index={idx}
                  thumb={thumb}
                  onRemove={onRemove}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <span className="font-medium">{files.length} PDF{files.length > 1 ? 's' : ''}</span>
          <span className="text-muted-foreground">
            · {formatBytes(files.reduce((acc, f) => acc + f.file.size, 0))} total
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Drag to reorder · Each PDF becomes a Word document
        </p>
      </div>
    </div>
  )
}

interface SortablePdfCardProps {
  pf: PdfFile
  index: number
  thumb?: { id: string; dataUrl: string | null; pageCount: number; loading: boolean }
  onRemove: (id: string) => void
}

function SortablePdfCard({ pf, index, thumb, onRemove }: SortablePdfCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pf.id,
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
          onClick={() => onRemove(pf.id)}
          className="text-muted-foreground transition-colors hover:text-destructive"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* First-page thumbnail */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
        {thumb?.loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          </div>
        ) : thumb?.dataUrl ? (
          <img
            src={thumb.dataUrl}
            alt={pf.file.name}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {thumb?.pageCount ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {thumb.pageCount}p
          </span>
        ) : null}
      </div>

      {/* Filename + size */}
      <div className="mt-2 min-w-0">
        <p className="truncate text-xs font-medium">{pf.file.name}</p>
        <p className="text-[10px] text-muted-foreground">{formatBytes(pf.file.size)}</p>
      </div>
    </div>
  )
}
