import { cn } from '@/lib/cn'
import { SITE } from '@/lib/config/site'

/**
 * The mark: a rounded square split on the diagonal, "before" on one side and
 * "after" on the other. The same shape is used for the app icon.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7', className)}>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <path d="M32 9a9 9 0 0 0-9-9h-3L9 32h14a9 9 0 0 0 9-9V9Z" className="fill-accent" />
      <path d="M20 0 9 32" className="stroke-bg" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">{SITE.name}</span>
    </span>
  )
}
