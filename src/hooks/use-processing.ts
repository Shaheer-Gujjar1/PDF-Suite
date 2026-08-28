'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { WorkerPool } from '@/lib/processing/worker-pool'
import { downloadOutput, downloadZip } from '@/lib/zip'
import type {
  Task,
  RunParams,
  ProcessingItem,
  ProcessingStatus,
  PoolCallbacks,
} from '@/lib/processing/types'

let counter = 0
function uid(prefix = 't'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

export interface UseProcessingReturn {
  items: ProcessingItem[]
  status: ProcessingStatus
  overallProgress: number
  concurrency: number
  isWorking: boolean
  hasResults: boolean
  run: (params: RunParams) => Promise<void>
  cancel: () => void
  reset: () => void
  downloadOne: (item: ProcessingItem) => void
  downloadAll: () => Promise<void>
}

export function useProcessing(concurrency?: number): UseProcessingReturn {
  const [items, setItems] = React.useState<ProcessingItem[]>([])
  const [status, setStatus] = React.useState<ProcessingStatus>('idle')
  const [concurrencyState, setConcurrencyState] = React.useState(0)
  const poolRef = React.useRef<WorkerPool | null>(null)

  const getPool = React.useCallback((): WorkerPool => {
    if (!poolRef.current) {
      const callbacks: PoolCallbacks = {
        onProgress: (id, progress) =>
          setItems((prev) =>
            prev.map((it) =>
              it.taskId === id
                ? { ...it, status: 'processing', progress }
                : it
            )
          ),
        onResult: (output) =>
          setItems((prev) =>
            prev.map((it) =>
              it.taskId === output.id
                ? {
                    ...it,
                    status: 'done',
                    progress: 1,
                    outputs: output.files,
                  }
                : it
            )
          ),
        onError: (id, message) =>
          setItems((prev) =>
            prev.map((it) =>
              it.taskId === id
                ? { ...it, status: 'error', error: message }
                : it
            )
          ),
        onLog: (id, message) => {
          console.log(`[worker:${id}] ${message}`)
        },
      }
      const pool = new WorkerPool(callbacks, concurrency)
      poolRef.current = pool
      setConcurrencyState(pool.concurrency)
    }
    return poolRef.current
  }, [concurrency])

  const run = React.useCallback(
    async (params: RunParams): Promise<void> => {
      const { processor, mode, inputs, options, singleLabel } = params
      if (inputs.length === 0) {
        toast.error('Add at least one file first.')
        return
      }

      // Build tasks + initial UI items.
      const prepared = inputs.map((i) => ({
        id: uid(),
        fileName: i.fileName,
        data: i.data,
        size: i.size,
      }))

      let tasks: Task[]
      let initialItems: ProcessingItem[]
      if (mode === 'single') {
        const taskId = uid('s')
        tasks = [{ id: taskId, processor, inputs: prepared, options }]
        initialItems = [
          {
            taskId,
            label: singleLabel ?? 'Output',
            status: 'queued',
            progress: 0,
            outputs: [],
          },
        ]
      } else {
        tasks = prepared.map((p) => ({
          id: p.id,
          processor,
          inputs: [p],
          options,
        }))
        initialItems = prepared.map((p) => ({
          taskId: p.id,
          label: p.fileName,
          status: 'queued',
          progress: 0,
          outputs: [],
        }))
      }

      setItems(initialItems)
      setStatus('processing')

      const pool = getPool()
      const results = await pool.enqueueAll(tasks)
      const anyError = results.some((r) => r.status === 'rejected')
      const allError =
        anyError && results.every((r) => r.status === 'rejected')
      setStatus(allError ? 'error' : anyError ? 'completed' : 'completed')
      if (allError) {
        toast.error('Processing failed', {
          description: 'Something went wrong. Please try again.',
        })
      } else {
        const okCount = results.filter((r) => r.status === 'fulfilled').length
        const failCount = results.length - okCount
        toast.success(
          `Processed ${okCount} file${okCount > 1 ? 's' : ''}${
            failCount ? ` · ${failCount} failed` : ''
          }`
        )
      }
    },
    [getPool]
  )

  const cancel = React.useCallback(() => {
    poolRef.current?.terminate()
    poolRef.current = null
    setConcurrencyState(0)
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'processing' || it.status === 'queued'
          ? { ...it, status: 'error', error: 'Cancelled' }
          : it
      )
    )
    setStatus('idle')
  }, [])

  const reset = React.useCallback(() => {
    setItems([])
    setStatus('idle')
  }, [])

  const downloadOne = React.useCallback((item: ProcessingItem) => {
    if (item.outputs.length === 0) return
    if (item.outputs.length === 1) {
      downloadOutput(item.outputs[0])
    } else {
      const base = item.label.replace(/\.[^.]+$/, '')
      void downloadZip(item.outputs, `${base}.zip`)
    }
  }, [])

  const downloadAll = React.useCallback(async () => {
    const all = items.flatMap((it) => it.outputs)
    if (all.length === 0) {
      toast.error('Nothing to download yet.')
      return
    }
    const name =
      all.length === 1 ? undefined : 'toolforge-output.zip'
    await downloadZip(all, name)
    toast.success(
      `Downloaded ${all.length} file${all.length > 1 ? 's' : ''}${
        all.length > 1 ? ' as ZIP' : ''
      }`
    )
  }, [items])

  const overallProgress = React.useMemo(() => {
    if (items.length === 0) return 0
    const sum = items.reduce(
      (acc, it) =>
        acc + (it.status === 'done' ? 1 : it.status === 'error' ? 1 : it.progress),
      0
    )
    return sum / items.length
  }, [items])

  const isWorking = status === 'processing'
  const hasResults = items.some((it) => it.outputs.length > 0)

  return {
    items,
    status,
    overallProgress,
    concurrency: concurrencyState,
    isWorking,
    hasResults,
    run,
    cancel,
    reset,
    downloadOne,
    downloadAll,
  }
}
