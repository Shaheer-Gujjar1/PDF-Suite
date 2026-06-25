'use client'

import * as React from 'react'
import { Scissors, RotateCw, Images, FileArchive, LockOpen } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
  return ['split', 'rotate', 'images-to-pdf', 'compress', 'unlock'].includes(toolId)
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
      return { stripMetadata: false }
    case 'unlock':
      return { password: '' }
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
    </div>
  )
}

function SettingsIcon({ toolId }: { toolId: string }) {
  if (toolId === 'split') return <Scissors className="h-4 w-4" />
  if (toolId === 'rotate') return <RotateCw className="h-4 w-4" />
  if (toolId === 'compress') return <FileArchive className="h-4 w-4" />
  if (toolId === 'unlock') return <LockOpen className="h-4 w-4" />
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
  const strip = !!options.stripMetadata
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
        <Checkbox
          id="strip-meta"
          checked={strip}
          onCheckedChange={(v) => set('stripMetadata', v === true)}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <Label htmlFor="strip-meta" className="cursor-pointer text-sm font-medium">
            Strip metadata
          </Label>
          <p className="text-xs text-muted-foreground">
            Remove title, author, keywords and other document properties for a
            smaller, more private file. Text stays fully selectable.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs text-muted-foreground">
        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span>
          Lossless compression — rewrites object streams and removes structural
          bloat while keeping all text, images and vectors intact. Best results
          on PDFs saved without compression or with verbose structure.
        </span>
      </div>
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
