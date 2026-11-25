import { AppShell } from '@/components/app-shell/app-shell'

/**
 * Layout for the signed-in app. It is static on purpose: it must not read
 * cookies, headers or the session, so it prerenders into the shell that every
 * /app page shares. Signed-out visitors are turned away by the proxy, and each
 * page checks the user itself.
 */
export default function AppLayout({ children }: LayoutProps<'/app'>) {
  return <AppShell>{children}</AppShell>
}
