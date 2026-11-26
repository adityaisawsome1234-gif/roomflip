'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleUserRound, Images, Sparkles, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/config/site'

interface Tab {
  href: string
  label: string
  icon: LucideIcon
  /** Active only on exactly this path, not on the pages beneath it. */
  exact?: boolean
}

const TABS: Tab[] = [
  // Every signed-in page lives under /app, so Create must match exactly.
  { href: ROUTES.app, label: 'Create', icon: Sparkles, exact: true },
  { href: ROUTES.rooms, label: 'My rooms', icon: Images },
  { href: ROUTES.account, label: 'Account', icon: CircleUserRound },
]

function isActive(tab: Tab, pathname: string | null): boolean {
  if (!pathname) return false
  if (pathname === tab.href) return true
  return !tab.exact && pathname.startsWith(`${tab.href}/`)
}

/**
 * Fixed bottom navigation for the signed-in app. Its height is the `tabbar`
 * spacing token plus the device's bottom safe area. AppShell reserves the same
 * space under the page content so nothing sits behind the bar.
 */
export function TabBar() {
  return <TabBarView pathname={usePathname()} />
}

/**
 * The tab bar with no tab marked active. Shown while the current path is not
 * known yet, which happens when a page with a dynamic segment is prerendered.
 */
export function TabBarFallback() {
  return <TabBarView pathname={null} />
}

function TabBarView({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="border-line bg-surface fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md pb-[env(safe-area-inset-bottom)] sm:border-x"
    >
      <ul className="border-line h-tabbar flex border-t">
        {TABS.map((tab) => {
          const active = isActive(tab, pathname)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full min-h-11 flex-col items-center justify-center gap-1 text-xs font-medium',
                  // Draw the focus ring inside the tab: outside it, the screen edge would clip it.
                  // Important, because the global :focus-visible rule sets the offset too.
                  '-outline-offset-2! transition-colors',
                  active ? 'text-accent' : 'text-muted hover:text-ink',
                )}
              >
                <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.25 : 1.75} />
                <span>{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
