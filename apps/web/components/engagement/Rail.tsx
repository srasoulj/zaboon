'use client'
/**
 * SLOT, owned by ws-engagement (Wave 3): the engagement cards in the app shell's right rail, under
 * the daily goal (DESIGN-SYSTEM §2.1: league card, daily quests, "create a profile"). The shell
 * (components/shell/AppShell.tsx, orchestrator-owned) renders `<EngagementRail home={…} />` once
 * home has loaded. Render nothing for a feature whose flag (`home.flags`) is off.
 */
import type { HomeResponse } from '@zaboon/contracts'

export interface EngagementRailProps {
  home: HomeResponse
}

export function EngagementRail(_props: EngagementRailProps): null {
  return null
}
