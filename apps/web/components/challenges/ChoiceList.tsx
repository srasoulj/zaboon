'use client'
import { ChoiceCard } from '@zaboon/ui'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { styles, type ChoiceControl } from './shared'

export interface ChoiceListProps {
  control: ChoiceControl
  options: readonly ReactNode[]
  /** Group name for screen readers. */
  label?: string
  /** Picture options (select_image): a 2×2 grid. */
  media?: readonly ReactNode[]
  className?: string
}

/** Radio-like list of `ChoiceCard`s (aria-pressed) with 1–9 hints; locked cards stay readable. */
export function ChoiceList({
  control,
  options,
  label = 'Choices',
  media,
  className,
}: ChoiceListProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(media ? styles.imageGrid : styles.choices, className)}
    >
      {options.map((option, i) => {
        const state = control.stateOf(i)
        return (
          <ChoiceCard
            key={i}
            index={i + 1}
            // A graded card shows its verdict colours (the kit's pressed style would override them).
            selected={control.selected === i && state === undefined}
            {...(media ? { className: styles.mediaCard } : {})}
            state={state}
            aria-disabled={control.locked || undefined}
            onSelect={() => control.pick(i)}
            {...(media ? { media: media[i] } : {})}
          >
            {option}
          </ChoiceCard>
        )
      })}
    </div>
  )
}
