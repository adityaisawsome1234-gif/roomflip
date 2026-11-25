import { Logo } from '@/components/ui/logo'
import { CreditsSlot } from './credits-slot'

/** Slim bar at the top of every signed-in screen: the logo, and a slot on the right. */
export function TopBar() {
  return (
    <header className="bg-bg sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between px-5">
        <Logo />
        <CreditsSlot />
      </div>
    </header>
  )
}
