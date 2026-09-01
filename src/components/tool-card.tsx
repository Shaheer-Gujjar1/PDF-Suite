'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Layers, Lock } from 'lucide-react'
import { type Tool, accentClasses } from '@/lib/tools'
import { isImplemented } from '@/lib/processing/registry'
import { cn } from '@/lib/utils'

interface ToolCardProps {
  tool: Tool
  onOpen: (id: string) => void
  index?: number
}

export function ToolCard({ tool, onOpen, index = 0 }: ToolCardProps) {
  const Icon = tool.icon
  const a = accentClasses[tool.accent]
  const ready = isImplemented(tool.id)

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(tool.id)}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className={cn(
        'group relative flex h-full w-full flex-col items-start rounded-2xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-300',
        'hover:border-border hover:shadow-xl hover:shadow-black/5',
        a.glow
      )}
    >
      {/* top row */}
      <div className="mb-4 flex w-full items-start justify-between">
        <span
          className={cn(
            'grid h-12 w-12 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105',
            a.badge,
            a.ring
          )}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="flex flex-col items-end gap-1.5">
          {tool.batch && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
              <Layers className="h-3 w-3" /> Batch
            </span>
          )}
          {tool.tag && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {tool.tag}
            </span>
          )}
          {!ready && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          )}
          {tool.locked && (
            <span
              title="Locked — stable & production-ready, do not modify unless explicitly asked"
              className="inline-flex items-center rounded-full bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400"
            >
              <Lock className="h-2.5 w-2.5" />
            </span>
          )}
        </div>
      </div>

      <h3 className="text-base font-semibold leading-tight">{tool.name}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
        {tool.description}
      </p>

      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-all duration-300 group-hover:opacity-100">
        Open tool
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </motion.button>
  )
}
