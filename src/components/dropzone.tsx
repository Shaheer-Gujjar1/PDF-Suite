'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { UploadCloud, File as FileIcon, X, Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface QueuedFile {
  id: string
  file: File
}

interface DropzoneProps {
  files: QueuedFile[]
  onFilesChange: (files: QueuedFile[]) => void
  accept?: string
  multiple?: boolean
  hint?: string
  className?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

let counter = 0
function uid(): string {
  counter += 1
  return `f_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 7)}`
}

export function Dropzone({
  files,
  onFilesChange,
  accept = 'application/pdf',
  multiple = true,
  hint = 'PDF files supported',
  className,
}: DropzoneProps) {
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      const arr = Array.from(incoming)
      const next: QueuedFile[] = multiple
        ? [...files]
        : []
      for (const file of arr) {
        next.push({ id: uid(), file })
      }
      onFilesChange(multiple ? next : next.slice(0, 1))
    },
    [files, multiple, onFilesChange]
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const remove = (id: string) =>
    onFilesChange(files.filter((f) => f.id !== id))

  const clear = () => onFilesChange([])

  return (
    <div className={cn('w-full', className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={onDrop}
        className={cn(
          'group relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all duration-300',
          dragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border bg-card hover:border-primary/50 hover:bg-primary/[0.03]'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <motion.div
          animate={dragging ? { scale: 1.12, y: -4 } : { scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className={cn(
            'mb-5 grid h-16 w-16 place-items-center rounded-2xl transition-colors',
            dragging
              ? 'bg-primary text-primary-foreground'
              : 'bg-primary/10 text-primary'
          )}
        >
          <UploadCloud className="h-8 w-8" />
        </motion.div>

        <p className="text-lg font-semibold">
          {dragging ? 'Drop to add files' : 'Drag & drop files here'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          or <span className="font-medium text-primary underline-offset-4 group-hover:underline">browse</span> from your device · {hint}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Processed locally
          </span>
          {multiple && (
            <span className="rounded-full bg-secondary px-2.5 py-1 font-medium">
              Batch supported
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">
                {files.length} file{files.length > 1 ? 's' : ''} queued
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="h-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear all
              </Button>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {files.map((f) => (
                  <motion.div
                    key={f.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <FileIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {f.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(f.file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(f.id)}
                      aria-label={`Remove ${f.file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
