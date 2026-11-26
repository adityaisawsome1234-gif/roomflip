'use client'

import { useEffect, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'

function reload() {
  window.location.reload()
}

function onSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  reload()
}

/**
 * Loads the address the visitor was trying to reach once more. The service
 * worker shows the offline page in place of that address, so a reload is a retry.
 *
 * It is a form so that it works even if this script could not be loaded
 * offline: the browser then submits the form itself, which requests the same
 * path again. With the script running it reloads instead (that keeps the query
 * string), and it also retries by itself as soon as the connection is back.
 */
export function TryAgainButton() {
  useEffect(() => {
    window.addEventListener('online', reload)
    return () => window.removeEventListener('online', reload)
  }, [])

  return (
    <form onSubmit={onSubmit}>
      <Button type="submit" variant="accent" size="lg" fullWidth>
        Try again
      </Button>
    </form>
  )
}
