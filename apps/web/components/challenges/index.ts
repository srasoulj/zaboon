// Owned by ws-renderers: one renderer per MVP challenge type (see lib/challenge-registry.ts).
import type { RendererMap } from '@/lib/challenge-registry'
import { BuildWord } from './BuildWord'
import { ClozeChoice } from './ClozeChoice'
import { CompleteChat } from './CompleteChat'
import { LetterForms } from './LetterForms'
import { LetterIntro } from './LetterIntro'
import { LetterSound } from './LetterSound'
import { ListenTap } from './ListenTap'
import { MatchPairs } from './MatchPairs'
import { ReadWord } from './ReadWord'
import { SelectImage } from './SelectImage'
import { SelectTranslation } from './SelectTranslation'
import { TranslateBank } from './TranslateBank'
import { TranslateType } from './TranslateType'

export const renderers: RendererMap = {
  select_image: SelectImage,
  select_translation: SelectTranslation,
  translate_bank: TranslateBank,
  translate_type: TranslateType,
  match_pairs: MatchPairs,
  listen_tap: ListenTap,
  cloze_choice: ClozeChoice,
  complete_chat: CompleteChat,
  letter_intro: LetterIntro,
  letter_sound: LetterSound,
  letter_forms: LetterForms,
  read_word: ReadWord,
  build_word: BuildWord,
}
