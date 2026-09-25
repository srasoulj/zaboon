'use client'
import { Button3D } from '@zaboon/ui'

/** Reloads the current URL (the offline fallback is served in place of the page that failed). */
export function ReloadButton({ children = 'Try again' }: { children?: string }) {
  return <Button3D onClick={() => window.location.reload()}>{children}</Button3D>
}
