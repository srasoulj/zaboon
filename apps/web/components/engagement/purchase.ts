'use client'
/**
 * Buying with coins (POST /api/shop/purchase, POST /api/lives/refill). Every tap sends a fresh
 * `crypto.randomUUID()` purchaseId; a tap after a failed delivery (network error, 5xx) reuses the
 * pending id, so a purchase that did reach the server is replayed, never charged twice. A refusal
 * (409) or a success clears it. Afterwards home (coins, hearts, freezes) and the shop refetch.
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PurchaseResponse, ShopItemId, ShopUnavailable } from '@zaboon/contracts'
import { ApiClientError, queryKeys } from '@/lib/api-client'
import { useApi } from '@/lib/app-services'

export type PurchaseRefusal = ShopUnavailable | 'purchase_id_reused'

export type PurchaseState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; result: PurchaseResponse }
  | { status: 'refused'; reason: PurchaseRefusal }
  | { status: 'failed' }

const REFUSALS: readonly string[] = [
  'insufficient_coins',
  'max_owned',
  'lives_full',
  'unlimited_lives',
  'purchase_id_reused',
]

/** The refusal an API error carries (409 insufficient_coins, or 409 conflict with details.reason). */
export function refusalOf(e: unknown): PurchaseRefusal | null {
  if (!(e instanceof ApiClientError) || e.status !== 409) return null
  if (e.code === 'insufficient_coins') return 'insufficient_coins'
  const reason = (e.details as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' && REFUSALS.includes(reason)
    ? (reason as PurchaseRefusal)
    : null
}

export const REFUSAL_TEXT: Record<PurchaseRefusal, string> = {
  insufficient_coins: 'Not enough coins',
  max_owned: 'You have the maximum',
  lives_full: 'Your hearts are full',
  unlimited_lives: 'You have unlimited hearts',
  purchase_id_reused: 'Something went wrong. Try again.',
}

export function usePurchase(item: ShopItemId, newId: () => string = () => crypto.randomUUID()) {
  const api = useApi()
  const queryClient = useQueryClient()
  const pendingId = useRef<string | null>(null)
  const [state, setState] = useState<PurchaseState>({ status: 'idle' })

  const buy = useCallback(async () => {
    const purchaseId = pendingId.current ?? newId()
    pendingId.current = purchaseId
    setState({ status: 'pending' })
    try {
      const result =
        item === 'heart_refill'
          ? await api('refillLives', { body: { purchaseId } })
          : await api('purchase', { body: { item, purchaseId } })
      pendingId.current = null
      setState({ status: 'done', result })
    } catch (e) {
      const reason = refusalOf(e)
      if (reason) {
        pendingId.current = null
        setState({ status: 'refused', reason })
      } else setState({ status: 'failed' }) // keep the id: the retry replays it
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.shop }),
      ])
    }
  }, [api, item, newId, queryClient])

  return { state, buy }
}
