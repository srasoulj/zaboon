/**
 * Shares one in-flight promise per key: a second caller while the first is pending gets the same
 * promise, and the key is freed when it settles. The player uses it so a remount (React StrictMode
 * restarts the machine in development) doesn't create a second session for the same lesson.
 */
export function createInFlight<T>() {
  const pending = new Map<string, Promise<T>>()
  return {
    run(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = pending.get(key)
      if (existing) return existing
      const p = fn().finally(() => {
        if (pending.get(key) === p) pending.delete(key)
      })
      pending.set(key, p)
      return p
    },
    has: (key: string) => pending.has(key),
  }
}
