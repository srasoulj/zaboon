/** DOM tests for the Learn path: node states × kinds, popovers, START links, keyboard, banners. */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearnPath, PathView } from './LearnPath'
import { LOCKED_MESSAGE, type LevelState } from './path-model'
import { FIXTURE_PATH, level, renderWithServices, testPath } from './test-support'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/learn',
}))

beforeEach(() => {
  push.mockClear()
})
afterEach(() => {
  cleanup()
})

const nodeButton = (container: HTMLElement, levelId: string) =>
  container.querySelector<HTMLButtonElement>(`[data-level="${levelId}"] button`)!

const STATES: LevelState[] = ['current', 'completed', 'locked', 'legendary', 'available']
const KINDS: [kind: string, type: string][] = [
  ['lesson', 'lesson'],
  ['unit_review', 'review'],
  ['practice', 'practice'],
  ['chest', 'chest'],
  ['story', 'story'],
  ['mystery_kind', 'lesson'],
]

describe('path nodes', () => {
  for (const state of STATES)
    for (const [kind, type] of KINDS)
      it(`draws a ${state} ${kind} node`, () => {
        const path = testPath([
          {
            id: 'u01-a',
            levels: [
              level('lv-1', { kind, state, title: 'Greetings', lessonsTotal: 4, lessonsDone: 2 }),
            ],
          },
        ])
        const { container } = renderWithServices(<PathView path={path} />)
        const row = container.querySelector('[data-level="lv-1"]')!
        expect(row).toHaveAttribute('data-state', state)
        const button = nodeButton(container, 'lv-1')
        expect(button).toHaveAttribute('data-type', type)
        expect(button.getAttribute('aria-label')).toContain('Greetings')
        expect(button.getAttribute('aria-label')).toContain(state)
        expect(button).toHaveAttribute('aria-haspopup', 'dialog')
        expect(button).toHaveAttribute('aria-expanded', 'false')
        // START bubble + progress ring only on the current node.
        const start = within(row as HTMLElement).queryByText('Start')
        if (state === 'current') {
          expect(start).toBeInTheDocument()
          expect(button).toHaveAttribute('aria-current', 'step')
          expect(button.getAttribute('aria-label')).toContain('50% complete')
          expect(row.querySelector('[data-progress]')).toHaveAttribute('data-progress', '0.5')
        } else {
          expect(start).toBeNull()
          expect(row.querySelector('[data-progress]')).toBeNull()
        }
        // Legendary gets a crown on top of the kit's eggplant (u05 is eggplant too).
        expect(row.querySelector('[data-testid="legendary-crown"]') !== null).toBe(
          state === 'legendary',
        )
        expect(row.querySelector(`[data-state="${state}"].zb-node`)).not.toBeNull()
      })

  it('lays nodes out on the kit offsets', () => {
    const levels = Array.from({ length: 9 }, (_, i) => level(`lv-${i}`))
    const { container } = renderWithServices(
      <PathView path={testPath([{ id: 'u01-a', levels }])} />,
    )
    const offsets = [...container.querySelectorAll('[data-level]')].map((r) =>
      Number(r.getAttribute('data-offset')),
    )
    expect(offsets).toEqual([0, -45, -70, -45, 0, 45, 70, 45, 0])
  })

  it('puts a decorative character beside the first widest node', () => {
    const levels = Array.from({ length: 5 }, (_, i) => level(`lv-${i}`))
    const { container } = renderWithServices(
      <PathView path={testPath([{ id: 'u01-a', levels }])} />,
    )
    const asides = container.querySelectorAll('.zb-path__aside')
    expect(asides).toHaveLength(1)
    expect(asides[0]!.closest('[data-level]')).toHaveAttribute('data-level', 'lv-2')
    expect(asides[0]!.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('unit banners', () => {
  it('shows section and unit numbers, title, subtitle, color and a guidebook button', async () => {
    const path = testPath([
      { id: 'u01-a', title: 'Hello', subtitle: 'Say hi', color: 'firouzeh', levels: [level('a1')] },
      { id: 'u02-b', title: 'Food', color: 'bademjan', hasGuidebook: false, levels: [level('b1')] },
    ])
    const { container } = renderWithServices(<PathView path={path} />)
    const [first, second] = [...container.querySelectorAll('section[data-unit]')] as HTMLElement[]
    expect(within(first!).getByText('Section 1, Unit 1')).toBeInTheDocument()
    expect(within(first!).getByRole('heading', { level: 2 })).toHaveTextContent('HelloSay hi')
    expect(first!.querySelector('.zb-unit')).toHaveAttribute('data-color', 'firouzeh')
    expect(within(second!).getByText('Section 1, Unit 2')).toBeInTheDocument()
    expect(second!.querySelector('.zb-unit')).toHaveAttribute('data-color', 'bademjan')
    expect(within(second!).queryByRole('button', { name: /guidebook/i })).toBeNull()
    await userEvent.click(within(first!).getByRole('button', { name: /guidebook/i }))
    expect(push).toHaveBeenCalledWith('/learn/guidebook/u01-a?course=fixture')
  })
})

describe('level popover', () => {
  it('offers START for the current level with the lesson URL', async () => {
    const { container } = renderWithServices(<PathView path={FIXTURE_PATH} />)
    await userEvent.click(nodeButton(container, 'u01-l1'))
    const dialog = screen.getByRole('dialog', { name: 'Course challenges' })
    expect(within(dialog).getByText('Lesson 1 of 1')).toBeInTheDocument()
    const start = within(dialog).getByRole('link', { name: 'Start' })
    expect(start).toHaveAttribute('href', '/lesson?course=fixture&kind=lesson&level=u01-l1')
    expect(start).toHaveFocus()
    expect(nodeButton(container, 'u01-l1')).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers a replay for a completed level', async () => {
    const { container } = renderWithServices(<PathView path={FIXTURE_PATH} />)
    await userEvent.click(nodeButton(container, 'u01-s0'))
    const dialog = screen.getByRole('dialog', { name: 'First steps' })
    expect(within(dialog).getByRole('link', { name: 'Replay' })).toHaveAttribute(
      'href',
      '/lesson?course=fixture&kind=lesson&level=u01-s0',
    )
  })

  it('builds practice and unit review links with their kinds', async () => {
    const path = testPath([
      {
        id: 'u01-a',
        levels: [
          level('u01-p1', { kind: 'practice', state: 'completed' }),
          level('u01-r1', { kind: 'unit_review', state: 'current' }),
        ],
      },
    ])
    const { container } = renderWithServices(<PathView path={path} />)
    await userEvent.click(nodeButton(container, 'u01-p1'))
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute(
      'href',
      '/lesson?course=fixture&kind=practice&level=u01-p1',
    )
    await userEvent.click(nodeButton(container, 'u01-r1'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Unit review' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/lesson?course=fixture&kind=unit_review&level=u01-r1',
    )
  })

  it('explains a locked level and offers no link', async () => {
    const { container } = renderWithServices(<PathView path={FIXTURE_PATH} />)
    await userEvent.click(nodeButton(container, 'u01-l2'))
    const dialog = screen.getByRole('dialog', { name: 'Letter challenges' })
    expect(dialog).toHaveAttribute('data-state', 'locked')
    expect(within(dialog).getByText(LOCKED_MESSAGE)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link')).toBeNull()
    expect(dialog).toHaveFocus()
  })

  it('an available chest has no START and no link', async () => {
    const path = testPath([
      {
        id: 'u01-a',
        levels: [level('c1', { kind: 'chest', state: 'available', title: undefined })],
      },
    ])
    const { container } = renderWithServices(<PathView path={path} />)
    expect(container.querySelector('[data-level="c1"]')?.textContent).not.toContain('Start')
    await userEvent.click(nodeButton(container, 'c1'))
    const dialog = screen.getByRole('dialog', { name: 'Reward chest' })
    expect(within(dialog).queryByRole('link')).toBeNull()
    expect(within(dialog).getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('never offers Legendary or "Jump here?"', async () => {
    const path = testPath([
      {
        id: 'u01-a',
        levels: [level('a1', { state: 'legendary' }), level('a2', { state: 'locked' })],
      },
    ])
    const { container } = renderWithServices(<PathView path={path} />)
    for (const id of ['a1', 'a2']) {
      await userEvent.click(nodeButton(container, id))
      expect(screen.queryByText(/legendary/i, { selector: 'a, button' })).toBeNull()
      expect(screen.queryByText(/jump/i)).toBeNull()
    }
  })

  it('opens with Enter, closes with Escape and gives focus back to the node', async () => {
    const user = userEvent.setup()
    const { container } = renderWithServices(<PathView path={FIXTURE_PATH} />)
    const button = nodeButton(container, 'u01-l1')
    button.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('tapping the node again or outside closes it', async () => {
    const { container } = renderWithServices(<PathView path={FIXTURE_PATH} />)
    const button = nodeButton(container, 'u01-l1')
    await userEvent.click(button)
    await userEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(button)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('LearnPath', () => {
  it('makes no request before a session exists', async () => {
    const { calls } = renderWithServices(<LearnPath />, {
      session: null,
      handlers: { path: () => FIXTURE_PATH },
    })
    await act(async () => {})
    expect(calls).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('loads the active course path with no query and scrolls the current node into view', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { calls, container } = renderWithServices(<LearnPath />, {
      handlers: { path: () => FIXTURE_PATH },
    })
    await waitFor(() => expect(container.querySelector('[data-level="u01-l1"]')).not.toBeNull())
    expect(calls).toEqual([{ name: 'path', opts: undefined }])
    expect(screen.getByRole('heading', { level: 1, name: 'Learning path' })).toBeInTheDocument()
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('[data-level="u01-l1"]'))
  })

  it('shows an error with a retry', async () => {
    let fail = true
    renderWithServices(<LearnPath />, {
      handlers: {
        path: () => {
          if (fail) throw new Error('boom')
          return FIXTURE_PATH
        },
      },
    })
    const alert = await screen.findByRole('alert')
    fail = false
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('learn-path')).toBeInTheDocument()
  })
})
