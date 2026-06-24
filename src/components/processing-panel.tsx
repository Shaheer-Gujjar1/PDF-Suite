'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  RotateCcw,
  XCircle,
  FileCheck2,
  Package,
  Cpu,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '@/lib/zip'
import type { ProcessingItem, ProcessingStatus } from '@/lib/processing/types'
import { cn } from '@/lib/utils'

interface ProcessingPanelProps {
  items: ProcessingItem[]
  status: ProcessingStatus
  overallProgress: number
  concurrency: number
  isWorking: boolean
  hasResults: boolean
  onCancel: () => void
  onReset: () => void
  onDownloadOne: (item: ProcessingItem) => void
  onDownloadAll: () => void
  /** When true, show the "engine preview" badge (Step 2 demo mode). */
  preview?: boolean
}

const statusConfig: Record<
  ProcessingItem['status'],
  { label: string; icon: React.ElementType; tone: string }
> = {
  queued: {
    label: 'Queued',
    icon: Loader2,
    tone: 'text-muted-foreground',
  },
  processing: {
    label: 'Processing',
    icon: Loader2,
    tone: 'text-primary',
  },
  done: {
    label: 'Done',
    icon: CheckCircle2,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    label: 'Failed',
    icon: XCircle,
    tone: 'text-destructive',
  },
}

export function ProcessingPanel({
  items,
  status,
  overallProgress,
  concurrency,
  isWorking,
  hasResults,
  onCancel,
  onReset,
  onDownloadOne,
  onDownloadAll,
  preview = false,
}: ProcessingPanelProps) {
  const doneCount = items.filter((i) => i.status === 'done').length
  const errorCount = items.filter((i) => i.status === 'error').length
  const totalOutputs = items.reduce((acc, i) => acc + i.outputs.length, 0)
  const pct = Math.round(overallProgress * 100)

  const overallStatus: { label: string; tone: string } =
    status === 'processing'
      ? { label: 'Processing', tone: 'text-primary' }
      : status === 'completed' && errorCount > 0
        ? { label: `Done · ${errorCount} failed`, tone: 'text-amber-600 dark:text-amber-400' }
        : status === 'completed'
          ? { label: 'Completed', tone: 'text-emerald-600 dark:text-emerald-400' }
          : status === 'error'
            ? { label: 'Failed', tone: 'text-destructive' }
            : { label: 'Idle', tone: 'text-muted-foreground' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-border/70 bg-card"
    >
      {/* Header / overall */}
      <div className="border-b border-border/60 bg-secondary/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20',
                isWorking && 'animate-pulse'
              )}
            >
              <FileArchive className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Processing engine</h3>
                {preview && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                  >
                    Preview
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isWorking
                  ? `Working through ${items.length} task${items.length > 1 ? 's' : ''}…`
                  : `${doneCount} of ${items.length} complete`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {concurrency > 0 && (
              <Badge variant="secondary" className="gap-1 rounded-full">
                <Cpu className="h-3 w-3" />
                {concurrency}× parallel
              </Badge>
            )}
            <span className={cn('text-xs font-medium', overallStatus.tone)}>
              {overallStatus.label}
            </span>
          </div>
        </div>

        {/* Overall progress */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Overall progress</span>
            <span className="font-medium tabular-nums text-foreground">
              {pct}%
            </span>
          </div>
          <Progress
            value={pct}
            className={cn(
              'h-2',
              isWorking && '[&>[data-slot=progress-indicator]]:animate-pulse'
            )}
          />
        </div>
      </div>

      {/* Per-file list */}
      <div className="max-h-96 overflow-y-auto p-3">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const cfg = statusConfig[item.status]
            const Icon = cfg.icon
            const spinning = item.status === 'processing' || item.status === 'queued'
            return (
              <motion.div
                key={item.taskId}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="rounded-xl px-2 py-2 transition-colors hover:bg-secondary/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      item.status === 'done'
                        ? 'bg-emerald-500/10'
                        : item.status === 'error'
                          ? 'bg-destructive/10'
                          : 'bg-primary/10'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        cfg.tone,
                        spinning && 'animate-spin'
                      )}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {item.label}
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.status === 'done' && item.outputs.length > 0 && (
                          <>
                            <span className="hidden text-xs text-muted-foreground sm:inline">
                              {item.outputs.length > 1
                                ? `${item.outputs.length} files`
                                : formatBytes(item.outputs[0].data.byteLength)}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => onDownloadOne(item)}
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Download</span>
                            </Button>
                          </>
                        )}
                        {item.status === 'error' && (
                          <span className="truncate text-xs text-destructive">
                            {item.error}
                          </span>
                        )}
                      </div>
                    </div>
                    {item.status === 'processing' && (
                      <div className="mt-1.5">
                        <Progress
                          value={Math.round(item.progress * 100)}
                          className="h-1"
                        />
                      </div>
                    )}
                    {item.status === 'done' && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <FileCheck2 className="h-3 w-3" />
                        {item.outputs.length} output
                        {item.outputs.length > 1 ? 's' : ''} ready
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      <div className="flex flex-col items-stretch gap-2 border-t border-border/60 bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {totalOutputs > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              {totalOutputs} file{totalOutputs > 1 ? 's' : ''} ready to
              download
            </span>
          ) : isWorking ? (
            <span>Hold tight — this runs locally in your browser.</span>
          ) : (
            <span>Idle.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isWorking ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Start over
            </Button>
          )}
          <Button
            size="sm"
            disabled={!hasResults || isWorking}
            onClick={onDownloadAll}
            className="gap-1.5"
          >
            <Package className="h-3.5 w-3.5" />
            {totalOutputs > 1
              ? `Download All (.ZIP)`
              : 'Download'}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
