'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

function reload() {
  window.location.reload()
}

/**
 * Reloads the address the visitor was trying to reach. The service worker
 * shows the offline page in place of that address, so a reload is a retry.
 * Also retries by itself as soon as the browser reports a connection.
 */
export function TryAgainButton() {
  useEffect(() => {
    window.addEventListener('online', reload)
    return () => window.removeEventListener('online', reload)
  }, [])

  return (
    <Button variant="accent" size="lg" onClick={reload}>
      Try again
    </Button>
  )
}
