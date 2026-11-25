import { Suspense, type ReactNode } from 'react'
import { TabBar, TabBarFallback } from './tab-bar'
import { TopBar } from './top-bar'

/**
 * The frame around every signed-in screen: top bar, page content, bottom tab
 * bar. It stays a phone-width column on any screen, so on a desktop the app
 * looks like the phone app rather than a stretched page.
 *
 * Nothing here reads the session, so the whole frame is prerendered.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="border-line mx-auto flex w-full max-w-md flex-1 flex-col sm:border-x">
      <TopBar />
      {/* The bottom padding is the tab bar's height plus breathing room. */}
      <main className="flex flex-1 flex-col px-5 pt-2 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+1.5rem)]">
        {children}
      </main>
      <Suspense fallback={<TabBarFallback />}>
        <TabBar />
      </Suspense>
    </div>
  )
}
