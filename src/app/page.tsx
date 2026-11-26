import type { Metadata } from 'next'
import Link from 'next/link'
import { Camera, Check, Palette, Share2, Sofa, Sparkles, SwatchBook } from 'lucide-react'
import { BeforeAfterSlider } from '@/components/restyle/before-after-slider'
import { buttonClasses } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { EXAMPLES } from '@/lib/config/examples'
import { CREDIT_PACKS, CREDITS, ENTITLEMENTS, formatUsd, PLANS } from '@/lib/config/pricing'
import { ROUTES, SITE } from '@/lib/config/site'
import { STYLE_PRESETS } from '@/lib/config/styles'

export const metadata: Metadata = {
  title: { absolute: `${SITE.name}: ${SITE.tagline}` },
  description: SITE.description,
  openGraph: {
    title: `${SITE.name}: ${SITE.tagline}`,
    description: SITE.description,
    type: 'website',
  },
}

const STEPS = [
  {
    icon: Camera,
    title: 'Snap your room',
    body: 'Take a photo or pick one you have. Stand in a corner to fit the most in.',
  },
  {
    icon: Sparkles,
    title: 'Pick a new look',
    body: 'A style, a real paint colour, or a photo of your own fabric or tile.',
  },
  {
    icon: Share2,
    title: 'See it and share it',
    body: 'Drag to compare, save your favourites, and post a before-and-after video.',
  },
]

const FAQ = [
  {
    q: 'Does it keep my actual room?',
    a: 'Yes. Your walls, windows, doors, layout and camera angle stay where they are. Only the furniture, colours and finishes change.',
  },
  {
    q: 'Are the paint colours real?',
    a: 'Yes: over 200 popular Benjamin Moore and Sherwin-Williams colours, by name and code. A screen can only approximate paint, so test a sample on your wall before you buy. We are not affiliated with either brand.',
  },
  {
    q: 'What counts as a render?',
    a: 'Each new look uses one render. If a render fails, you get it back automatically. Saving a look in full resolution uses one more.',
  },
  {
    q: 'What happens to my photos?',
    a: 'They are private to your account. We remove location and camera data before storing them, and use them only to make your images.',
  },
  {
    q: 'Is there a watermark?',
    a: 'Free images and videos carry a small RoomFlip mark. Pro removes it and unlocks full-resolution images and full-HD videos.',
  },
  {
    q: 'Can I cancel?',
    a: 'Anytime, from your account. You keep Pro until the end of the period you paid for. Renders you bought in a pack never expire.',
  },
]

function Example({
  pair,
  title,
  caption,
}: {
  pair: { before: string; after: string; width: number; height: number }
  title: string
  caption: string
}) {
  return (
    <figure className="flex flex-col gap-3">
      <BeforeAfterSlider
        before={{ url: pair.before, width: pair.width, height: pair.height }}
        after={{ url: pair.after, width: pair.width, height: pair.height }}
        beforeAlt={`${caption}, before`}
        afterAlt={`${caption}, after`}
      />
      <figcaption className="flex flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-muted text-sm">{caption}</span>
      </figcaption>
    </figure>
  )
}

export default function HomePage() {
  const annual = PLANS.pro_annual
  const weekly = PLANS.pro_weekly
  const annualPerWeek = formatUsd(Math.floor((annual.priceUsd / 52) * 100) / 100)

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href={ROUTES.login} className={buttonClasses({ variant: 'ghost' })}>
            Sign in
          </Link>
          <Link href={ROUTES.app} className={buttonClasses({ variant: 'primary' })}>
            Try it free
          </Link>
        </nav>
      </header>

      <main className="flex flex-col">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pt-6 pb-16 md:grid-cols-2 md:pt-12">
          <div className="flex flex-col gap-6">
            <h1 className="font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl">
              Restyle any room from <em>one photo</em>
            </h1>
            <p className="text-muted text-lg">
              {SITE.description} Try a style, a real paint colour, or your own fabric, then share a
              before-and-after video.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={ROUTES.app} className={buttonClasses({ variant: 'accent', size: 'lg' })}>
                Restyle my room free
              </Link>
              <span className="text-muted text-sm">
                {CREDITS.signupGrant} free renders. No card needed.
              </span>
            </div>
          </div>
          <figure className="flex flex-col gap-2">
            <BeforeAfterSlider
              autoplay
              before={{
                url: EXAMPLES.hero.before,
                width: EXAMPLES.hero.width,
                height: EXAMPLES.hero.height,
              }}
              after={{
                url: EXAMPLES.hero.after,
                width: EXAMPLES.hero.width,
                height: EXAMPLES.hero.height,
              }}
              beforeAlt={`${EXAMPLES.hero.caption}, before`}
              afterAlt={`${EXAMPLES.hero.caption}, after`}
            />
            <figcaption className="text-muted text-center text-sm">
              {EXAMPLES.hero.caption}
              {EXAMPLES.illustration && ' (illustration)'}. Drag to compare.
            </figcaption>
          </figure>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="bg-surface border-line border-y">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-14">
            <h2 id="how-heading" className="font-display text-4xl tracking-tight">
              How it works
            </h2>
            <ol className="grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-3">
                  <span className="bg-accent-soft text-accent flex size-12 items-center justify-center rounded-full">
                    <step.icon aria-hidden="true" className="size-6" />
                  </span>
                  <h3 className="text-lg font-semibold">
                    <span className="text-muted mr-1.5 tabular-nums">{index + 1}.</span>
                    {step.title}
                  </h3>
                  <p className="text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Examples */}
        <section
          aria-labelledby="examples-heading"
          className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-16"
        >
          <div className="flex flex-col gap-2">
            <h2 id="examples-heading" className="font-display text-4xl tracking-tight">
              Three ways to restyle
            </h2>
            {EXAMPLES.illustration && (
              <p className="text-muted text-sm">
                Illustrations of each mode. Your results are photographs of your own room.
              </p>
            )}
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {EXAMPLES.items.map((item) => (
              <Example key={item.id} pair={item} title={item.title} caption={item.caption} />
            ))}
          </div>
          <ul className="grid gap-4 sm:grid-cols-3">
            <li className="flex gap-3">
              <Sofa aria-hidden="true" className="text-accent mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                <span className="font-semibold">{Object.keys(STYLE_PRESETS).length} styles</span>{' '}
                <span className="text-muted">
                  from{' '}
                  {Object.values(STYLE_PRESETS)
                    .slice(0, 3)
                    .map((s) => s.label)
                    .join(', ')}{' '}
                  to Boho, or describe your own.
                </span>
              </p>
            </li>
            <li className="flex gap-3">
              <Palette aria-hidden="true" className="text-accent mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                <span className="font-semibold">200+ real paint colours</span>{' '}
                <span className="text-muted">
                  from Benjamin Moore and Sherwin-Williams, on any wall.
                </span>
              </p>
            </li>
            <li className="flex gap-3">
              <SwatchBook aria-hidden="true" className="text-accent mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                <span className="font-semibold">Your own samples</span>{' '}
                <span className="text-muted">
                  for curtains, sofas, rugs, floors and backsplashes.
                </span>
              </p>
            </li>
          </ul>
        </section>

        {/* Pricing */}
        <section aria-labelledby="pricing-heading" className="bg-surface border-line border-y">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-16">
            <h2 id="pricing-heading" className="font-display text-4xl tracking-tight">
              Pricing
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-card border-line flex flex-col gap-4 border p-6">
                <div>
                  <h3 className="text-lg font-semibold">Free</h3>
                  <p className="text-3xl font-semibold">{formatUsd(0)}</p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li>{CREDITS.signupGrant} renders to start</li>
                  <li>Images up to {ENTITLEMENTS.free.maxImageEdgePx}px, with a small mark</li>
                  <li>{ENTITLEMENTS.free.reel.width}p videos for TikTok and Reels</li>
                </ul>
                <Link
                  href={ROUTES.app}
                  className={buttonClasses({ variant: 'secondary', fullWidth: true })}
                >
                  Start free
                </Link>
              </div>

              <div className="rounded-card border-ink ring-ink relative flex flex-col gap-4 border p-6 ring-1">
                <span className="bg-accent text-accent-ink absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold">
                  Best value
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{annual.name}</h3>
                  <p className="text-3xl font-semibold">
                    {formatUsd(annual.priceUsd)}
                    <span className="text-muted text-base font-normal"> a year</span>
                  </p>
                  <p className="text-muted text-sm">About {annualPerWeek} a week</p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    {annual.credits.amount} renders every month
                  </li>
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    No watermark
                  </li>
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    Full-resolution finals and full-HD videos
                  </li>
                </ul>
                <Link
                  href={ROUTES.app}
                  className={buttonClasses({ variant: 'accent', fullWidth: true })}
                >
                  Get Pro
                </Link>
              </div>

              <div className="rounded-card border-line flex flex-col gap-4 border p-6">
                <div>
                  <h3 className="text-lg font-semibold">{weekly.name}</h3>
                  <p className="text-3xl font-semibold">
                    {formatUsd(weekly.priceUsd)}
                    <span className="text-muted text-base font-normal"> a week</span>
                  </p>
                  <p className="text-muted text-sm">For a project. Cancel anytime.</p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    {weekly.credits.amount} renders every week
                  </li>
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    No watermark
                  </li>
                  <li className="flex gap-2">
                    <Check aria-hidden="true" className="text-accent size-4 shrink-0" />
                    Full-resolution finals and full-HD videos
                  </li>
                </ul>
                <Link
                  href={ROUTES.app}
                  className={buttonClasses({ variant: 'secondary', fullWidth: true })}
                >
                  Get Pro Weekly
                </Link>
              </div>
            </div>
            <p className="text-muted text-sm">
              Or buy renders once, no subscription:{' '}
              {Object.values(CREDIT_PACKS)
                .map((pack) => `${pack.credits} for ${formatUsd(pack.priceUsd)}`)
                .join(' or ')}
              . Bought renders never expire.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section
          aria-labelledby="faq-heading"
          className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-16"
        >
          <h2 id="faq-heading" className="font-display text-4xl tracking-tight">
            Questions
          </h2>
          <div className="border-line divide-line divide-y border-y">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="text-muted text-xl transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted pt-2">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-5 pb-20 text-center">
          <h2 className="font-display text-4xl tracking-tight">See your room in a new light</h2>
          <Link href={ROUTES.app} className={buttonClasses({ variant: 'accent', size: 'lg' })}>
            Restyle my room free
          </Link>
        </section>
      </main>

      <footer className="border-line border-t">
        <div className="text-muted mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] text-sm sm:flex-row sm:justify-between">
          <p>© {SITE.name}</p>
          <p>Not affiliated with Benjamin Moore or Sherwin-Williams. Colours are approximate.</p>
        </div>
      </footer>
    </div>
  )
}
