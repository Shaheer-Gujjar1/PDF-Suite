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
import { RotateCw, GripVertical, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface OrganizePage {
  id: string
  sourceIndex: number
  rotation: number
  deleted: boolean
}

export interface OrganizeResult {
  pages: { source: number; rotation: number }[]
}

interface OrganizePdfViewProps {
  file: File
  onResultChange: (result: OrganizeResult | null) => void
}

export function OrganizePdfView({ file, onResultChange }: OrganizePdfViewProps) {
  const { pages: thumbnails, loading, error } = usePdfThumbnails(file, 50, 0.4)
  const [items, setItems] = React.useState<OrganizePage[]>([])

  React.useEffect(() => {
    if (thumbnails.length > 0 && items.length === 0) {
      setItems(thumbnails.map((t) => ({
        id: `page-${t.pageNum - 1}`,
        sourceIndex: t.pageNum - 1,
        rotation: 0,
        deleted: false,
      })))
    }
  }, [thumbnails, items.length])

  React.useEffect(() => {
    const active = items.filter((it) => !it.deleted)
    if (active.length === 0) onResultChange(null)
    else onResultChange({ pages: active.map((it) => ({ source: it.sourceIndex, rotation: it.rotation })) })
  }, [items, onResultChange])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id)
        const newIndex = prev.findIndex((i) => i.id === over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Rendering page thumbnails…</p>
    </div>
  )
  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">{error}</div>

  const activeCount = items.filter((i) => !i.deleted).length
  const deletedCount = items.filter((i) => i.deleted).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Drag pages to reorder. Click rotate or delete.</p>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{activeCount} active</Badge>
          {deletedCount > 0 && <Badge variant="outline" className="text-destructive">{deletedCount} deleted</Badge>}
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((item, idx) => {
              const thumb = thumbnails[item.sourceIndex]
              return <SortablePage key={item.id} item={item} index={idx} thumb={thumb?.dataUrl}
                onRotate={(id) => setItems((p) => p.map((it) => it.id === id ? { ...it, rotation: (it.rotation + 90) % 360 } : it))}
                onDelete={(id) => setItems((p) => p.map((it) => it.id === id ? { ...it, deleted: !it.deleted } : it))}
              />
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortablePage({ item, index, thumb, onRotate, onDelete }: {
  item: OrganizePage; index: number; thumb?: string
  onRotate: (id: string) => void; onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} className={cn('group relative rounded-xl border bg-card p-2 transition-shadow', item.deleted ? 'border-destructive/40 opacity-40' : isDragging ? 'border-primary shadow-lg shadow-primary/20 z-10' : 'border-border hover:border-primary/50 hover:shadow-md')}>
      <div className="mb-1.5 flex items-center justify-between">
        <button {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing" aria-label="Drag to reorder"><GripVertical className="h-4 w-4" /></button>
        <span className="text-xs font-medium text-muted-foreground">{item.deleted ? 'Deleted' : `Page ${index + 1}`}</span>
      </div>
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
        {thumb ? <img src={thumb} alt={`Page ${item.sourceIndex + 1}`} className="h-full w-full object-contain" style={{ transform: `rotate(${item.rotation}deg)` }} /> : <div className="flex h-full items-center justify-center"><FileText className="h-8 w-8 text-muted-foreground/40" /></div>}
        {item.rotation > 0 && <span className="absolute right-1 top-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{item.rotation}°</span>}
      </div>
      <div className="mt-1.5 flex gap-1">
        <Button size="sm" variant="ghost" className="h-7 flex-1 gap-1 px-1 text-xs" onClick={() => onRotate(item.id)} disabled={item.deleted}><RotateCw className="h-3.5 w-3.5" />Rotate</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs hover:text-destructive" onClick={() => onDelete(item.id)}>✕</Button>
      </div>
    </div>
  )
}
