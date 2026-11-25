import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { ROUTES, SITE } from '@/lib/config/site'

/**
 * Placeholder home page. The full landing page (auto-playing before/after
 * hero, example transformations, pricing, FAQ) is built in milestone 8.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Logo />
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-5xl leading-[1.05] tracking-tight">
          Restyle any room from <em>one photo</em>
        </h1>
        <p className="text-muted text-lg">{SITE.description}</p>
      </div>
      <Link href={ROUTES.app} className={buttonClasses({ variant: 'accent', size: 'lg' })}>
        Try it free
      </Link>
    </main>
  )
}
