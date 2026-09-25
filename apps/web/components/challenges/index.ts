// Owned by ws-renderers: export one renderer per MVP challenge type (see lib/challenge-registry.ts).
import type { RendererMap } from '@/lib/challenge-registry'
import { PlaceholderRenderer } from './Placeholder'

export const renderers: RendererMap = {
  select_image: PlaceholderRenderer,
  select_translation: PlaceholderRenderer,
  translate_bank: PlaceholderRenderer,
  translate_type: PlaceholderRenderer,
  match_pairs: PlaceholderRenderer,
  listen_tap: PlaceholderRenderer,
  cloze_choice: PlaceholderRenderer,
  complete_chat: PlaceholderRenderer,
  letter_intro: PlaceholderRenderer,
  letter_sound: PlaceholderRenderer,
  letter_forms: PlaceholderRenderer,
  read_word: PlaceholderRenderer,
  build_word: PlaceholderRenderer,
}
