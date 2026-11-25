import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field as invalid for styling and assistive tech. */
  invalid?: boolean
}

/**
 * Text input. Font size is 16px so iOS Safari does not zoom the page on focus.
 * Always pair it with a <label htmlFor>.
 */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'rounded-control bg-surface text-ink min-h-13 w-full border px-4 text-base',
        'placeholder:text-muted',
        invalid ? 'border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  )
}
