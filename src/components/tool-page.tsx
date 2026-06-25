'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Layers,
  Sparkles,
  Wand2,
  ChevronRight,
  Loader2,
  Cpu,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PrivacyBadge } from '@/components/privacy-badge'
import { Dropzone, type QueuedFile } from '@/components/dropzone'
import { ProcessingPanel } from '@/components/processing-panel'
import {
  ToolOptions,
  hasOptions,
  defaultOptions,
  type ToolOptionsMap,
} from '@/components/tool-options'
import { useProcessing } from '@/hooks/use-processing'
import { getProcessor, isImplemented } from '@/lib/processing/registry'
import {
  type Tool,
  type ToolCategory,
  accentClasses,
  tools,
  categoryMeta,
} from '@/lib/tools'
import { cn } from '@/lib/utils'

interface ToolPageProps {
  tool: Tool
  onNavigate: (to: string) => void
  onBack: () => void
}

interface InputConfig {
  accept: string
  multiple: boolean
  hint: string
  mode: 'files' | 'text'
}

function getInput(tool: Tool): InputConfig {
  switch (tool.id) {
    case 'images-to-pdf':
      return { accept: 'image/*', multiple: true, hint: 'JPG, PNG, WEBP, GIF', mode: 'files' }
    case 'word-to-pdf':
      return { accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true, hint: 'Word .docx files', mode: 'files' }
    case 'excel-to-pdf':
      return { accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: true, hint: 'Excel .xlsx files', mode: 'files' }
    case 'html-to-pdf':
      return { accept: '', multiple: false, hint: 'Paste your HTML', mode: 'text' }
    default:
      return { accept: 'application/pdf', multiple: tool.batch, hint: 'PDF files', mode: 'files' }
  }
}

export function ToolPage({ tool, onNavigate, onBack }: ToolPageProps) {
  const a = accentClasses[tool.accent]
  const Icon = tool.icon
  const cfg = getInput(tool)
  const [files, setFiles] = React.useState<QueuedFile[]>([])
  const [html, setHtml] = React.useState('')
  const [options, setOptions] = React.useState<ToolOptionsMap>(() =>
    defaultOptions(tool.id)
  )
  const implemented = isImplemented(tool.id)
  const preview = !implemented

  const processing = useProcessing()

  const related = tools
    .filter((t) => t.category === tool.category && t.id !== tool.id)
    .slice(0, 4)

  const cat = categoryMeta(tool.category as ToolCategory)

  // Reset state when switching tools.
  React.useEffect(() => {
    setFiles([])
    setHtml('')
    setOptions(defaultOptions(tool.id))
  }, [tool.id])

  const canProcess =
    cfg.mode === 'files'
      ? files.length > 0
      : html.trim().length > 0

  // Protect requires a password before the run button is enabled.
  const needsPassword = tool.id === 'protect'
  const hasPassword = String(options.password ?? '').length > 0
  const runEnabled = canProcess && (!needsPassword || hasPassword) && !processing.isWorking

  const handleProcess = async () => {
    if (!canProcess || processing.isWorking) return

    const processor = getProcessor(tool.id)
    let inputs: { fileName: string; data: ArrayBuffer; size: number }[] = []
    let mode: 'per-file' | 'single' = 'per-file'
    let singleLabel: string | undefined

    if (cfg.mode === 'text') {
      const data = new TextEncoder().encode(html).buffer as ArrayBuffer
      inputs = [{ fileName: 'input.html', data, size: data.byteLength }]
      mode = 'single'
      singleLabel = 'HTML → PDF output'
    } else {
      for (const qf of files) {
        const data = await qf.file.arrayBuffer()
        inputs.push({ fileName: qf.file.name, data, size: qf.file.size })
      }
      if (tool.id === 'merge') {
        mode = 'single'
        singleLabel = 'Merged document'
      } else if (tool.id === 'images-to-pdf' && options.output === 'single') {
        mode = 'single'
        singleLabel = 'Combined image PDF'
      }
    }

    await processing.run({ processor, mode, inputs, options, singleLabel })
  }

  const buttonLabel = processing.isWorking
    ? 'Processing…'
    : implemented
      ? `Run ${tool.name}`
      : preview
        ? 'Run engine preview'
        : `Run ${tool.name}`

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      {/* Breadcrumb / back */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All tools
        </button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span>{cat?.name}</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{tool.name}</span>
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <span
            className={cn(
              'grid h-14 w-14 shrink-0 place-items-center rounded-2xl ring-1',
              a.badge,
              a.ring
            )}
          >
            <Icon className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {tool.name}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {tool.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tool.batch && (
            <Badge variant="secondary" className="rounded-full">
              <Layers className="mr-1 h-3 w-3" /> Batch
            </Badge>
          )}
          {tool.tag && (
            <Badge className="rounded-full">{tool.tag}</Badge>
          )}
          {preview && (
            <Badge variant="outline" className="rounded-full border-amber-500/40 text-amber-600 dark:text-amber-400">
              <Sparkles className="mr-1 h-3 w-3" /> Step {tool.step}
            </Badge>
          )}
        </div>
      </motion.div>

      <div className="mt-5">
        <PrivacyBadge />
      </div>

      {/* Working area */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="mt-8 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-7"
      >
        {cfg.mode === 'files' ? (
          <Dropzone
            files={files}
            onFilesChange={setFiles}
            accept={cfg.accept}
            multiple={cfg.multiple}
            hint={cfg.hint}
          />
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-border bg-background p-6">
            <label className="mb-2 block text-sm font-medium">
              Paste your HTML markup
            </label>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder={'<h1>Hello PDF</h1>\n<p>Render this into a PDF…</p>'}
              className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-card p-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              HTML rendering arrives in Step {tool.step}.
            </p>
          </div>
        )}

        {/* Tool-specific options */}
        {cfg.mode === 'files' && hasOptions(tool.id) && files.length > 0 && (
          <div className="mt-5">
            <ToolOptions
              tool={tool}
              options={options}
              onChange={setOptions}
              disabled={processing.isWorking}
            />
          </div>
        )}

        {/* Action bar */}
        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-5 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {processing.isWorking
              ? 'Running locally — your browser is doing the work.'
              : cfg.mode === 'files'
                ? files.length === 0
                  ? 'Add files to begin.'
                  : `${files.length} file${files.length > 1 ? 's' : ''} ready.`
                : html.trim()
                  ? 'HTML ready.'
                  : 'Paste HTML to begin.'}
          </p>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={!runEnabled}
            onClick={handleProcess}
          >
            {processing.isWorking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            {buttonLabel}
          </Button>
        </div>

        {preview && !processing.isWorking && processing.status === 'idle' && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Engine preview · real {tool.name} logic arrives in Step {tool.step}.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                The full pipeline is live — drop files and hit “Run engine
                preview” to watch the Web Worker queue, live progress bars and
                ZIP download in action. Files are processed locally and never
                uploaded.
              </p>
            </div>
          </div>
        )}
      </motion.div>

      {/* Processing panel */}
      <AnimatePresence>
        {processing.status !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-6"
          >
            <ProcessingPanel
              items={processing.items}
              status={processing.status}
              overallProgress={processing.overallProgress}
              concurrency={processing.concurrency}
              isWorking={processing.isWorking}
              hasResults={processing.hasResults}
              onCancel={processing.cancel}
              onReset={processing.reset}
              onDownloadOne={processing.downloadOne}
              onDownloadAll={processing.downloadAll}
              preview={preview}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Related tools */}
      {related.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-4 text-lg font-semibold">Related tools</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((r) => {
              const RIcon = r.icon
              const ra = accentClasses[r.accent]
              return (
                <button
                  key={r.id}
                  onClick={() => onNavigate(`/${r.id}`)}
                  className="group flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 place-items-center rounded-lg ring-1',
                      ra.badge,
                      ra.ring
                    )}
                  >
                    <RIcon className="h-4.5 w-4.5" />
                  </span>
                  <span className="text-sm font-medium">{r.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
