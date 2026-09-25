// Imported by every dom test in this package: vitest runs without globals, so Testing Library
// cannot register its automatic cleanup; do it here (the shared setup file is orchestrator-owned).
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
