'use client'
/**
 * SLOT, owned by ws-engagement (Wave 3): the popover of the hearts pill in the app shell's stats
 * row (DESIGN-SYSTEM §6 StatPill: heart refill). The shell calls `heartsPopover(home)` on every
 * render and passes the result to `<StatPill kind="hearts" popover={…} />`: `undefined` keeps the
 * MVP's plain pill (role img, "5 hearts"); an element turns the pill into a button that opens it.
 * Returns `undefined` while flags.shop is off.
 */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { HomeResponse, ShopResponse } from '@zaboon/contracts'
import { Button3D, Icon } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi } from '@/lib/app-services'
import { REFUSAL_TEXT, usePurchase } from './purchase'
import { formatRemaining, useNow } from './shared'

export function heartsPopover(home: HomeResponse | undefined): ReactNode | undefined {
  if (home?.flags.shop !== true) return undefined
  return <HeartsPopover lives={home.lives} />
}

export function HeartsPopover({ lives }: { lives: HomeResponse['lives'] }) {
  const api = useApi()
  const shop = useQuery<ShopResponse>({
    queryKey: queryKeys.shop,
    queryFn: () => api('shop'),
    staleTime: 60_000,
  })
  const { state, buy } = usePurchase('heart_refill')
  const now = useNow()
  const refill = shop.data?.items.find((i) => i.id === 'heart_refill')
  const unlimited = lives.policy === 'unlimited'
  const full = lives.count >= lives.max
  const next = lives.nextRegenAt === null ? null : Math.max(0, Date.parse(lives.nextRegenAt) - now)

  return (
    <div className="flex w-64 flex-col gap-3 p-4" data-testid="hearts-popover">
      <h2 className="text-[18px] font-extrabold">Hearts</h2>
      <p className="flex items-center gap-2 font-extrabold" data-testid="hearts-count">
        <Icon name="heart" size={24} className="text-anar-500" />
        {unlimited ? 'Unlimited hearts' : `${lives.count} of ${lives.max}`}
      </p>
      {!unlimited && (
        <p className="text-stone font-bold" data-testid="hearts-next">
          {full || next === null
            ? 'Your hearts are full.'
            : `Next heart in ${formatRemaining(next)}`}
        </p>
      )}
      {!unlimited && !full && refill && (
        <>
          <Button3D
            variant={refill.unavailable ? 'locked' : 'danger'}
            fullWidth
            loading={state.status === 'pending'}
            onClick={() => void buy()}
            data-testid="hearts-refill"
            aria-label={`${state.status === 'failed' ? 'Retry: refill' : 'Refill'} hearts for ${refill.price} coins`}
          >
            <span className="inline-flex items-center gap-2">
              {state.status === 'failed' ? 'Retry' : 'Refill for'}
              <Icon name="coin" size={20} />
              {refill.price}
            </span>
          </Button3D>
          {refill.unavailable && (
            <p className="text-stone font-bold">{REFUSAL_TEXT[refill.unavailable]}</p>
          )}
        </>
      )}
      <p role="status" className="font-bold empty:hidden" data-testid="hearts-status">
        {state.status === 'done'
          ? 'Hearts refilled!'
          : state.status === 'refused'
            ? REFUSAL_TEXT[state.reason]
            : state.status === 'failed'
              ? "We couldn't refill your hearts. Try again."
              : ''}
      </p>
    </div>
  )
}
