'use client'

import { Lock, Cpu, Zap, Heart } from 'lucide-react'
import { categories } from '@/lib/tools'

interface SiteFooterProps {
  onNavigate: (to: string) => void
}

export function SiteFooter({ onNavigate }: SiteFooterProps) {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-auto border-t border-border/60 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/30">
                <span className="text-sm font-bold">P</span>
              </span>
              <span className="text-base font-semibold tracking-tight">
                PDF Suite
              </span>
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              The premium, all-in-one PDF toolkit that runs entirely in your
              browser. No uploads, no servers, no compromises.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                <Lock className="h-3.5 w-3.5" /> 100% Private
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20">
                <Cpu className="h-3.5 w-3.5" /> WASM powered
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20">
                <Zap className="h-3.5 w-3.5" /> Free batch
              </span>
            </div>
          </div>

          {categories.slice(0, 3).map((c) => (
            <div key={c.id} className="space-y-3">
              <h4 className="text-sm font-semibold">{c.name}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <button
                    onClick={() => onNavigate('/')}
                    className="transition-colors hover:text-foreground"
                  >
                    {c.tagline}
                  </button>
                </li>
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:flex-row">
          <p>© {year} PDF Suite. Built for privacy.</p>
          <p className="inline-flex items-center gap-1.5">
            Made with <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" /> using React, Tailwind &amp; WebAssembly
          </p>
        </div>
      </div>
    </footer>
  )
}
