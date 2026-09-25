'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import { useRef, useState } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import type { TextField } from '@/lib/typing/insert'
import { KeyboardFor, PersianField } from './PersianField'
import { ChallengeFrame, Labelled, gradedState, styles } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'cloze_type'>>

/**
 * Type the missing word (P2): the Persian sentence with an inline input as the blank. The input
 * sits BETWEEN whole-word tokens (no word is ever split) and is its own RTL field; the in-app
 * keyboard, when on, sits below the sentence and types into it.
 */
export function ClozeType(props: Props) {
  const { challenge, display, phase, response, onResponse, onSubmit } = props
  const [text, setText] = useState(() => (response?.kind === 'text' ? response.value : ''))
  const field = useRef<TextField>(null)
  const locked = phase !== 'answering'
  const translit = display.transliteration
  const submit = () => {
    if (text.trim().length > 0) onSubmit()
  }
  const change = (value: string) => {
    setText(value)
    onResponse(value.trim().length > 0 ? { kind: 'text', value } : null)
  }
  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Type the missing word">
      <div>
        <Labelled label="Sentence">
          <div className={styles.cloze} lang="fa" dir="rtl">
            {challenge.before.length > 0 && (
              <FaText
                tokens={challenge.before}
                translit={translit}
                vowels={display.vowelMarks}
                size="lg"
              />
            )}
            <PersianField
              inline
              fieldRef={field}
              value={text}
              onChange={change}
              onEnter={submit}
              locked={locked}
              display={display}
              label="The missing word"
              state={gradedState(phase, props.verdict)}
            />
            {challenge.after.length > 0 && (
              <FaText
                tokens={challenge.after}
                translit={translit}
                vowels={display.vowelMarks}
                size="lg"
              />
            )}
          </div>
        </Labelled>
        <p className={styles.clozeTranslation} lang="en">
          {challenge.translation}
        </p>
      </div>
      <KeyboardFor
        target={() => field.current}
        display={display}
        locked={locked}
        onEnter={submit}
      />
    </ChallengeFrame>
  )
}
