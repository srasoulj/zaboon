'use client'
// Placeholder renderer (owned by ws-renderers, who replace it with one component per type).
import { Button3D } from '@zaboon/ui'
import type { Challenge } from '@zaboon/contracts'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'

export function PlaceholderRenderer<C extends Challenge>({
  challenge,
  onResponse,
  phase,
}: ChallengeRendererProps<C>) {
  return (
    <div
      data-testid="challenge-placeholder"
      className="flex flex-col items-center gap-4 text-center"
    >
      <p className="text-stone">This challenge type ({challenge.type}) is not built yet.</p>
      <Button3D
        variant="secondary"
        disabled={phase !== 'answering'}
        onClick={() => onResponse({ kind: 'skip' })}
      >
        Skip it
      </Button3D>
    </div>
  )
}
