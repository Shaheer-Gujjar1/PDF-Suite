'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Github, Menu, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/theme-toggle'
import { Logo } from '@/components/logo'
import { categories } from '@/lib/tools'
import { cn } from '@/lib/utils'

interface SiteHeaderProps {
  current: string
  onNavigate: (to: string) => void
}

export function SiteHeader({ current, onNavigate }: SiteHeaderProps) {
  const isHome = current === '/' || current === ''
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (to: string) => onNavigate(to)

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full transition-all duration-300',
        scrolled
          ? 'glass border-b border-border/60 shadow-sm'
          : 'border-b border-transparent'
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          onClick={() => go('/')}
          className="group flex items-center transition-opacity hover:opacity-90"
          aria-label="Go to homepage"
        >
          <Logo />
        </button>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          <button
            onClick={() => go('/')}
            className={cn(
              'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
              isHome
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All tools
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => go('/')}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {c.name}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => go('/')}
          >
            <Sparkles className="mr-1.5 h-4 w-4 text-primary" />
            Batch — free
          </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-flex"
            aria-label="Source code"
          >
            <Github className="h-[1.1rem] w-[1.1rem]" />
          </a>
          <ThemeToggle />

          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden rounded-full"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="flex h-full flex-col gap-2 p-4">
                <SheetClose asChild>
                  <button
                    onClick={() => go('/')}
                    className="flex items-center justify-start"
                  >
                    <Logo />
                  </button>
                </SheetClose>
                <div className="mt-4 flex flex-col gap-1">
                  <SheetClose asChild>
                    <Button
                      variant={isHome ? 'secondary' : 'ghost'}
                      className="justify-start"
                      onClick={() => go('/')}
                    >
                      All tools
                    </Button>
                  </SheetClose>
                  {categories.map((c) => (
                    <SheetClose asChild key={c.id}>
                      <Button
                        variant="ghost"
                        className="justify-start font-normal text-muted-foreground"
                        onClick={() => go('/')}
                      >
                        {c.name}
                      </Button>
                    </SheetClose>
                  ))}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
