# ADR 0008: All AI through OpenRouter, with separate build and app keys

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The product owner requires that **all AI** go through **OpenRouter**:

- **Course materials** (sentences, dialogues, guidebooks, answer variants) are drafted with **OpenAI's GPT-6 Astra**.
- **Character and illustration assets** are generated with the **latest GPT Image model**.
- **AI features in the app** use a **separate** OpenRouter environment variable.

## Decision

- **One gateway:** `packages/ai` wraps OpenRouter's OpenAI-compatible API (`https://openrouter.ai/api/v1`). It **never reads environment variables**; each caller passes its own key.
- **Two keys:**

  | Env var | Lives in | Used by |
  |---|---|---|
  | `OPENROUTER_API_KEY_BUILD` | Content CI secrets and local `.env.local` only; never deployed to Vercel | `content-cli draft`, `suggest`, `art`, `tts` |
  | `OPENROUTER_API_KEY_APP` | Vercel server-side env only; never in the browser | `/api/speech/transcribe` (P2), `/api/ai/*` (P3) |

- **Pinned models** in `packages/ai/ai.models.yaml`, never `~latest` aliases:

  | Purpose | Model |
  |---|---|
  | Course materials (`draft`, `suggest`) | `openai/gpt-6-astra` (`:batch` for bulk runs) |
  | Character and illustration assets (`art`) | `openai/gpt-5.4-image-2`, the latest GPT Image (GPT Image 2) |
  | Draft audio (`tts`) | `openai/gpt-audio`, gated by a native listening test |
  | Transcription for `speak` (P2) | `openai/gpt-audio-mini` |
  | Explain my answer (P3) | `openai/gpt-6-luna` |
  | Roleplay (P3) | `openai/gpt-6-sol` |

- **Guardrails:**
  - Nothing AI-generated is published without human approval, recorded through `status` and `provenance`.
  - Structured outputs are validated with zod.
  - Build responses are cached by hash.
  - Each key has its own OpenRouter credit limit.
  - The app key uses `data_collection: "deny"` provider routing and sends no personal data.
  - Runtime AI endpoints have per-user quotas.
  - `content-cli models check` flags newer model versions, so upgrades are deliberate.

## Alternatives considered

- **Direct provider SDKs and keys.** More keys, bills and integration code, and harder model switching.
- **A single shared key.** No budget isolation between build and runtime, and a leak or rotation affects both.

## Consequences

- **Positive:** one integration, one bill, easy model swaps, and isolated budgets and blast radius for build versus app.
- **Negative:** a dependency on OpenRouter's availability. Runtime AI features fail closed; lessons never depend on AI.
- **Negative:** OpenRouter has **no dedicated Persian TTS voices**, and gpt-audio's voices are tuned for English. Draft audio is therefore gated by a native listening test, and core sentences are recorded by voice actors. Using Azure's native fa-IR voices as a fallback would be an exception to this ADR and needs the project owner's approval.
- **Negative:** model deprecations must be monitored (`models check`).
