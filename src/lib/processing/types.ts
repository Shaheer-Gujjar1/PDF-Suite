/**
 * Processing engine types & worker message protocol.
 *
 * The engine is intentionally generic so it can power every tool:
 *  - Per-file batch tools (compress, rotate, images→pdf) enqueue one task
 *    per input file → the pool parallelises across workers.
 *  - Multi-file tools (merge) enqueue a single task carrying all inputs.
 *  - Multi-output tools (split, pdf→images) return many outputs per task.
 */

export type ProcessorType =
  | 'passthrough' // Step 2 engine preview (no-op + simulated work)
  // Step 3 — Category A
  | 'merge'
  | 'split'
  | 'rotate'
  | 'images-to-pdf'
  | 'pdf-to-images'
  | 'page-numbers'
  | 'watermark'
  | 'protect'
  | 'html-to-pdf'
  // Step 4 — Category B (structural)
  | 'compress'
  | 'repair'
  | 'unlock'
  // Step 5 — Office conversions
  | 'word-to-pdf'
  | 'excel-to-pdf'
  | 'pdf-to-excel'
  // Step 6 — Interactive tools
  | 'organize'
  | 'crop'
  | 'sign-annotate'
  | 'edit-text'
  // Step 7 — Image tools
  | 'crop-images'
  | 'convert-images'
  | 'favicon-generator'
  | 'watermark-images'

export interface ProcessInput {
  id: string
  fileName: string
  data: ArrayBuffer
  size: number
}

export interface OutputFile {
  name: string
  data: ArrayBuffer
  mime: string
  /** Optional human-readable note (e.g. "72% smaller"). */
  note?: string
}

export interface Task {
  id: string
  processor: ProcessorType
  inputs: ProcessInput[]
  options?: Record<string, unknown>
}

export interface ProcessOutput {
  id: string
  files: OutputFile[]
}

/** Worker → main thread messages. */
export type WorkerMessage =
  | { id: string; kind: 'progress'; progress: number }
  | { id: string; kind: 'log'; message: string }
  | { id: string; kind: 'result'; output: ProcessOutput }
  | { id: string; kind: 'error'; message: string }

/** Main thread → worker messages. */
export type MainMessage = { type: 'process'; task: Task }

export interface PoolCallbacks {
  onProgress?: (id: string, progress: number) => void
  onResult?: (output: ProcessOutput) => void
  onError?: (id: string, message: string) => void
  onLog?: (id: string, message: string) => void
}

export interface ProcessingItem {
  taskId: string
  label: string
  status: 'queued' | 'processing' | 'done' | 'error'
  progress: number
  outputs: OutputFile[]
  error?: string
}

export type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'error'

export interface RunParams {
  processor: ProcessorType
  /** One task per input (parallel) or a single task with all inputs (merge). */
  mode: 'per-file' | 'single'
  inputs: { fileName: string; data: ArrayBuffer; size: number }[]
  options?: Record<string, unknown>
  /** Label for the single task (mode: 'single'). */
  singleLabel?: string
}
