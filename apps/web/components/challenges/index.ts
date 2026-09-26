// One renderer per MVP challenge type (ws-renderers) plus the optional P2 ones (ws-typing); see
// lib/challenge-registry.ts.
import type { RendererMap } from '@/lib/challenge-registry'
import { Speak } from '@/components/speak'
import { BuildWord } from './BuildWord'
import { ClozeChoice } from './ClozeChoice'
import { ClozeType } from './ClozeType'
import { CompleteChat } from './CompleteChat'
import { LetterForms } from './LetterForms'
import { LetterIntro } from './LetterIntro'
import { LetterSound } from './LetterSound'
import { LetterTrace } from './LetterTrace'
import { ListenTap } from './ListenTap'
import { ListenType } from './ListenType'
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
  // P2 (behind flags.persianKeyboard / flags.letterTrace; typed Persian translate_type is above).
  listen_type: ListenType,
  cloze_type: ClozeType,
  letter_trace: LetterTrace,
  // P2 Wave 4 (behind flags.speak): the SpeechService comes from the player's context.
  speak: Speak,
}
