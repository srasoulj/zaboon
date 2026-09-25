'use client'
import { useState } from 'react'
import { BottomSheet, Button3D } from '@zaboon/ui'
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'
import { itemRef } from '@zaboon/content-schema'
import type { z } from 'zod'
import type { CreateReportRequest, ReportKind } from '@zaboon/contracts'

type Kind = z.infer<typeof ReportKind>

const OPTIONS: { kind: Kind; label: string }[] = [
  { kind: 'answer_should_be_accepted', label: 'My answer should be accepted' },
  { kind: 'audio_problem', label: 'The audio has a problem' },
  { kind: 'content_error', label: 'Something in the challenge is wrong' },
  { kind: 'other', label: 'Something else' },
]

/** The item a report is about: the challenge's first content item. */
export function reportItemRef(challenge: Challenge): string | null {
  for (const id of challenge.ref.items) {
    if (id.startsWith('lx_')) return itemRef('lexeme', id)
    if (id.startsWith('s_')) return itemRef('sentence', id)
    if (id.startsWith('l_')) return itemRef('letter', id)
    if (id.startsWith('c_')) return itemRef('chat', id)
  }
  return null
}

/** The learner's answer as text, for "my answer should be accepted". */
export function answerText(response: ChallengeResponse | null): string | undefined {
  if (!response) return undefined
  if (response.kind === 'text') return response.value.slice(0, 500)
  if (response.kind === 'tiles') return response.value.join(' ').slice(0, 500)
  return undefined
}

export interface ReportSheetProps {
  open: boolean
  onClose: () => void
  challenge: Challenge
  sessionId: string
  response: ChallengeResponse | null
  submit: (body: z.input<typeof CreateReportRequest>) => Promise<unknown>
}

/** The report flag's small sheet (LEARNING-ENGINE §4.5 report loop): posts createReport. */
export function ReportSheet({
  open,
  onClose,
  challenge,
  sessionId,
  response,
  submit,
}: ReportSheetProps) {
  const [kind, setKind] = useState<Kind | null>(null)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const ref = reportItemRef(challenge)
  const answer = answerText(response)
  const options = OPTIONS.filter(
    (o) => o.kind !== 'answer_should_be_accepted' || answer !== undefined,
  )

  const close = () => {
    onClose()
    setKind(null)
    setText('')
    setState('idle')
  }
  const send = async () => {
    if (!kind || !ref) return
    setState('sending')
    try {
      await submit({
        itemRef: ref,
        kind,
        sessionId,
        ...(kind === 'answer_should_be_accepted' && answer !== undefined ? { answer } : {}),
        ...(text.trim() ? { text: text.trim().slice(0, 1000) } : {}),
      })
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={state === 'sent' ? 'Thanks for the report!' : 'Report a problem'}
      description={state === 'sent' ? 'Our team will take a look.' : undefined}
      actions={
        state === 'sent' ? (
          <Button3D onClick={close} fullWidth>
            Done
          </Button3D>
        ) : (
          <Button3D
            variant={kind && ref ? 'secondary' : 'locked'}
            loading={state === 'sending'}
            onClick={() => void send()}
            fullWidth
            data-testid="report-submit"
          >
            Send report
          </Button3D>
        )
      }
    >
      {state !== 'sent' && (
        <form
          data-testid="report-sheet"
          className="flex flex-col gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="zb-sr-only">What went wrong?</legend>
            {options.map((o) => (
              <label
                key={o.kind}
                className="flex items-center gap-3 rounded-[12px] border-2 border-line px-3 py-2"
              >
                <input
                  type="radio"
                  name="report-kind"
                  value={o.kind}
                  checked={kind === o.kind}
                  onChange={() => setKind(o.kind)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-stone">
            <span>Anything else? (optional)</span>
            <textarea
              value={text}
              maxLength={1000}
              rows={2}
              onChange={(e) => setText(e.target.value)}
              className="rounded-[12px] border-2 border-line p-2 text-ink"
            />
          </label>
          {state === 'failed' && (
            <p role="alert" className="text-anar-600">
              Couldn&apos;t send the report. Please try again.
            </p>
          )}
        </form>
      )}
    </BottomSheet>
  )
}
