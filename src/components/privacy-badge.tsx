'use client'

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PrivacyBadgeProps {
  className?: string
  variant?: 'solid' | 'soft' | 'minimal'
  size?: 'sm' | 'md'
}

export function PrivacyBadge({
  className,
  variant = 'soft',
  size = 'md',
}: PrivacyBadgeProps) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  const styles =
    variant === 'solid'
      ? 'bg-emerald-600 text-white'
      : variant === 'minimal'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        pad,
        styles,
        className
      )}
    >
      <ShieldCheck className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      Files are processed locally in your browser. 100% private.
    </span>
  )
}
