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
    <div className="border-line mx-auto flex w-full max-w-md flex-1 flex-col pb-[env(safe-area-inset-bottom)] sm:border-x">
      <TopBar />
      <main className="flex flex-1 flex-col px-5 pt-2 pb-6">{children}</main>
      {/* Reserves the space the fixed tab bar covers, so the end of a page is never hidden behind it. */}
      <div aria-hidden="true" className="h-tabbar shrink-0" />
      {/* usePathname() suspends while a page with a dynamic segment is prerendered. */}
      <Suspense fallback={<TabBarFallback />}>
        <TabBar />
      </Suspense>
    </div>
  )
}
