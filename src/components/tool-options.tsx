'use client'

import * as React from 'react'
import { Scissors, RotateCw, Images, FileArchive, LockOpen, Hash, Stamp, Lock, FileImage, Code2 } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { type Tool } from '@/lib/tools'
import { cn } from '@/lib/utils'

export type ToolOptionsMap = Record<string, unknown>

interface ToolOptionsProps {
  tool: Tool
  options: ToolOptionsMap
  onChange: (options: ToolOptionsMap) => void
  disabled?: boolean
}

export function hasOptions(toolId: string): boolean {
  return [
    'split', 'rotate', 'images-to-pdf', 'compress', 'unlock',
    'page-numbers', 'watermark', 'protect', 'pdf-to-images',
  ].includes(toolId)
}

export function defaultOptions(toolId: string): ToolOptionsMap {
  switch (toolId) {
    case 'split':
      return { mode: 'each', ranges: '' }
    case 'rotate':
      return { angle: 90 }
    case 'images-to-pdf':
      return { output: 'single', pageSize: 'fit' }
    case 'compress':
      return { level: 'normal' }
    case 'unlock':
      return { password: '' }
    case 'page-numbers':
      return { position: 'bottom-center', fontSize: 11, format: '{n}', startNumber: 1 }
    case 'watermark':
      return { text: 'CONFIDENTIAL', fontSize: 50, opacity: 15 }
    case 'protect':
      return { password: '' }
    case 'pdf-to-images':
      return { format: 'png', scale: 2 }
    default:
      return {}
  }
}

export function ToolOptions({ tool, options, onChange, disabled }: ToolOptionsProps) {
  const set = (key: string, value: unknown) =>
    onChange({ ...options, [key]: value })

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-secondary/40 p-4 sm:p-5',
        disabled && 'pointer-events-none opacity-60'
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <SettingsIcon toolId={tool.id} />
        </span>
        Options
      </div>

      {tool.id === 'split' && (
        <SplitOptions options={options} set={set} />
      )}
      {tool.id === 'rotate' && (
        <RotateOptions options={options} set={set} />
      )}
      {tool.id === 'images-to-pdf' && (
        <ImagesOptions options={options} set={set} />
      )}
      {tool.id === 'compress' && (
        <CompressOptions options={options} set={set} />
      )}
      {tool.id === 'unlock' && (
        <UnlockOptions options={options} set={set} />
      )}
      {tool.id === 'page-numbers' && (
        <PageNumberOptions options={options} set={set} />
      )}
      {tool.id === 'watermark' && (
        <WatermarkOptions options={options} set={set} />
      )}
      {tool.id === 'protect' && (
        <ProtectOptions options={options} set={set} />
      )}
      {tool.id === 'pdf-to-images' && (
        <PdfToImagesOptions options={options} set={set} />
      )}
    </div>
  )
}

function SettingsIcon({ toolId }: { toolId: string }) {
  if (toolId === 'split') return <Scissors className="h-4 w-4" />
  if (toolId === 'rotate') return <RotateCw className="h-4 w-4" />
  if (toolId === 'compress') return <FileArchive className="h-4 w-4" />
  if (toolId === 'unlock') return <LockOpen className="h-4 w-4" />
  if (toolId === 'page-numbers') return <Hash className="h-4 w-4" />
  if (toolId === 'watermark') return <Stamp className="h-4 w-4" />
  if (toolId === 'protect') return <Lock className="h-4 w-4" />
  if (toolId === 'pdf-to-images') return <FileImage className="h-4 w-4" />
  return <Images className="h-4 w-4" />
}

function OptionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function SplitOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const mode = (options.mode as string) || 'each'
  return (
    <div className="space-y-4">
      <OptionRow label="Split mode" hint="How to divide the pages.">
        <RadioGroup
          value={mode}
          onValueChange={(v) => set('mode', v)}
          className="grid grid-cols-2 gap-2"
        >
          <RadioCard value="each" label="Each page" desc="One PDF per page" />
          <RadioCard value="ranges" label="Custom ranges" desc="Define page groups" />
        </RadioGroup>
      </OptionRow>
      {mode === 'ranges' && (
        <OptionRow label="Page ranges" hint='e.g. "1-3, 5, 7-9" — comma separated'>
          <Input
            value={(options.ranges as string) || ''}
            onChange={(e) => set('ranges', e.target.value)}
            placeholder="1-3, 5, 7-9"
            className="font-mono"
          />
        </OptionRow>
      )}
    </div>
  )
}

function RotateOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const angle = Number(options.angle ?? 90)
  return (
    <OptionRow label="Rotation" hint="Direction is clockwise.">
      <RadioGroup
        value={String(angle)}
        onValueChange={(v) => set('angle', Number(v))}
        className="grid grid-cols-3 gap-2"
      >
        <RadioCard value="90" label="90°" desc="Clockwise" />
        <RadioCard value="180" label="180°" desc="Upside down" />
        <RadioCard value="270" label="270°" desc="Counter-CW" />
      </RadioGroup>
    </OptionRow>
  )
}

function ImagesOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const output = (options.output as string) || 'single'
  const pageSize = (options.pageSize as string) || 'fit'
  return (
    <div className="space-y-4">
      <OptionRow label="Output" hint="One combined PDF or one per image.">
        <RadioGroup
          value={output}
          onValueChange={(v) => set('output', v)}
          className="grid grid-cols-2 gap-2"
        >
          <RadioCard value="single" label="Single PDF" desc="All images, one file" />
          <RadioCard value="multiple" label="One per image" desc="Separate PDFs" />
        </RadioGroup>
      </OptionRow>
      <OptionRow label="Page size" hint="How images fit on each page.">
        <Select value={pageSize} onValueChange={(v) => set('pageSize', v)}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fit">Fit to image</SelectItem>
            <SelectItem value="a4">A4 (portrait)</SelectItem>
            <SelectItem value="letter">US Letter (portrait)</SelectItem>
          </SelectContent>
        </Select>
      </OptionRow>
    </div>
  )
}

function RadioCard({
  value,
  label,
  desc,
}: {
  value: string
  label: string
  desc: string
}) {
  return (
    <Label
      htmlFor={`r-${value}`}
      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
    >
      <RadioGroupItem value={value} id={`r-${value}`} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="text-sm font-medium leading-tight">{label}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </Label>
  )
}

function CompressOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const level = (options.level as string) || 'normal'
  const levels = [
    {
      id: 'low',
      title: 'Low',
      desc: 'Lossless structural + light image optimization. Text stays selectable.',
      reduction: '~5-15%',
      icon: '📏',
      color: 'emerald',
    },
    {
      id: 'normal',
      title: 'Normal',
      desc: 'Recompresss images at medium quality. Text stays selectable. Recommended.',
      reduction: '~30-60%',
      icon: '⚖️',
      color: 'amber',
    },
    {
      id: 'extreme',
      title: 'Extreme',
      desc: 'Full page rasterization at low resolution. Smallest file, text not selectable.',
      reduction: '~70-90%',
      icon: '🔥',
      color: 'rose',
    },
  ] as const

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {levels.map((lv) => {
          const active = level === lv.id
          return (
            <button
              key={lv.id}
              type="button"
              onClick={() => set('level', lv.id)}
              className={cn(
                'group relative flex flex-col items-start rounded-xl border p-4 text-left transition-all',
                active
                  ? lv.color === 'emerald'
                    ? 'border-emerald-500 bg-emerald-500/5 ring-2 ring-emerald-500/20'
                    : lv.color === 'amber'
                      ? 'border-amber-500 bg-amber-500/5 ring-2 ring-amber-500/20'
                      : 'border-rose-500 bg-rose-500/5 ring-2 ring-rose-500/20'
                  : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
              )}
            >
              <div className="mb-2 flex w-full items-center justify-between">
                <span className="text-2xl">{lv.icon}</span>
                {active && (
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-white',
                      lv.color === 'emerald' && 'bg-emerald-500',
                      lv.color === 'amber' && 'bg-amber-500',
                      lv.color === 'rose' && 'bg-rose-500'
                    )}
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold">{lv.title}</span>
              <span className="mt-1 text-xs text-muted-foreground">{lv.desc}</span>
              <span
                className={cn(
                  'mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  lv.color === 'emerald' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  lv.color === 'amber' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                  lv.color === 'rose' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                )}
              >
                {lv.reduction}
              </span>
            </button>
          )
        })}
      </div>
      {level === 'extreme' ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-muted-foreground">
          <span className="mt-0.5">⚠️</span>
          <span>
            Pages are converted to images — text won't be selectable after
            compression. Choose <strong>Low</strong> or <strong>Normal</strong> to keep text selectable.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
          <span className="mt-0.5">✓</span>
          <span>
            Text stays fully selectable — only embedded images are recompressed.
            Choose <strong>Extreme</strong> for maximum compression (text becomes images).
          </span>
        </div>
      )}
    </div>
  )
}

function UnlockOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const password = (options.password as string) || ''
  return (
    <div className="space-y-4">
      <OptionRow
        label="Password"
        hint="Only needed if the PDF needs a password to open."
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => set('password', e.target.value)}
          placeholder="Leave empty for permission-only protection"
          autoComplete="off"
        />
      </OptionRow>
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-muted-foreground">
        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <span>
          Removes owner-password restrictions (printing, copying, editing).
          PDFs that open without a password are unlocked instantly. For PDFs
          that require a password to open, enter it above — if it can't be
          decrypted in-browser, you'll get a clear error.
        </span>
      </div>
    </div>
  )
}

function PageNumberOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const position = (options.position as string) || 'bottom-center'
  const fontSize = Number(options.fontSize ?? 11)
  const format = (options.format as string) || '{n}'
  const startNumber = Number(options.startNumber ?? 1)
  const margin = Number(options.margin ?? 28)
  return (
    <div className="space-y-4">
      <OptionRow label="Position" hint="Where the number appears on each page.">
        <Select value={position} onValueChange={(v) => set('position', v)}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom-center">Bottom center</SelectItem>
            <SelectItem value="bottom-right">Bottom right</SelectItem>
            <SelectItem value="bottom-left">Bottom left</SelectItem>
            <SelectItem value="top-center">Top center</SelectItem>
            <SelectItem value="top-right">Top right</SelectItem>
            <SelectItem value="top-left">Top left</SelectItem>
          </SelectContent>
        </Select>
      </OptionRow>
      <OptionRow label="Format" hint="Use {n} for the page number, {total} for total.">
        <Input
          value={format}
          onChange={(e) => set('format', e.target.value)}
          placeholder="{n} / {total}"
          className="font-mono"
        />
      </OptionRow>
      <OptionRow label="Start at" hint="First page number value.">
        <Input
          type="number"
          min={1}
          value={startNumber}
          onChange={(e) => set('startNumber', Number(e.target.value) || 1)}
          className="w-full sm:w-[120px]"
        />
      </OptionRow>
      <OptionRow label={`Font size · ${fontSize}pt`} hint="Number text size.">
        <Slider
          value={[fontSize]}
          min={7}
          max={24}
          step={1}
          onValueChange={(v) => set('fontSize', v[0])}
          className="w-full sm:w-[220px]"
        />
      </OptionRow>
      <OptionRow label={`Margin · ${margin}pt`} hint="Distance from the page edge.">
        <Slider
          value={[margin]}
          min={10}
          max={80}
          step={1}
          onValueChange={(v) => set('margin', v[0])}
          className="w-full sm:w-[220px]"
        />
      </OptionRow>
    </div>
  )
}

function WatermarkOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const text = (options.text as string) || 'CONFIDENTIAL'
  const fontSize = Number(options.fontSize ?? 50)
  const opacity = Number(options.opacity ?? 15)
  return (
    <div className="space-y-4">
      <OptionRow label="Watermark text" hint="Diagonal text stamped across every page.">
        <Input
          value={text}
          onChange={(e) => set('text', e.target.value)}
          placeholder="CONFIDENTIAL"
        />
      </OptionRow>
      <OptionRow label={`Font size · ${fontSize}pt`} hint="Larger = more prominent.">
        <Slider
          value={[fontSize]}
          min={20}
          max={120}
          step={5}
          onValueChange={(v) => set('fontSize', v[0])}
          className="w-full sm:w-[220px]"
        />
      </OptionRow>
      <OptionRow label={`Opacity · ${opacity}%`} hint="Transparency of the watermark.">
        <Slider
          value={[opacity]}
          min={5}
          max={80}
          step={5}
          onValueChange={(v) => set('opacity', v[0])}
          className="w-full sm:w-[220px]"
        />
      </OptionRow>
    </div>
  )
}

function ProtectOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const password = (options.password as string) || ''
  const hasPwd = password.length > 0
  return (
    <div className="space-y-4">
      <OptionRow label="Password" hint="Required to open the protected PDF.">
        <Input
          type="password"
          value={password}
          onChange={(e) => set('password', e.target.value)}
          placeholder="Enter a password"
          autoComplete="new-password"
        />
      </OptionRow>
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border p-3.5 text-xs',
          hasPwd
            ? 'border-emerald-500/30 bg-emerald-500/5 text-muted-foreground'
            : 'border-amber-500/30 bg-amber-500/5 text-muted-foreground'
        )}
      >
        <Lock className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', hasPwd ? 'text-emerald-500' : 'text-amber-500')} />
        <span>
          {hasPwd
            ? 'Ready — the PDF will be encrypted with your password. Printing is allowed; editing, copying and annotation are restricted.'
            : 'Enter a password above to enable protection. The password is required to open the resulting PDF.'}
        </span>
      </div>
    </div>
  )
}

function PdfToImagesOptions({
  options,
  set,
}: {
  options: ToolOptionsMap
  set: (key: string, value: unknown) => void
}) {
  const format = (options.format as string) || 'png'
  const scale = Number(options.scale ?? 2)
  return (
    <div className="space-y-4">
      <OptionRow label="Image format" hint="PNG is lossless; JPG is smaller.">
        <RadioGroup
          value={format}
          onValueChange={(v) => set('format', v)}
          className="grid grid-cols-2 gap-2"
        >
          <RadioCard value="png" label="PNG" desc="Lossless quality" />
          <RadioCard value="jpg" label="JPG" desc="Smaller files" />
        </RadioGroup>
      </OptionRow>
      <OptionRow label={`Resolution · ${scale}×`} hint="Higher = sharper but larger.">
        <Slider
          value={[scale]}
          min={1}
          max={4}
          step={1}
          onValueChange={(v) => set('scale', v[0])}
          className="w-full sm:w-[220px]"
        />
      </OptionRow>
    </div>
  )
}
