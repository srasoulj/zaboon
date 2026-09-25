'use client'
/**
 * SLOT, owned by ws-engagement (Wave 3): the popover of the hearts pill in the app shell's stats
 * row (DESIGN-SYSTEM §6 StatPill: heart refill). The shell calls `heartsPopover(home)` on every
 * render and passes the result to `<StatPill kind="hearts" popover={…} />`: `undefined` keeps the
 * MVP's plain pill (role img, "5 hearts"); an element turns the pill into a button that opens it.
 * Return `undefined` while flags.shop is off. Put hooks in the returned element's component.
 */
import type { ReactNode } from 'react'
import type { HomeResponse } from '@zaboon/contracts'

export function heartsPopover(_home: HomeResponse | undefined): ReactNode | undefined {
  return undefined
}
