import '../test-utils'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { tokens } from '../tokens'
import {
  asideIndex,
  PathLayout,
  PathNode,
  pathOffset,
  UnitBanner,
  unitColor,
  UNIT_COLORS,
  type PathUnit,
} from './Path'

describe('path geometry', () => {
  it('uses the token offsets and repeats them', () => {
    const offsets = tokens.path.offsets
    for (let i = 0; i < offsets.length * 2; i++)
      expect(pathOffset(i)).toBe(offsets[i % offsets.length])
    expect(pathOffset(2)).toBe(-70)
  })

  it('places the aside at the first ±70px node', () => {
    expect(asideIndex(8)).toBe(2)
    expect(asideIndex(2)).toBeNull()
  })

  it('cycles unit colors without bademjan (reserved for legendary)', () => {
    expect(UNIT_COLORS).not.toContain('bademjan')
    expect(unitColor(0)).toBe(UNIT_COLORS[0])
    expect(unitColor(UNIT_COLORS.length)).toBe(UNIT_COLORS[0])
    expect(unitColor(-1)).toBe(UNIT_COLORS[UNIT_COLORS.length - 1])
  })
})

describe('PathNode', () => {
  it('current: progress ring, START bubble, aria-current and progress in the name', () => {
    const { container } = render(
      <PathNode type="lesson" state="current" label="Lesson 2" progress={0.4} />,
    )
    const btn = screen.getByRole('button', { name: 'Lesson 2, current, 40% complete' })
    expect(btn).toHaveAttribute('aria-current', 'step')
    expect(container.querySelector('.zb-node__ring-fill')).toHaveAttribute('data-progress', '0.4')
    expect(container.querySelector('.zb-node__start')).toHaveTextContent('Start')
    expect(container.querySelector('.zb-node__start')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each(['locked', 'completed', 'legendary'] as const)(
    '%s: no ring or bubble, state in the name',
    (state) => {
      const { container } = render(<PathNode type="chest" state={state} label="Reward" />)
      expect(screen.getByRole('button', { name: `Reward, ${state}` })).not.toHaveAttribute(
        'aria-current',
      )
      expect(container.querySelector('.zb-node__ring')).toBeNull()
      expect(container.firstElementChild).toHaveClass(`zb-node--${state}`)
    },
  )

  it('shows the type icon (lock for a locked lesson)', () => {
    const { container, rerender } = render(
      <PathNode type="review" state="completed" label="Unit review" />,
    )
    expect(container.querySelector('[data-icon="trophy"]')).not.toBeNull()
    rerender(<PathNode type="lesson" state="locked" label="Lesson 9" />)
    expect(container.querySelector('[data-icon="lock"]')).not.toBeNull()
  })

  it('is keyboard operable', async () => {
    const onClick = vi.fn()
    render(<PathNode type="practice" state="completed" label="Practice" onClick={onClick} />)
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('UnitBanner', () => {
  it('renders section, unit, title heading and the guidebook button', async () => {
    const onGuidebook = vi.fn()
    render(
      <UnitBanner
        section={1}
        unit={2}
        title="Order at a café"
        color="lajvard"
        onGuidebook={onGuidebook}
      />,
    )
    expect(screen.getByText('Section 1, Unit 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Order at a café' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Guidebook' }))
    expect(onGuidebook).toHaveBeenCalledOnce()
  })

  it('omits the guidebook button without a handler', () => {
    render(<UnitBanner section={1} unit={1} title="Hi" color="firouzeh" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PathLayout', () => {
  const units: PathUnit[] = [
    {
      id: 'u1',
      section: 1,
      unit: 1,
      title: 'Greetings',
      aside: <span>hodhod</span>,
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        type: i === 4 ? 'chest' : 'lesson',
        state: i < 2 ? 'completed' : i === 2 ? 'current' : 'locked',
        label: `Level ${i + 1}`,
        progress: i === 2 ? 0.5 : 0,
      })),
    },
    {
      id: 'u2',
      section: 1,
      unit: 2,
      title: 'Food',
      nodes: [{ id: 'm0', type: 'lesson', state: 'locked', label: 'Level 1' }],
    },
  ]

  it('renders one labelled section per unit with offset rows from tokens', () => {
    render(<PathLayout units={units} />)
    const unit1 = screen.getByRole('region', { name: 'Greetings' })
    const rows = within(unit1).getAllByRole('listitem')
    expect(rows.map((r) => Number(r.getAttribute('data-offset')))).toEqual([0, -45, -70, -45, 0])
    expect(rows[2]!.querySelector('.zb-path__slot')).toHaveStyle({ transform: 'translateX(-70px)' })
    expect(within(rows[2]!).getByText('hodhod').closest('.zb-path__aside')).toHaveAttribute(
      'data-side',
      'right',
    )
    expect(screen.getByRole('region', { name: 'Food' })).toBeInTheDocument()
  })

  it('cycles unit colors and reports node clicks and guidebook taps', async () => {
    const onNodeClick = vi.fn()
    const onGuidebook = vi.fn()
    const { container } = render(
      <PathLayout units={units} onNodeClick={onNodeClick} onGuidebook={onGuidebook} />,
    )
    const banners = container.querySelectorAll('.zb-unit')
    expect(banners[0]).toHaveAttribute('data-color', unitColor(0))
    expect(banners[1]).toHaveAttribute('data-color', unitColor(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Level 3, current, 50% complete' }))
    expect(onNodeClick).toHaveBeenCalledWith('u1', 'n2')
    await user.click(screen.getAllByRole('button', { name: 'Guidebook' })[1]!)
    expect(onGuidebook).toHaveBeenCalledWith('u2')
  })
})
