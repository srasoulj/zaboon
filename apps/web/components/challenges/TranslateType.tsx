'use client'
import type { ChallengeOf } from '@zaboon/contracts'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChallengeRendererProps } from '@/lib/challenge-registry'
import { TranslationPrompt } from './TranslateBank'
import { ChallengeFrame, gradedState, styles, useAutoplay } from './shared'

type Props = ChallengeRendererProps<ChallengeOf<'translate_type'>>

/**
 * Type the translation (MVP: English). An auto-growing textarea whose direction and language are
 * the answer language; Enter asks the player to CHECK, Shift+Enter adds a new line. A blank
 * answer clears the draft.
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

  return (
    <ChallengeFrame
      type={challenge.type}
      display={display}
      heading={lang === 'en' ? 'Type this in English' : 'Type this in Persian'}
    >
      <TranslationPrompt prompt={challenge.prompt} display={display} audio={audio} />
      <textarea
        ref={ref}
        className={styles.textarea}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={locked}
        aria-label={lang === 'en' ? 'Your answer in English' : 'Your answer in Persian'}
        placeholder={lang === 'en' ? 'Type in English' : 'Type in Persian'}
        lang={lang}
        dir={lang === 'fa' ? 'rtl' : 'ltr'}
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
