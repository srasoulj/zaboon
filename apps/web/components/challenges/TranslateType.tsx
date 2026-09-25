'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { PersianField } from './PersianField'
import { TranslationPrompt } from './TranslateBank'
import { ChallengeFrame, gradedState, styles, useAutoplay } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'translate_type'>>

/**
 * Type the translation. An auto-growing textarea whose direction and language are the answer
 * language; Enter asks the player to CHECK, Shift+Enter adds a new line. A blank answer clears the
 * draft. Typed Persian (P2, `answerLang: 'fa'`) goes through `PersianField`: explicit RTL, the
 * in-app keyboard while `display.persianKeyboard` is on, and physical keys remapped to the
 * learner's layout.
 */
export function TranslateType(props: Props) {
  const { challenge, display, audio, phase, response, onResponse, onSubmit } = props
  const [text, setText] = useState(() => (response?.kind === 'text' ? response.value : ''))
  const ref = useRef<HTMLTextAreaElement>(null)
  const locked = phase !== 'answering'
  const lang = challenge.answerLang
  useAutoplay(audio, challenge.prompt.fa?.audio?.normal, display.sound && phase === 'answering')

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const change = (value: string) => {
    if (locked) return
    setText(value)
    onResponse(value.trim().length > 0 ? { kind: 'text', value } : null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!locked && text.trim().length > 0) onSubmit()
  }

  if (lang === 'fa')
    return (
      <ChallengeFrame type={challenge.type} display={display} heading="Type this in Persian">
        <TranslationPrompt prompt={challenge.prompt} display={display} audio={audio} />
        <PersianField
          value={text}
          onChange={change}
          onEnter={() => {
            if (text.trim().length > 0) onSubmit()
          }}
          locked={locked}
          display={display}
          label="Your answer in Persian"
          state={gradedState(phase, props.verdict)}
        />
      </ChallengeFrame>
    )

  return (
    <ChallengeFrame type={challenge.type} display={display} heading="Type this in English">
      <TranslationPrompt prompt={challenge.prompt} display={display} audio={audio} />
      <textarea
        ref={ref}
        className={styles.textarea}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={locked}
        aria-label="Your answer in English"
        placeholder="Type in English"
        lang="en"
        dir="ltr"
        rows={3}
        maxLength={500}
        autoCapitalize="sentences"
        autoComplete="off"
        spellCheck={false}
        data-state={gradedState(phase, props.verdict)}
      />
    </ChallengeFrame>
  )
}
