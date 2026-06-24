import type {
  Task,
  ProcessOutput,
  WorkerMessage,
  PoolCallbacks,
} from './types'
import { WORKER_SOURCE } from './worker-source'

interface QueuedItem {
  task: Task
  resolve: (output: ProcessOutput) => void
  reject: (error: Error) => void
}

interface ActiveItem {
  workerIdx: number
  resolve: (output: ProcessOutput) => void
  reject: (error: Error) => void
}

/**
 * A fixed-size pool of Web Workers with a FIFO task queue.
 *
 * - Workers are created lazily from a Blob URL (same-origin, so they load in
 *   any deployment including cross-origin previews) and reused for the pool's
 *   lifetime.
 * - Concurrency defaults to `min(hardwareConcurrency, 6)` so the UI stays
 *   responsive even on many-core machines.
 * - Input ArrayBuffers are transferred (zero-copy) to the worker; the main
 *   thread gives up access, which is fine because each file is read fresh.
 * - Per-task progress, results and errors are routed through callbacks so
 *   React state can update granularly.
 */
export class WorkerPool {
  private workers: Worker[] = []
  private workerUrls: string[] = []
  private idle = new Set<number>()
  private queue: QueuedItem[] = []
  private active = new Map<string, ActiveItem>()
  private callbacks: PoolCallbacks
  private size: number
  private terminated = false

  constructor(callbacks: PoolCallbacks, size?: number) {
    this.callbacks = callbacks
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
    this.size = Math.max(1, Math.min(size ?? hw, 6))
  }

  get concurrency(): number {
    return this.size
  }

  get pending(): number {
    return this.queue.length
  }

  get running(): number {
    return this.active.size
  }

  private ensureWorkers(): void {
    if (this.workers.length || this.terminated) return
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
    for (let i = 0; i < this.size; i++) {
      const url = URL.createObjectURL(blob)
      const worker = new Worker(url)
      const idx = i
      worker.onmessage = (e: MessageEvent<WorkerMessage>) =>
        this.handleMessage(e.data, idx)
      worker.onerror = (e: ErrorEvent) => {
        // If a task is active on this worker, reject it; then recycle.
        const entry = [...this.active.entries()].find(
          ([, v]) => v.workerIdx === idx
        )
        if (entry) {
          const [taskId, item] = entry
          this.active.delete(taskId)
          const msg = e.message || 'Worker error'
          item.reject(new Error(msg))
          this.callbacks.onError?.(taskId, msg)
        }
        this.idle.add(idx)
        this.drain()
      }
      this.workers.push(worker)
      this.workerUrls.push(url)
      this.idle.add(idx)
    }
  }

  private handleMessage(msg: WorkerMessage, workerIdx: number): void {
    const item = this.active.get(msg.id)
    switch (msg.kind) {
      case 'progress':
        this.callbacks.onProgress?.(msg.id, msg.progress)
        break
      case 'log':
        this.callbacks.onLog?.(msg.id, msg.message)
        break
      case 'result':
        if (item) {
          this.active.delete(msg.id)
          this.idle.add(workerIdx)
          item.resolve(msg.output)
          this.callbacks.onResult?.(msg.output)
          this.drain()
        }
        break
      case 'error':
        if (item) {
          this.active.delete(msg.id)
          this.idle.add(workerIdx)
          item.reject(new Error(msg.message))
          this.callbacks.onError?.(msg.id, msg.message)
          this.drain()
        }
        break
    }
  }

  enqueue(task: Task): Promise<ProcessOutput> {
    this.ensureWorkers()
    return new Promise<ProcessOutput>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.drain()
    })
  }

  /** Enqueue many tasks and resolve when all settle (order preserved). */
  enqueueAll(tasks: Task[]): Promise<PromiseSettledResult<ProcessOutput>[]> {
    return Promise.allSettled(tasks.map((t) => this.enqueue(t)))
  }

  private drain(): void {
    while (this.idle.size > 0 && this.queue.length > 0) {
      const workerIdx = [...this.idle][0]
      const item = this.queue.shift()!
      this.idle.delete(workerIdx)
      this.active.set(item.task.id, {
        workerIdx,
        resolve: item.resolve,
        reject: item.reject,
      })
      const transfer = item.task.inputs
        .map((i) => i.data)
        .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
      this.workers[workerIdx].postMessage(
        { type: 'process', task: item.task },
        transfer
      )
    }
  }

  /** Cancel everything: terminate workers and reject queued tasks. */
  terminate(): void {
    this.terminated = true
    for (const w of this.workers) w.terminate()
    for (const url of this.workerUrls) URL.revokeObjectURL(url)
    this.workers = []
    this.workerUrls = []
    this.idle.clear()
    for (const [, item] of this.active)
      item.reject(new Error('Cancelled'))
    this.active.clear()
    for (const item of this.queue)
      item.reject(new Error('Cancelled'))
    this.queue = []
  }
}
