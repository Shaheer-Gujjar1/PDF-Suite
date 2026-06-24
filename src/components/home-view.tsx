'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Search,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Zap,
  Layers,
  Lock,
  Sparkles,
  Upload,
  Wand2,
  Download,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PrivacyBadge } from '@/components/privacy-badge'
import { ToolCard } from '@/components/tool-card'
import {
  categories,
  tools,
  toolsByCategory,
  categoryMeta,
  accentClasses,
} from '@/lib/tools'
import { cn } from '@/lib/utils'

interface HomeViewProps {
  onNavigate: (to: string) => void
}

const stats = [
  { value: '20+', label: 'PDF tools' },
  { value: '100%', label: 'Client-side' },
  { value: '∞', label: 'Batch files' },
  { value: '$0', label: 'Forever' },
]

const trust = [
  { icon: Lock, label: 'No uploads, ever' },
  { icon: Cpu, label: 'WASM accelerated' },
  { icon: Layers, label: 'Free batch processing' },
  { icon: Zap, label: 'Works offline' },
]

const features = [
  {
    icon: ShieldCheck,
    title: 'Radically private',
    body: 'Every byte stays on your device. There is no server — files are never uploaded, logged, or stored anywhere but your browser.',
    accent: 'emerald' as const,
  },
  {
    icon: Layers,
    title: 'Batch by default',
    body: 'Drop 50 files at once. Compress, convert or merge whole folders in a single run — the feature others charge for, free.',
    accent: 'rose' as const,
  },
  {
    icon: Cpu,
    title: 'WASM heavy lifting',
    body: 'Deep compression, repair and unlocking run on WebAssembly ports of QPDF and MuPDF inside Web Workers — buttery smooth.',
    accent: 'amber' as const,
  },
  {
    icon: Sparkles,
    title: 'Premium experience',
    body: 'A meticulously crafted interface with delightful motion, dark mode and thoughtful micro-interactions at every step.',
    accent: 'fuchsia' as const,
  },
]

const steps = [
  {
    icon: Upload,
    title: 'Drop your files',
    body: 'Drag in one file or fifty. Everything is read locally — nothing leaves your machine.',
  },
  {
    icon: Wand2,
    title: 'Process instantly',
    body: 'Pick a tool and let Web Workers handle the heavy lifting without freezing your browser.',
  },
  {
    icon: Download,
    title: 'Download results',
    body: 'Grab a single file or a tidy ZIP. Your processed files never touch a server.',
  },
]

export function HomeView({ onNavigate }: HomeViewProps) {
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    )
  }, [query])

  const open = (id: string) => onNavigate(`/${id}`)

  return (
    <div>
      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-grid bg-grid-fade opacity-60" />
          <div className="absolute -top-32 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-rose-500/20 blur-[120px]" />
          <div className="absolute top-10 right-[8%] h-[280px] w-[280px] rounded-full bg-amber-400/15 blur-[100px]" />
          <div className="absolute top-24 left-[6%] h-[240px] w-[240px] rounded-full bg-fuchsia-400/15 blur-[100px]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-3xl text-center"
          >
            <div className="mb-6 flex justify-center">
              <PrivacyBadge variant="soft" />
            </div>

            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl lg:text-[4.25rem] lg:leading-[1.05]">
              Every PDF tool you need.
              <br />
              <span className="text-gradient">All in one place.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
              A premium, 100% client-side PDF suite. Merge, split, compress,
              convert, edit, sign and secure — all in your browser. With free,
              unlimited batch processing.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="h-12 rounded-full px-7 text-base" onClick={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })}>
                Explore tools
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full px-7 text-base"
                onClick={() => open('merge')}
              >
                <Layers className="mr-2 h-4 w-4" />
                Try Merge PDF
              </Button>
            </div>

            <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border/60 bg-card/60 px-4 py-4 backdrop-blur"
                >
                  <dt className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {s.value}
                  </dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                    {s.label}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </div>
      </section>

      {/* ============ TRUST BAR ============ */}
      <section className="border-y border-border/60 bg-secondary/30">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6 lg:px-8">
          {trust.map((t) => (
            <span
              key={t.label}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"
            >
              <t.icon className="h-4 w-4 text-primary" />
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* ============ TOOLS ============ */}
      <section id="tools" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              A complete PDF toolbox
            </h2>
            <p className="mt-3 text-muted-foreground">
              {tools.length} tools across {categories.length} categories — all
              free, all private, all in your browser.
            </p>
          </div>

          {/* Search */}
          <div className="mx-auto mt-8 max-w-xl">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools — e.g. compress, merge, word to pdf…"
                className="h-12 rounded-full border-border/70 pl-11 pr-4 text-base shadow-sm"
              />
            </div>
          </div>

          {/* Grid by category */}
          <div className="mt-14 space-y-16">
            {categories.map((cat) => {
              const list = filtered.filter((t) => t.category === cat.id)
              if (list.length === 0) return null
              const a = accentClasses[cat.accent]
              return (
                <div key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-20">
                  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={cn('h-2.5 w-2.5 rounded-full', a.dot)} />
                      <div>
                        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
                          {cat.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {cat.tagline}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full">
                      {toolsByCategory(cat.id).length} tools
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {list.map((tool, i) => (
                      <ToolCard
                        key={tool.id}
                        tool={tool}
                        onOpen={open}
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                <p className="text-muted-foreground">
                  No tools match “{query}”. Try another search.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="border-t border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Why PDF Suite
            </h2>
            <p className="mt-3 text-muted-foreground">
              Built to rival the best — minus the uploads, paywalls and limits.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f, i) => {
              const a = accentClasses[f.accent]
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="rounded-2xl border border-border/70 bg-card p-6"
                >
                  <span
                    className={cn(
                      'mb-4 grid h-11 w-11 place-items-center rounded-xl ring-1',
                      a.badge,
                      a.ring
                    )}
                  >
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-base font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Three steps. Zero uploads.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="relative rounded-2xl border border-border/70 bg-card p-7"
              >
                <span className="absolute right-6 top-6 text-5xl font-bold text-muted/60">
                  {i + 1}
                </span>
                <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="h-6 w-6" />
                </span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-rose-500 to-pink-600 px-6 py-14 text-center text-white shadow-xl shadow-rose-500/20 sm:px-12">
            <div className="pointer-events-none absolute inset-0 bg-dots opacity-20" />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Ready to work with your PDFs — privately?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/85">
                No sign-up. No uploads. No limits. Pick a tool and get started
                in seconds.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  variant="secondary"
                  className="h-12 rounded-full px-7 text-base text-rose-600 hover:text-rose-700"
                  onClick={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Browse all tools
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2 text-sm text-white/80">
                  <CheckCircle2 className="h-4 w-4" /> Free forever
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
