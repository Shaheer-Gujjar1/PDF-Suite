'use client'

import * as React from 'react'

/**
 * Lightweight hash-based router. Keeps the whole app on the single `/`
 * route (per project constraints) while giving each tool a shareable deep
 * link such as `/#/merge`.
 */
export function useHashRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = React.useState<string>('')

  React.useEffect(() => {
    const read = () => {
      const hash = window.location.hash.replace(/^#/, '')
      // normalize: ensure leading slash
      setPath(hash.startsWith('/') ? hash : hash ? `/${hash}` : '/')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  const navigate = React.useCallback((to: string) => {
    const normalized = to.startsWith('/') ? to : `/${to}`
    if (window.location.hash.replace(/^#/, '') === normalized) {
      setPath(normalized)
      return
    }
    window.location.hash = normalized
    // jump to top on navigation
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  return { path, navigate }
}

export function parseRoute(path: string): { route: 'home' | 'tool'; toolId?: string } {
  const clean = path.replace(/^\/+/, '').trim()
  if (!clean) return { route: 'home' }
  const segments = clean.split('/')
  return { route: 'tool', toolId: segments[0] }
}
