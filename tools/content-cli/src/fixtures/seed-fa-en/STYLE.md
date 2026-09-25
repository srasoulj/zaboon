# Zaboon house style: writing Persian in `content/fa-en`

This guide says how Persian is written in the course. It binds writers, native reviewers and the
`content-cli draft` prompts. Colloquial spelling has no official standard, so for colloquial forms
this guide decides. For formal forms, follow the spelling rules of the Academy of Persian Language
and Literature (فرهنگستان زبان و ادب فارسی, _دستور خط فارسی_) unless this guide says otherwise.

Background: [LEARNING-ENGINE §1](../../docs/LEARNING-ENGINE.md#1-persian-language-layer) and
[ADR 0003](../../docs/adr/0003-colloquial-first-register-model.md).

## 1. Two registers, two fields

| Field      | Register                                               | Example           |
| ---------- | ------------------------------------------------------ | ----------------- |
| `fa`       | Spoken Tehrani Persian, written the way people text it | اسمم شیرینه.      |
| `faFormal` | Standard written Persian, **only when it differs**     | اسم من شیرین است. |

- `fa` is what learners see and hear first. Write what a Tehrani speaker would actually say in the
  situation, not a formal sentence with a few colloquial words sprinkled in.
- `faFormal` is the **same sentence** in the written standard. Change only what the register
  changes: verb and copula endings, pronoun clitics, and a few register words (see §2.6). Don't
  rephrase or "improve" it.
- Both registers are graded as correct, so never copy the formal form into `faAccept`.

## 2. Colloquial spelling

Spell a colloquial word the way it is most commonly written informally, so that a native reader
pronounces it right. Keep the standard spelling of every part of the word that speech doesn't change.

### 2.1 Verb prefixes

| House style        | Not                   | Formal              |
| ------------------ | --------------------- | ------------------- |
| می‌خوام, می‌رم     | میخوام, می خوام, میرم | می‌خواهم, می‌روم    |
| نمی‌دونم, نمی‌خوای | نمیدونم, نمی دونم     | نمی‌دانم, نمی‌خواهی |

The prefixes می and نمی are always followed by a ZWNJ (§3), never by a space or nothing.

### 2.2 Verb and copula endings

| Ending                          | House style             | Formal                           |
| ------------------------------- | ----------------------- | -------------------------------- |
| 3sg verb -e                     | می‌کنه, می‌ره, نکنه     | می‌کند, می‌رود, نکند             |
| 2pl -in                         | می‌خواین, خوبین, چطورین | می‌خواهید, خوب هستید, چطور هستید |
| "is" after a consonant: ـه (-e) | خوبه, شیرینه            | خوب است, شیرین است               |
| "is" after ā: ـست (-st)         | ساراست, لیلاست, کجاست   | سارا است, لیلا است, کجاست        |
| "is" after i: ـه (-ye)          | چیه, کیه                | چیست, کیست                       |
| "I am", "you are": ـم, ـی       | خوبم, خوبی              | خوب هستم, خوب هستی               |

- Keep the silent و of خوا: می‌خوام, not می‌خام (the variant is accepted, see
  `orthography-variants.yaml`).
- **Fixed politeness formulas keep -id** in `fa`: ببخشید, بفرمایید. Their -in forms (ببخشین,
  بفرمایین) go into `faAccept`.
- Ask a native reviewer before inventing a spelling for other vowel-final copulas.

### 2.3 -ān → -un and -ām → -um

Write و only where Tehrani speech really has u: نون for نان, خونه for خانه, می‌دونم for
می‌دانم, اون for آن, اسمتون for اسمتان. Many words keep ā in speech and keep their spelling: سلام,
مامان, ایران. When unsure, the reviewer decides; never "colloquialize" by rule alone.

### 2.4 Clitics, plural and object marker

- Pronoun clitics: ـم, ـت, ـش, ـمون, ـتون, ـشون (formal ـمان, ـتان, ـشان), joined to the word:
  اسمتون. After a silent ه, add a ZWNJ: خونه‌تون.
- Plural: the spoken -ā is written ـا, joined: کتابا, دوستا, اینا. After a silent ه keep ـها with a
  ZWNJ, which is also how it is said: بچه‌ها.
- Object marker (formal را): ـو joined after a consonant (اینو, کتابو), a separate رو after a vowel
  (اینا رو, خونه رو).
- The indefinite "a/one" is یه (formal یک): یه چایی.

### 2.5 Keep the standard spelling

- Don't write fast-speech reductions: خداحافظ, not خدافظ.
- Arabic loanwords keep their letters: صبح, حافظ, تعارف (never سبح or تارف).
- Fixed greetings are written joined, as most people write them: صبح بخیر, شب بخیر. به خیر is
  accepted through `orthography-variants.yaml`. Elsewhere به is a separate word: به من.

### 2.6 Register words

These pairs differ in the word itself; `fa` gets the first, `faFormal` the second.

| Colloquial | Formal   | Meaning       |
| ---------- | -------- | ------------- |
| مرسی       | متشکرم   | thanks        |
| باشه       | باشد     | okay          |
| چایی       | چای      | tea           |
| چی, چیه    | چه, چیست | what, what is |
| آره        | بله      | yes           |

## 3. ZWNJ (نیم‌فاصله, U+200C)

Use a ZWNJ, never a space and never nothing:

1. after the verb prefixes می and نمی: می‌خوام, نمی‌دونم;
2. before the plural ـها after a joining letter: کتاب‌ها, بچه‌ها;
3. between a silent ه and a following suffix or clitic: خونه‌تون, خانه‌ای;
4. before ـتر and ـترین: بزرگ‌تر, بزرگ‌ترین (but the fixed words بهتر, بیشتر, کمتر are joined);
5. inside compounds whose first part ends in a joining letter: مامان‌بزرگ, ته‌دیگ;
6. for the ezāfe after a silent ه: ـه‌ی in `fa` (خونه‌ی من), ـهٔ in `faFormal` (خانهٔ من).

Never put a ZWNJ at the start or end of a word, next to a space, twice in a row, or after a letter
that doesn't join (ا د ذ ر ز ژ و), where it does nothing. Never use ZWJ (U+200D) in content; only
the UI uses it to draw letter forms. On the standard Persian keyboard (ISIRI 9147) a ZWNJ is
Shift+Space.

## 4. Letters, marks and digits

- Use Persian ی (U+06CC) and ک (U+06A9), never Arabic ي (U+064A) or ك (U+0643). The lint rejects them.
- No tatweel (ـ, U+0640) and no vowel marks in `fa` or `faFormal`. Vowel marks go only in
  `faVocalized`.
- Write آ where the standard spelling has it: آب, آره.
- Prefer یی over ئی in words such as پاییز and بفرمایید.
- Digits: Persian ۰۱۲۳۴۵۶۷۸۹ (U+06F0–U+06F9) in Persian fields, Western digits in English fields,
  never Arabic-Indic ٠١٢٣ (U+0660–U+0669). Decimal separator ٫ (U+066B).

## 5. Punctuation

| Mark | Name          | Code point    |
| ---- | ------------- | ------------- |
| ،    | comma         | U+060C        |
| ؛    | semicolon     | U+061B        |
| ؟    | question mark | U+061F        |
| « »  | quotes        | U+00AB U+00BB |
| . !  | as in English | U+002E U+0021 |

- No ASCII `,` `;` `?` in any Persian field. The lint rejects them.
- No space before a mark, one space after it: سلام، خوبی؟
- `fa` and `faFormal` end with `.`, `!` or `؟`. Token surfaces and `faAccept` patterns carry no
  punctuation.

## 6. Transliteration

`translit` follows Tehrani colloquial pronunciation; `translitFormal` follows careful standard
pronunciation (khubi / khub hasti, mikhām / mikhāham, nemidunam / nemidānam).

| Sound                               | Written                           | Example             |
| ----------------------------------- | --------------------------------- | ------------------- |
| a as in _cat_                       | a                                 | man من              |
| e as in _bed_                       | e                                 | esm اسم             |
| o as in _go_ (short)                | o                                 | to تو               |
| ā as in _father_                    | ā                                 | āb آب               |
| i as in _machine_                   | i                                 | mersi مرسی          |
| u as in _food_                      | u                                 | khub خوب            |
| ey as in _day_                      | ey                                | kheyli خیلی         |
| ow as in _low_                      | ow                                | now نو              |
| two-letter consonants               | kh خ, gh غ ق, sh ش, zh ژ, ch چ    | khodāhāfez, shab    |
| other consonants                    | b p t s j h d z r f k g l m n v y | befarmāyid بفرمایید |
| glottal stop (ع/ء), only if audible | '                                 | ta'ārof تعارف       |

House rules:

- Letters that sound the same share one spelling: س ص ث → s, ز ذ ض ظ → z, ت ط → t, ح ه → h, غ ق → gh.
- All lowercase, names included (shirin, leylā). Only ā carries a mark.
- One word per token. A ZWNJ compound is one word: mikonam, māmānbozorg.
- A silent final ه is not written: bale, khune, chiye.
- A doubled consonant (tashdid) is written twice: motashakkeram.
- The ezāfe is written -e after a consonant and -ye after a vowel: esm-e man, khune-ye man. The
  hyphen is used for nothing else.
- Punctuation mirrors the Persian: ، → `,` and ؟ → `?`.

## 7. Tokens and accepted answers

- **Tokens** are the words of `fa`, split on spaces, punctuation removed, in order. Each token links
  to a lexeme introduced in this unit or earlier, and its `gloss` is the meaning in this sentence.
  Inflected surfaces (خوبم, اسمتون, می‌کنم) are listed in the lexeme's `forms`.
- **`en`**: the first path of the first pattern is the model answer, in natural English. Put commas
  and a final `?` inside a token or an alternative, never right after `]`: `[Hello,/Hi,] how are you?`.
  No final `.` or `!`. Cover every correct translation a learner might give, and nothing wrong.
- The grader merges these automatically, so don't list them: I'm/you're/it's/don't/can't/I'd, US/UK
  spelling, number words vs digits, the formal register, a sentence-initial subject pronoun, ZWNJ vs
  space, and the orthography variants. Do list other contractions: `[What's/What is]`, `[My name is/My name's]`.
- **`faAccept`** is a full pattern list whose first pattern accepts `fa` itself (put `fa`'s own words
  first in each group). Add genuinely different Persian answers only: other endings (خوبین/خوبید),
  word order, synonyms (مرسی/ممنون).
- **`orthography-variants.yaml`** lists spellings that are pronounced the same, house style first.

## 8. Checklist for native reviewers

For every item, check that:

1. `fa` is what a Tehrani speaker would naturally say here: register, politeness and word order.
2. The spelling follows this guide: ZWNJ in می‌/نمی‌, ـها and compounds; Persian ی ک; ، ؟ «».
3. `faFormal` is correct standard Persian, is the same sentence, and is absent when identical.
4. `translit` matches the colloquial pronunciation, and `translitFormal` the formal one.
5. Every token has the right lexeme and a gloss that fits this sentence.
6. The first `en` path is a natural translation, and no alternative is wrong.
7. `faAccept` has the natural alternatives a learner might build, and nothing unacceptable.
8. تو/شما fits the speaker and the listener (Maman Bozorg says تو to a grandchild; strangers and
   elders get شما).
9. The `audio.speaker` could plausibly say the line.
10. Cultural notes in the guidebook are accurate and free of stereotypes.

When an item passes, set `status: approved` and add your reviewer id to `provenance.reviewedBy`.
