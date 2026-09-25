/** @zaboon/ui: design tokens and the 3D component kit (docs/DESIGN-SYSTEM.md). */
export const PACKAGE = 'ui' as const

export * from './tokens'
export * from './contrast'
export { Icon, type IconName, type IconProps } from './icons'
export { MotionPreferenceProvider, useOsReducedMotion, usePrefersReducedMotion, type MotionPreferenceProviderProps } from './motion-preference'

export { Button3D, type Button3DProps, type Button3DVariant } from './components/Button3D'
export { ChoiceCard, useDigitShortcuts, type ChoiceCardProps, type ChoiceState } from './components/ChoiceCard'
export { FaText, splitWords, stripVowelMarks, type FaTextProps, type FaTextSize, type FaToken } from './components/FaText'
export { TileBank, TilePlaceholder, WordTile, type Tile, type TileBankProps, type TileLang, type WordTileProps } from './components/TileBank'
export { clamp01, ProgressBar, type ProgressBarProps } from './components/ProgressBar'
export { FeedbackBar, type FeedbackBarProps, type FeedbackStatus } from './components/FeedbackBar'
export {
  asideIndex,
  PathLayout,
  PathNode,
  pathOffset,
  UnitBanner,
  unitColor,
  UNIT_COLORS,
  type PathLayoutProps,
  type PathNodeData,
  type PathNodeProps,
  type PathNodeState,
  type PathNodeType,
  type PathUnit,
  type UnitBannerProps,
} from './components/Path'
export { StatPill, statLabel, type StatKind, type StatPillProps } from './components/StatPill'
export {
  Character,
  CHARACTER_DISPLAY_NAMES,
  CHARACTER_MOODS,
  CHARACTER_NAMES,
  RIVE_CONTRACT,
  SpeechBubble,
  SvgCharacter,
  type CharacterMood,
  type CharacterName,
  type CharacterProps,
  type CharacterRenderer,
  type CharacterRendererProps,
  type SpeechBubbleProps,
  type SpeechBubbleTail,
} from './components/Character'
export { BottomSheet, Modal, Toast, type BottomSheetProps, type ModalProps, type ToastProps, type ToastTone } from './components/Overlay'
export { ConfettiBurst, confettiPieces, type ConfettiBurstProps, type ConfettiPiece } from './components/Confetti'
export {
  keyFace,
  LONG_PRESS_MS,
  PersianKeyboard,
  type KeyFace,
  type PersianKeyboardLayout,
  type PersianKeyboardProps,
} from './components/PersianKeyboard'
