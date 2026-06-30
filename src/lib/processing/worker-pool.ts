import type {
  Task,
  ProcessOutput,
  WorkerMessage,
  PoolCallbacks,
} from './types'
import { WORKER_SOURCE } from './worker-source'
import { getLibSources, WORKER_IMPORT_URLS } from './libs'

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
 * - Workers are created lazily from a single Blob URL (same-origin → works in
 *   any deployment) whose source embeds the pdf-lib UMD bundle fetched once on
 *   the main thread. This makes each worker self-contained: no runtime
 *   importScripts, no cross-origin worker script loading.
 * - Init is async (it fetches libs); the first `enqueue` awaits it. Subsequent
 *   enqueues share the same init promise.
 * - Concurrency defaults to `min(hardwareConcurrency, 6)`.
 * - Input ArrayBuffers are transferred (zero-copy) to the worker.
 * - Per-task progress, results and errors are routed through callbacks.
 */
export class WorkerPool {
  private workers: Worker[] = []
  private workerUrl: string | null = null
  private idle = new Set<number>()
  private queue: QueuedItem[] = []
  private active = new Map<string, ActiveItem>()
  private callbacks: PoolCallbacks
  private size: number
  private terminated = false
  private initPromise: Promise<void> | null = null

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

  /** Fetch libs + create workers. Idempotent. */
  private init(): Promise<void> {
    if (this.workers.length || this.terminated) return Promise.resolve()
    if (!this.initPromise) {
      this.initPromise = this.doInit()
    }
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    const libSource = await getLibSources()
    if (this.terminated) return
    // Inject the import-URLs map so the worker can lazily load office libs.
    const importUrlsJson = JSON.stringify(WORKER_IMPORT_URLS)
    const workerCode = libSource + '\n' + WORKER_SOURCE.replace(
      '__IMPORT_URLS_PLACEHOLDER__',
      importUrlsJson
    )
    const blob = new Blob([workerCode], {
      type: 'application/javascript',
    })
    this.workerUrl = URL.createObjectURL(blob)
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(this.workerUrl)
      const idx = i
      worker.onmessage = (e: MessageEvent<WorkerMessage>) =>
        this.handleMessage(e.data, idx)
      worker.onerror = (e: ErrorEvent) => {
        console.error('[worker-pool] worker', idx, 'error:', e.message, e.filename, e.lineno)
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

  async enqueue(task: Task): Promise<ProcessOutput> {
    await this.init()
    if (this.terminated) throw new Error('Cancelled')
    return new Promise<ProcessOutput>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.drain()
    })
  }

  /** Enqueue many tasks and resolve when all settle (order preserved). */
  async enqueueAll(tasks: Task[]): Promise<PromiseSettledResult<ProcessOutput>[]> {
    await this.init()
    if (this.terminated) {
      return tasks.map(() => ({
        status: 'rejected' as const,
        reason: new Error('Cancelled'),
      }))
    }
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
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl)
    this.workers = []
    this.workerUrl = null
    this.idle.clear()
    for (const [, item] of this.active)
      item.reject(new Error('Cancelled'))
    this.active.clear()
    for (const item of this.queue)
      item.reject(new Error('Cancelled'))
    this.queue = []
  }
}
