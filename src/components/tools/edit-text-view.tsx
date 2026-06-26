'use client'

import * as React from 'react'
import { Loader2, Plus, X, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadPdfJs, usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface EditResult {
  edits: { page: number; x: number; y: number; text: string; size: number; whiteout?: { x: number; y: number; w: number; h: number } }[]
}

interface EditTextViewProps {
  file: File
  onResultChange: (result: EditResult | null) => void
}

interface TextItem {
  x: number
  y: number
  text: string
  width: number
  height: number
}

interface Edit {
  id: string
  page: number
  x: number
  y: number
  text: string
  size: number
  whiteout?: { x: number; y: number; w: number; h: number }
}

export function EditTextView({ file, onResultChange }: EditTextViewProps) {
  const { pages, loading: thumbLoading } = usePdfThumbnails(file, 1, 0.8)
  const [textItems, setTextItems] = React.useState<TextItem[]>([])
  const [extracting, setExtracting] = React.useState(true)
  const [edits, setEdits] = React.useState<Edit[]>([])
  const [newText, setNewText] = React.useState('')
  const [addingMode, setAddingMode] = React.useState(false)
  const pageRef = React.useRef<HTMLDivElement>(null)
  const page = pages[0]

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        const buf = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        const pg = await doc.getPage(1)
        const content = await pg.getTextContent()
        const items: TextItem[] = content.items
          .filter((it: any) => it.str && it.str.trim())
          .map((it: any) => ({
            x: it.transform[4],
            y: it.transform[5],
            text: it.str,
            width: it.width || 50,
            height: it.height || 12,
          }))
        if (!cancelled) {
          setTextItems(items)
          setExtracting(false)
        }
        try { await doc.destroy() } catch {}
      } catch {
        if (!cancelled) setExtracting(false)
      }
    })()
    return () => { cancelled = true }
  }, [file])

  React.useEffect(() => {
    if (edits.length > 0) {
      onResultChange({ edits: edits.map(({ id, ...e }) => e) })
    } else {
      onResultChange(null)
    }
  }, [edits, onResultChange])

  const handlePageClick = (e: React.MouseEvent) => {
    if (!addingMode || !page || !pageRef.current) return
    const rect = pageRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * page.width
    const y = page.height - ((e.clientY - rect.top) / rect.height) * page.height
    const id = `edit_${Date.now()}`
    setEdits((prev) => [...prev, { id, page: 0, x, y, text: newText, size: 12 }])
    setNewText('')
    setAddingMode(false)
  }

  const removeEdit = (id: string) => setEdits((prev) => prev.filter((e) => e.id !== id))

  const loading = thumbLoading || extracting

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Extracting text…</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Extracted text is shown below. Add new text by typing and clicking on the page.
      </p>

      {/* Add text bar */}
      <div className="flex gap-2">
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Type text to add…"
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={() => setAddingMode(!addingMode)}
          disabled={!newText.trim()}
          variant={addingMode ? 'default' : 'outline'}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {addingMode ? 'Click on page…' : 'Add text'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Page with text overlays */}
        {page && (
          <div
            ref={pageRef}
            className={cn('relative inline-block', addingMode && 'cursor-crosshair')}
            onClick={handlePageClick}
          >
            <img src={page.dataUrl} alt="Page" className="max-h-[500px] rounded-lg border-2 border-border" draggable={false} />
            {/* Extracted text items */}
            {textItems.map((item, i) => (
              <span
                key={i}
                className="absolute rounded border border-blue-400/30 bg-blue-400/10 px-0.5 text-[6px] leading-none text-transparent"
                style={{
                  left: `${(item.x / page.width) * 100}%`,
                  bottom: `${(item.y / page.height) * 100}%`,
                  width: `${(item.width / page.width) * 100}%`,
                  height: `${(item.height / page.height) * 100}%`,
                }}
              />
            ))}
            {/* Placed edits */}
            {edits.map((edit) => (
              <span
                key={edit.id}
                className="absolute flex items-center rounded border border-emerald-400/40 bg-emerald-400/10 px-1 text-[8px]"
                style={{
                  left: `${(edit.x / page.width) * 100}%`,
                  bottom: `${(edit.y / page.height) * 100}%`,
                }}
              >
                <Type className="mr-0.5 h-2 w-2" />
                {edit.text.slice(0, 15)}
                <button onClick={() => removeEdit(edit.id)} className="ml-1 text-red-500">✕</button>
              </span>
            ))}
          </div>
        )}

        {/* Edits list */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Edits ({edits.length})</h4>
          {edits.length === 0 ? (
            <p className="text-xs text-muted-foreground">No edits yet. Type text above and click on the page to add.</p>
          ) : (
            <div className="space-y-1.5">
              {edits.map((edit) => (
                <div key={edit.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-2 text-xs">
                  <span className="truncate">"{edit.text}"</span>
                  <button onClick={() => removeEdit(edit.id)} className="ml-2 shrink-0 text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
