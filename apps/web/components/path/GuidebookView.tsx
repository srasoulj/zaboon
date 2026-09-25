'use client'
/**
 * A unit's Guidebook (GET /api/guidebooks/:unitId): markdown rendered with react-markdown, GFM
 * tables, and raw HTML parsed then sanitized with the default schema plus ONLY
 * `<fa audio="…">` (Persian phrases). Never dangerouslySetInnerHTML.
 */
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { GuidebookResponse } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useSession } from '@/lib/app-services'
import { playAudio } from './play-audio'
import styles from './guidebook.module.css'

/** The default GitHub-style schema plus one element: `<fa>` with an `audio` attribute. */
export const GUIDEBOOK_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'fa'],
  attributes: { ...defaultSchema.attributes, fa: ['audio'] },
}

/** The plain text inside a React subtree (a phrase is plain text; stray markup is flattened). */
export function textOf(node: ReactNode): string {
  let out = ''
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child)
    else if (isValidElement<{ children?: ReactNode }>(child)) out += textOf(child.props.children)
  })
  return out
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** `<fa audio>` → FaText (lang="fa" dir="rtl", whole words) with a speaker button when there is audio. */
export function FaPhrase({ audio, children }: { audio?: string; children?: ReactNode }) {
  const text = textOf(children).trim()
  return (
    <span className={styles.phrase} data-testid="guidebook-phrase">
      <FaText text={text} />
      {audio ? (
        <button
          type="button"
          className={styles.speaker}
          aria-label="Listen"
          onClick={() => playAudio(audio)}
        >
          <SpeakerIcon />
        </button>
      ) : null}
    </span>
  )
}

// Guidebook headings sit under the page's own h1, so each level moves down by one.
const components = {
  fa: FaPhrase,
  h1: (p: ComponentPropsWithoutRef<'h2'>) => <h2 {...p} />,
  h2: (p: ComponentPropsWithoutRef<'h3'>) => <h3 {...p} />,
  h3: (p: ComponentPropsWithoutRef<'h4'>) => <h4 {...p} />,
  h4: (p: ComponentPropsWithoutRef<'h5'>) => <h5 {...p} />,
  table: (p: ComponentPropsWithoutRef<'table'>) => (
    <div className={styles.tableWrap}>
      <table {...p} />
    </div>
  ),
  // `fa` is not an intrinsic HTML element, so react-markdown's Components type has no key for it.
} as Components

export function GuidebookMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className={styles.markdown} data-testid="guidebook-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, GUIDEBOOK_SCHEMA]]}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  )
}

export function GuidebookView({ unitId, courseId }: { unitId: string; courseId: string | null }) {
  const api = useApi()
  const session = useSession()
  const q = useQuery<GuidebookResponse>({
    queryKey: [...queryKeys.guidebook(unitId), courseId ?? ''],
    queryFn: () =>
      api('guidebook', { params: { unitId }, query: { courseId: courseId ?? undefined } }),
    enabled: session.status === 'signed_in',
  })
  return (
    <article aria-labelledby="guidebook-title" className={styles.page}>
      <Link href="/learn" className={styles.back}>
        <span aria-hidden="true">←</span> Back to the path
      </Link>
      <h1 id="guidebook-title" className={styles.title}>
        {q.data ? `Guidebook: ${q.data.title}` : 'Guidebook'}
      </h1>
      {q.data ? (
        <GuidebookMarkdown markdown={q.data.markdown} />
      ) : q.isError ? (
        <p className={styles.status} role="alert">
          This guidebook isn&apos;t available.
        </p>
      ) : (
        <p className={styles.status} role="status">
          Loading the guidebook…
        </p>
      )}
    </article>
  )
}
