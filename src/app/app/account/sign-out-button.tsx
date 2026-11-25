'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

/** Submit button for the sign-out form. Shows that sign-out is under way. */
export function SignOutButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" size="lg" fullWidth disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
