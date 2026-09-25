/** Mirrors packages/ai/ai.models.yaml (a test keeps them in sync). Never use ~latest aliases. */
export const MODELS = {
  content_text: 'openai/gpt-6-astra',
  content_text_batch: 'openai/gpt-6-astra:batch',
  content_image: 'openai/gpt-5.4-image-2',
  content_audio: 'openai/gpt-audio',
  app_transcribe: 'openai/gpt-audio-mini',
  app_explain: 'openai/gpt-6-luna',
  app_roleplay: 'openai/gpt-6-sol',
} as const
export type ModelRole = keyof typeof MODELS
