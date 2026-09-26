/** DOM tests for the story renderer (P2, flags.stories): one beat per challenge. */
import { act, fireEvent, screen, within } from '@testing-library/react'
import { Challenge, type ChallengeOf } from '@zaboon/contracts'
import { describe, expect, it } from 'vitest'
import { renderChallenge, startsWith, verdictOf } from '@/components/challenges/testing'
import { characterFor } from './Story'
import recorded from './story-fixture.json'

type StoryChallenge = ChallengeOf<'story'>

/** The fixture story's beats as the engine builds them (story-fixture.test.ts keeps them current). */
const FIXTURE_BEATS = (recorded as unknown[]).map((c) => Challenge.parse(c) as StoryChallenge)

const salam = {
  fa: 'سلام، خوبی؟',
  translit: 'salām, khubi?',
  faVocalized: 'سَلام، خوبی؟',
  tokens: [
    { surface: 'سلام', lexeme: 'lx_salam', translit: 'salām', gloss: 'hello' },
    { surface: 'خوبی', lexeme: 'lx_khub', translit: 'khubi', gloss: "(you're) good" },
  ],
  audio: { normal: '/media/fixtures/audio/s_u01_0001.mp3' },
}
const khubam = { fa: 'خوبم، مرسی', translit: 'khubam, mersi' }
const chay = {
  fa: 'چای می‌خوای؟',
  translit: 'chāy mikhāy?',
  audio: { normal: '/media/fixtures/audio/s_u01_0005.mp3' },
}

const leila = { id: 'leila', name: 'Leila' }
const hodhod = { id: 'hodhod', name: 'Hodhod' }

/** Beat 0 of the fixture story: two lines, then "How is Hodhod?". */
function questionBeat(over: Partial<StoryChallenge> = {}): StoryChallenge {
  return Challenge.parse({
    index: 0,
    ref: { type: 'story', items: ['st_u01_tea'], variant: 0 },
    type: 'story',
    storyId: 'st_u01_tea',
    title: 'A cup of tea',
    image: '/media/fixtures/img/tea.svg',
    beat: 0,
    beats: 3,
    lines: [
      { speaker: leila, text: salam, en: 'Hello, how are you?' },
      { speaker: hodhod, text: khubam, en: "I'm good, thanks." },
    ],
    question: {
      prompt: { lang: 'en', text: 'How is Hodhod?' },
      choices: [
        { lang: 'en', text: 'good' },
        { lang: 'en', text: 'tired' },
        { lang: 'en', text: 'hungry' },
      ],
      answer: 0,
    },
    ...over,
  }) as StoryChallenge
}

/** A closing beat: a narrator line and a guest speaker, no question. */
function closingBeat(): StoryChallenge {
  return Challenge.parse({
    index: 2,
    ref: { type: 'story', items: ['st_u01_tea'], variant: 2 },
    type: 'story',
    storyId: 'st_u01_tea',
    title: 'A cup of tea',
    beat: 2,
    beats: 3,
    lines: [
      { speaker: null, text: chay, en: 'Do you want some tea?' },
      {
        speaker: { id: 'guest', name: 'Guest', image: '/media/fixtures/img/guest.png' },
        text: khubam,
        en: "I'm good, thanks.",
      },
    ],
  }) as StoryChallenge
}

const lines = () => screen.queryAllByTestId('story-line')
const continueButton = () => screen.queryByTestId('story-continue')

function expectRtl(container: HTMLElement) {
  const fa = container.querySelectorAll('[lang="fa"]')
  expect(fa.length).toBeGreaterThan(0)
  for (const el of fa) expect(el).toHaveAttribute('dir', 'rtl')
}

describe('Story renderer', () => {
  it('shows the illustrated header: title, cover and the part', () => {
    renderChallenge(questionBeat())
    expect(screen.getByRole('region', { name: 'A cup of tea' })).toBeInTheDocument()
    const cover = screen.getByTestId('story-cover')
    expect(cover.tagName).toBe('IMG')
    expect(cover).toHaveAttribute('src', '/media/fixtures/img/tea.svg')
    expect(cover).toHaveAttribute('alt', '')
    expect(screen.getByText('Part 1 of 3')).toBeInTheDocument()
  })

  it('draws a placeholder cover when the story has no image', () => {
    renderChallenge(closingBeat())
    const cover = screen.getByTestId('story-cover')
    expect(cover.tagName).toBe('DIV')
    expect(cover).toHaveAttribute('aria-hidden', 'true')
  })

  it('reveals the lines one by one with the Continue button', async () => {
    const h = renderChallenge(questionBeat())
    expect(lines()).toHaveLength(1)
    expect(screen.queryByTestId('story-question')).toBeNull()
    await h.user.click(continueButton()!)
    expect(lines()).toHaveLength(2)
    expect(continueButton()).toBeNull()
    expect(screen.getByTestId('story-question')).toHaveTextContent('How is Hodhod?')
    expect(h.last()).toBeNull()
  })

  it('Space and Enter (unfocused) reveal the next line and keep Enter from the player', () => {
    const h = renderChallenge(closingBeat())
    expect(lines()).toHaveLength(1)
    const space = fireEvent.keyDown(document.body, { key: ' ' })
    expect(space).toBe(false) // preventDefault-ed: no page scroll
    expect(lines()).toHaveLength(2)
    h.unmount()
    renderChallenge(questionBeat())
    const enter = fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(enter).toBe(false) // the player's CHECK never sees it
    expect(lines()).toHaveLength(2)
    // Every line is shown: Enter belongs to the player again.
    expect(fireEvent.keyDown(document.body, { key: 'Enter' })).toBe(true)
  })

  it('Enter on a focused control is left to that control', async () => {
    const h = renderChallenge(questionBeat())
    const toggle = screen.getByRole('button', { name: 'Show English' })
    toggle.focus()
    expect(fireEvent.keyDown(toggle, { key: 'Enter' })).toBe(true)
    expect(lines()).toHaveLength(1)
    await h.user.keyboard('{Enter}') // activates the focused toggle, not the next line
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(lines()).toHaveLength(1)
  })

  it('draws each speaker with a portrait and the narrator without one', async () => {
    const h = renderChallenge(closingBeat())
    await h.user.click(continueButton()!)
    const [narrator, guest] = lines()
    expect(narrator).toHaveAttribute('data-speaker', 'narrator')
    expect(within(narrator!).queryByTestId('story-portrait')).toBeNull()
    expect(guest).toHaveAttribute('data-speaker', 'guest')
    expect(within(guest!).getByText('Guest')).toBeInTheDocument()
    // A speaker portrait from content is used when present.
    const img = within(within(guest!).getByTestId('story-portrait')).getByRole('presentation', {
      hidden: true,
    })
    expect(img).toHaveAttribute('src', '/media/fixtures/img/guest.png')
    h.unmount()
    renderChallenge(questionBeat())
    const [first] = lines()
    expect(within(first!).getByTestId('story-portrait')).toBeInTheDocument()
    expect(within(first!).getByText('Leila')).toBeInTheDocument()
  })

  it('maps speaker ids to the cast, else the mascot', () => {
    expect(characterFor('leila')).toBe('leila')
    expect(characterFor('maman-bozorg')).toBe('maman-bozorg')
    expect(characterFor('guest')).toBe('hodhod')
  })

  it('shows the English on tap (lang="en")', async () => {
    const h = renderChallenge(questionBeat())
    const [first] = lines()
    const en = within(first!).getByText('Hello, how are you?')
    expect(en).not.toBeVisible()
    expect(en).toHaveAttribute('lang', 'en')
    await h.user.click(within(first!).getByRole('button', { name: 'Show English' }))
    expect(en).toBeVisible()
    await h.user.click(within(first!).getByRole('button', { name: 'Hide English' }))
    expect(en).not.toBeVisible()
  })

  it('replays a line with audio; a line without audio has no speaker button', async () => {
    const h = renderChallenge(questionBeat())
    await h.user.click(screen.getByRole('button', { name: 'Play line 1' }))
    expect(h.audio.play).toHaveBeenCalledWith('/media/fixtures/audio/s_u01_0001.mp3')
    await h.user.click(continueButton()!)
    expect(screen.queryByRole('button', { name: 'Play line 2' })).toBeNull()
  })

  it('plays each line as it appears when sound is on', async () => {
    const h = renderChallenge(closingBeat(), { display: { sound: true } })
    expect(h.audio.play).toHaveBeenCalledWith('/media/fixtures/audio/s_u01_0005.mp3')
    expect(h.audio.play).toHaveBeenCalledTimes(1)
    await h.user.click(continueButton()!) // the second line has no audio
    expect(h.audio.play).toHaveBeenCalledTimes(1)
  })

  it('a right answer grades correct', async () => {
    const c = questionBeat()
    const h = renderChallenge(c)
    await h.user.click(continueButton()!)
    await h.user.click(screen.getByRole('button', { name: startsWith('good') }))
    expect(h.last()).toEqual({ kind: 'choice', value: 0 })
    expect(verdictOf(c, h.last())).toBe('correct')
  })

  it('a wrong answer grades wrong, and feedback never shows the right one', async () => {
    const c = questionBeat()
    const h = renderChallenge(c)
    await h.user.click(continueButton()!)
    await h.user.click(screen.getByRole('button', { name: startsWith('tired') }))
    expect(h.last()).toEqual({ kind: 'choice', value: 1 })
    expect(verdictOf(c, h.last())).toBe('wrong')
    h.check()
    const cards = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')
    expect(cards[1]!.className).toMatch(/wrong/)
    expect(cards[0]!.className).not.toMatch(/correct/)
  })

  it('digits choose once the question is shown', async () => {
    const c = questionBeat()
    const h = renderChallenge(c)
    await h.user.keyboard('3')
    expect(h.last()).toBeNull() // the question is not shown yet
    await h.user.click(continueButton()!)
    await h.user.keyboard('3')
    expect(h.last()).toEqual({ kind: 'choice', value: 2 })
    expect(verdictOf(c, h.last())).toBe('wrong')
    await h.user.keyboard('1')
    expect(verdictOf(c, h.last())).toBe('correct')
  })

  it('locks during feedback: no picks, no reveals', async () => {
    const c = questionBeat()
    const h = renderChallenge(c)
    await h.user.click(continueButton()!)
    await h.user.keyboard('1')
    h.check()
    h.onResponse.mockClear()
    await h.user.keyboard('2')
    await h.user.click(screen.getByRole('button', { name: startsWith('hungry') }))
    expect(h.onResponse).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')[0]!.className,
    ).toMatch(/correct/)
  })

  it('the closing beat reports {kind: none} once every line is shown, and it grades correct', async () => {
    const c = closingBeat()
    const h = renderChallenge(c)
    expect(h.last()).toBeNull()
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Enter' })
    })
    expect(h.last()).toEqual({ kind: 'none' })
    expect(verdictOf(c, h.last())).toBe('correct')
    expect(screen.queryByTestId('story-question')).toBeNull()
  })

  it('a feedback render (a resumed or graded beat) shows every line', () => {
    renderChallenge(questionBeat(), { phase: 'feedback', response: { kind: 'choice', value: 0 } })
    expect(lines()).toHaveLength(2)
    expect(continueButton()).toBeNull()
  })

  it('Persian lines are whole-word RTL islands (with transliteration and vowel marks)', async () => {
    for (const display of [{}, { transliteration: true, vowelMarks: true }]) {
      const h = renderChallenge(questionBeat(), { display })
      await h.user.click(continueButton()!)
      expectRtl(h.container)
      // Whole words: each Persian word is exactly one text node.
      const [first] = lines()
      const words = [...first!.querySelectorAll('[lang="fa"] *')]
        .filter((el) => el.children.length === 0)
        .map((el) => el.textContent)
        .filter((t) => t && /[؀-ۿ]/.test(t))
      expect(words).toEqual(display.vowelMarks ? ['سَلام،', 'خوبی؟'] : ['سلام،', 'خوبی؟'])
      h.unmount()
    }
  })

  it('plays the recorded fixture story: every beat reads through and grades like the server', async () => {
    for (const c of FIXTURE_BEATS) {
      const h = renderChallenge(c, { display: { transliteration: true } })
      for (let i = 1; i < c.lines.length; i++) await h.user.keyboard(' ')
      expect(lines()).toHaveLength(c.lines.length)
      expectRtl(h.container)
      if (c.question) {
        await h.user.keyboard(String(c.question.answer + 1))
        expect(verdictOf(c, h.last())).toBe('correct')
      } else {
        expect(h.last()).toEqual({ kind: 'none' })
        expect(verdictOf(c, h.last())).toBe('correct')
      }
      h.unmount()
    }
  })
})
