import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Logo } from '@/components/ui/logo'
import { safeNextPath } from '@/lib/auth/redirects'
import { ROUTES, SITE } from '@/lib/config/site'
import { publicEnv } from '@/lib/env'
import { urlErrorMessage } from './sign-in'
import { SignInFlowProvider, SignInHeading } from './sign-in-flow'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to ${SITE.name} with a link or code sent to your email. No password needed.`,
}

/**
 * Sign-in screen. The logo and heading are static and prerender; the form
 * depends on the URL (`next`, `error`), so it streams in behind Suspense.
 */
export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-8 pt-[calc(env(safe-area-inset-top)+3rem)] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[calc(env(safe-area-inset-bottom)+2rem)] pl-[max(1.5rem,env(safe-area-inset-left))] sm:justify-center sm:pt-12 sm:pb-12">
      <Link href={ROUTES.home} aria-label={`${SITE.name} home`} className="self-start">
        <Logo />
      </Link>
      <SignInFlowProvider>
        <SignInHeading />
        <Suspense fallback={<FormPlaceholder />}>
          <SignIn searchParams={searchParams} />
        </Suspense>
      </SignInFlowProvider>
    </main>
  )
}

async function SignIn({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams
  return (
    <SignInForm
      // `next` comes from the URL, so it is untrusted until safeNextPath has seen it.
      next={safeNextPath(params.next)}
      urlError={urlErrorMessage(params.error)}
      googleEnabled={publicEnv.googleAuthEnabled}
    />
  )
}

/** Holds the form's space while it streams in, so nothing jumps. */
function FormPlaceholder() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-surface-sunken h-5 w-12 rounded-full" />
        <div className="rounded-control bg-surface-sunken h-13" />
      </div>
      <div className="bg-surface-sunken h-13 rounded-full" />
    </div>
  )
}
