import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors ' +
  'select-none disabled:cursor-not-allowed disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-bg hover:opacity-90 active:opacity-80',
  accent: 'bg-accent text-accent-ink hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-ink hover:bg-surface-sunken',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
}

// Both sizes clear the 44px minimum touch target.
const sizes: Record<Size, string> = {
  md: 'min-h-11 px-5 text-[15px]',
  lg: 'min-h-13 px-6 text-base',
}

export interface ButtonStyleProps {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

/** Class names for a button. Use directly on a <Link> that should look like a button. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: ButtonStyleProps = {}): string {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full')
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size, fullWidth }), className)}
      {...props}
    />
  )
}
