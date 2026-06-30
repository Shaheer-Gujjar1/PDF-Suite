'use client'

import * as React from 'react'
import { Loader2, FileText } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePdfThumbnails } from '@/hooks/use-pdf'
import { cn } from '@/lib/utils'

export interface SplitConfig {
  mode: 'each' | 'ranges'
  ranges: string
}

interface SplitViewProps {
  file: File
  config: SplitConfig
  onConfigChange: (config: SplitConfig) => void
}

/** Parse "1-3, 5, 7-9" into groups of 0-indexed page indices. */
function parseRanges(text: string, pageCount: number): number[][] {
  const groups: number[][] = []
  const parts = text.split(',')
  for (const raw of parts) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const dash = trimmed.indexOf('-')
    let start: number, end: number
    if (dash >= 0) {
      start = parseInt(trimmed.slice(0, dash), 10)
      end = parseInt(trimmed.slice(dash + 1), 10)
    } else {
      start = end = parseInt(trimmed, 10)
    }
    if (isNaN(start) || isNaN(end) || start < 1 || end < 1) continue
    if (start > end) { const t = start; start = end; end = t }
    const group: number[] = []
    for (let p = start; p <= end && p <= pageCount; p++) group.push(p - 1)
    if (group.length) groups.push(group)
  }
  return groups
}

export function SplitView({ file, config, onConfigChange }: SplitViewProps) {
  const { pages, loading, error } = usePdfThumbnails(file, 50, 0.35)
  const pageCount = pages.length

  // Parse ranges in real-time for the preview
  const parsedGroups = React.useMemo(() => {
    if (config.mode !== 'ranges' || !config.ranges.trim()) return []
    return parseRanges(config.ranges, pageCount)
  }, [config.mode, config.ranges, pageCount])

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Rendering {pageCount > 0 ? '' : 'page'} thumbnails…</p>
    </div>
  )
  if (error) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
      {error}
    </div>
  )
  if (pageCount === 0) return null

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Split mode</Label>
        <RadioGroup
          value={config.mode}
          onValueChange={(v) => onConfigChange({ ...config, mode: v as 'each' | 'ranges' })}
          className="grid grid-cols-2 gap-2"
        >
          <Label htmlFor="r-each" className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <RadioGroupItem value="each" id="r-each" className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">Each page</span>
              <span className="text-xs text-muted-foreground">One PDF per page ({pageCount} files)</span>
            </span>
          </Label>
          <Label htmlFor="r-ranges" className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <RadioGroupItem value="ranges" id="r-ranges" className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">Custom ranges</span>
              <span className="text-xs text-muted-foreground">Define page groups</span>
            </span>
          </Label>
        </RadioGroup>
      </div>

      {/* Range input (only for custom ranges mode) */}
      {config.mode === 'ranges' && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Page ranges</Label>
          <Input
            value={config.ranges}
            onChange={(e) => onConfigChange({ ...config, ranges: e.target.value })}
            placeholder="e.g. 1-3, 5, 7-9"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Enter page numbers separated by commas. Use hyphens for ranges (e.g. 1-3, 5, 7-9).
            This PDF has {pageCount} pages.
          </p>
        </div>
      )}

      {/* Page previews */}
      {config.mode === 'each' ? (
        /* Each page mode: show ALL page thumbnails */
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Preview — each page becomes a separate PDF:
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {pages.map((page) => (
              <div key={page.pageNum} className="rounded-lg border border-border bg-card p-1.5">
                <div className="relative aspect-[3/4] overflow-hidden rounded bg-muted">
                  <img src={page.dataUrl} alt={`Page ${page.pageNum}`} className="h-full w-full object-contain" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {page.pageNum}
                  </span>
                </div>
                <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">
                  → page-{page.pageNum}.pdf
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Custom ranges mode: show start + end page of each parsed group */
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Preview — {parsedGroups.length > 0
              ? `${parsedGroups.length} output file${parsedGroups.length > 1 ? 's' : ''} will be created:`
              : 'enter a valid range to see the preview'}
          </p>
          {parsedGroups.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parsedGroups.map((group, idx) => {
                const startPage = group[0] + 1
                const endPage = group[group.length - 1] + 1
                const startThumb = pages[group[0]]
                const endThumb = pages[group[group.length - 1]]
                const isSinglePage = startPage === endPage
                return (
                  <div key={idx} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        Output {idx + 1}
                      </span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {isSinglePage ? `Page ${startPage}` : `Pages ${startPage}-${endPage}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      {/* Start page thumbnail */}
                      <div className="relative">
                        <div className="relative aspect-[3/4] w-20 overflow-hidden rounded border border-border bg-muted sm:w-24">
                          {startThumb ? (
                            <img src={startThumb.dataUrl} alt={`Page ${startPage}`} className="h-full w-full object-contain" />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <FileText className="h-5 w-5 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-0.5 text-[8px] font-medium text-white">
                          {startPage}
                        </span>
                      </div>
                      {/* Arrow between start and end (if different) */}
                      {!isSinglePage && (
                        <>
                          <span className="text-lg text-muted-foreground">→</span>
                          <div className="relative">
                            <div className="relative aspect-[3/4] w-20 overflow-hidden rounded border border-border bg-muted sm:w-24">
                              {endThumb ? (
                                <img src={endThumb.dataUrl} alt={`Page ${endPage}`} className="h-full w-full object-contain" />
                              ) : (
                                <div className="flex h-full items-center justify-center">
                                  <FileText className="h-5 w-5 text-muted-foreground/40" />
                                </div>
                              )}
                            </div>
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-0.5 text-[8px] font-medium text-white">
                              {endPage}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="mt-2 truncate text-center text-[10px] text-muted-foreground">
                      → {isSinglePage
                        ? `page-${startPage}.pdf`
                        : `pages-${startPage}-${endPage}.pdf`}
                    </p>
                    <p className="text-center text-[10px] text-muted-foreground/70">
                      {group.length} page{group.length > 1 ? 's' : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border py-12 text-center">
              <p className="text-sm text-muted-foreground">
                Enter page ranges above to see a live preview of each output file.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
