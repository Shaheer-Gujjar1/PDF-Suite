'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Search, Lock, Cpu, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PrivacyBadge } from '@/components/privacy-badge'
import { ToolCard } from '@/components/tool-card'
import {
  categories,
  tools,
  type ToolCategory,
} from '@/lib/tools'
import { cn } from '@/lib/utils'

interface HomeViewProps {
  onNavigate: (to: string) => void
}

type FilterCategory = 'all' | ToolCategory

export function HomeView({ onNavigate }: HomeViewProps) {
  const [query, setQuery] = React.useState('')
  const [activeCategory, setActiveCategory] = React.useState<FilterCategory>('all')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = activeCategory === 'all'
      ? tools
      : tools.filter((t) => t.category === activeCategory)
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      )
    }
    return list
  }, [query, activeCategory])

  const open = (id: string) => onNavigate(`/${id}`)

  const filterPills: { id: FilterCategory; label: string }[] = [
    { id: 'all', label: 'All tools' },
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {/* Compact hero */}
      <div className="mb-8 text-center sm:mb-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-4 flex justify-center">
            <PrivacyBadge size="sm" />
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Every PDF tool you need
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-muted-foreground sm:text-base">
            Merge, split, compress, convert, edit and secure — all in your
            browser. Free, private, with unlimited batch processing.
          </p>
        </motion.div>
      </div>

      {/* Search */}
      <div className="mx-auto mb-6 max-w-xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="h-12 rounded-full border-border/70 pl-11 pr-4 text-base shadow-sm"
          />
        </div>
      </div>

      {/* Category filter pills */}
      <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
        {filterPills.map((pill) => (
          <button
            key={pill.id}
            onClick={() => setActiveCategory(pill.id)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition-colors',
              activeCategory === pill.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/70'
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Tool grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((tool, i) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onOpen={open}
              index={i}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center">
          <p className="text-muted-foreground">
            No tools match “{query}”.
          </p>
        </div>
      )}

      {/* Trust badges (minimal, inline) */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border/60 pt-6 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-4 w-4 text-emerald-500" /> 100% private
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="h-4 w-4 text-amber-500" /> WASM powered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-rose-500" /> Free batch processing
        </span>
      </div>
    </div>
  )
}
