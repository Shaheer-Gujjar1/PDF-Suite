'use client'

import * as React from 'react'
import { Loader2, X, FileSpreadsheet, FileText } from 'lucide-react'
import { usePdfFirstPages } from '@/hooks/use-pdf'
import { formatBytes } from '@/lib/zip'
import { cn } from '@/lib/utils'

export interface PdfToExcelFile {
  id: string
  file: File
}

interface PdfToExcelViewProps {
  files: PdfToExcelFile[]
  onRemove: (id: string) => void
}

/**
 * PDF to Excel view — shows a first-page preview of each uploaded PDF so the
 * user can see what will be extracted into spreadsheet rows/columns.
 */
export function PdfToExcelView({ files, onRemove }: PdfToExcelViewProps) {
  const { thumbs, loading } = usePdfFirstPages(files)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {files.map((pf) => {
          const thumb = thumbs.get(pf.id)
          return (
            <PdfToExcelCard
              key={pf.id}
              pf={pf}
              thumb={thumb}
              onRemove={onRemove}
            />
          )
        })}
      </div>

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
          Each PDF becomes a spreadsheet · One sheet per page
        </p>
      </div>
    </div>
  )
}

interface PdfToExcelCardProps {
  pf: PdfToExcelFile
  thumb?: { id: string; dataUrl: string | null; pageCount: number; loading: boolean }
  onRemove: (id: string) => void
}

function PdfToExcelCard({ pf, thumb, onRemove }: PdfToExcelCardProps) {
  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-card p-2.5 transition-shadow',
        'border-border hover:border-primary/50 hover:shadow-md'
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <FileSpreadsheet className="h-4 w-4 text-teal-500" />
        <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-500 text-[10px] font-bold text-white">
          XLSX
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
