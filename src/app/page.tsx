'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { HomeView } from '@/components/home-view'
import { ToolPage } from '@/components/tool-page'
import { useHashRoute, parseRoute } from '@/lib/use-hash-route'
import { getTool } from '@/lib/tools'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Home() {
  const { path, navigate } = useHashRoute()
  const parsed = parseRoute(path)

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader current={path} onNavigate={navigate} />

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {parsed.route === 'home' || !parsed.toolId ? (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <HomeView onNavigate={navigate} />
            </motion.div>
          ) : (
            <motion.div
              key={parsed.toolId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <ToolRouteView toolId={parsed.toolId} onNavigate={navigate} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <SiteFooter onNavigate={navigate} />
    </div>
  )
}

function ToolRouteView({
  toolId,
  onNavigate,
}: {
  toolId: string
  onNavigate: (to: string) => void
}) {
  const tool = getTool(toolId)

  if (!tool) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-4 py-28 text-center">
        <span className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <FileQuestion className="h-8 w-8" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Tool not found
        </h1>
        <p className="mt-2 text-muted-foreground">
          We couldn’t find a tool called “{toolId}”.
        </p>
        <Button className="mt-6" onClick={() => onNavigate('/')}>
          Back to all tools
        </Button>
      </div>
    )
  }

  return (
    <ToolPage
      tool={tool}
      onNavigate={onNavigate}
      onBack={() => onNavigate('/')}
    />
  )
}
