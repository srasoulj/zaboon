'use client'
/**
 * /shop (flags.shop; DESIGN-SYSTEM §2.3): the coin balance (Lājvard, §4.1) and what it buys: a
 * streak freeze (owned / max) and a heart refill, each with its price and, when it can't be bought
 * now, why (from the server's `unavailable`).
 */
import { useQuery } from '@tanstack/react-query'
import type { ShopItem, ShopItemId, ShopResponse } from '@zaboon/contracts'
import { Button3D, Icon, type IconName } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { REFUSAL_TEXT, usePurchase } from './purchase'
import { FeatureOff, PageLoading } from './states'

const ITEMS: Record<
  ShopItemId,
  { title: string; body: string; icon: IconName; iconClass: string }
> = {
  streak_freeze: {
    title: 'Streak freeze',
    body: 'Keeps your streak alive for a day you miss.',
    icon: 'flame',
    iconClass: 'text-lajvard-500',
  },
  heart_refill: {
    title: 'Heart refill',
    body: 'Fill your hearts back up right now.',
    icon: 'heart',
    iconClass: 'text-anar-500',
  },
}

export function ShopScreen() {
  const api = useApi()
  const session = useSession()
  const home = useHome(session.status === 'signed_in')
  const on = home.data?.flags.shop === true
  const shop = useQuery<ShopResponse>({
    queryKey: queryKeys.shop,
    queryFn: () => api('shop'),
    enabled: on,
    refetchOnMount: 'always',
  })

  if (!home.data) return <PageLoading label="Loading the shop…" />
  if (!on) return <FeatureOff title="Shop" />

  return (
    <section aria-labelledby="shop-title" className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 id="shop-title" className="text-[28px] font-extrabold">
          Shop
        </h1>
        {shop.data && (
          <p
            className="flex items-center gap-2 text-[20px] font-extrabold text-lajvard-500 dark:text-ink"
            data-testid="shop-coins"
            data-value={shop.data.coins}
          >
            <Icon name="coin" size={28} className="text-lajvard-500" />
            <span className="zb-sr-only">Your coins:</span>
            {shop.data.coins}
          </p>
        )}
      </header>
      {shop.data ? (
        <ul className="flex flex-col gap-4">
          {shop.data.items.map((item) => (
            <ShopCard key={item.id} item={item} />
          ))}
        </ul>
      ) : shop.isError ? (
        <p role="alert" className="text-stone font-bold">
          We couldn&apos;t load the shop.
        </p>
      ) : (
        <PageLoading label="Loading the shop…" />
      )}
    </section>
  )
}

function ShopCard({ item }: { item: ShopItem }) {
  const meta = ITEMS[item.id]
  const { state, buy } = usePurchase(item.id)
  const titleId = `shop-${item.id}`
  const reason = item.unavailable
  return (
    <li
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-4"
      data-testid="shop-item"
      data-item={item.id}
      data-unavailable={reason ?? ''}
      aria-labelledby={titleId}
    >
      <div className="flex items-center gap-4">
        <Icon name={meta.icon} size={56} className={meta.iconClass} />
        <div className="flex flex-1 flex-col gap-1">
          <h2 id={titleId} className="text-[20px] font-extrabold">
            {meta.title}
          </h2>
          <p className="text-stone font-bold">{meta.body}</p>
          {item.owned !== null && (
            <p className="font-bold" data-testid="shop-owned">
              {item.max !== null ? `${item.owned} / ${item.max} equipped` : `${item.owned} owned`}
            </p>
          )}
        </div>
      </div>
      <Button3D
        variant={reason ? 'locked' : 'secondary'}
        fullWidth
        loading={state.status === 'pending'}
        onClick={() => void buy()}
        aria-describedby={reason ? `${titleId}-why` : undefined}
        data-testid="shop-buy"
        aria-label={`${state.status === 'failed' ? 'Retry: buy' : 'Buy'} ${meta.title.toLowerCase()} for ${item.price} coins`}
      >
        <span className="inline-flex items-center gap-2">
          {state.status === 'failed' ? 'Retry' : 'Buy for'}
          <Icon name="coin" size={20} />
          {item.price}
        </span>
      </Button3D>
      {reason && (
        <p id={`${titleId}-why`} className="text-stone font-bold" data-testid="shop-why">
          {REFUSAL_TEXT[reason]}
        </p>
      )}
      <p role="status" className="font-bold empty:hidden" data-testid="shop-status">
        {state.status === 'done'
          ? `Bought! You have ${state.result.coins} coins left.`
          : state.status === 'refused'
            ? REFUSAL_TEXT[state.reason]
            : state.status === 'failed'
              ? "We couldn't reach the shop. Tap Retry: you won't be charged twice."
              : ''}
      </p>
    </li>
  )
}
