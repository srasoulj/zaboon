import { describe, expect, it } from 'vitest'
import { bundleMediaIndex, rewriteGuidebookAudio, unhashedRef } from './guidebook'

describe('unhashedRef', () => {
  it('reverses the build hash', () => {
    expect(unhashedRef('audio/s_u01_0001.0123456789.mp3')).toBe('audio/s_u01_0001.mp3')
    expect(unhashedRef('img/a.b.abcdef0123.webp')).toBe('img/a.b.webp')
  })
  it('returns null for refs without a hash', () => {
    expect(unhashedRef('audio/s_u01_0001.mp3')).toBeNull()
    expect(unhashedRef('audio/x.ABCDEF0123.mp3')).toBeNull()
  })
})

describe('rewriteGuidebookAudio', () => {
  const urls: Record<string, string> = { 'audio/a.mp3': '/content/assets/audio/a.0123456789.mp3' }
  const resolve = (ref: string) => urls[ref] ?? null

  it('rewrites every <fa audio> ref to its URL', () => {
    const md = 'Say <fa audio="audio/a.mp3">سلام</fa> and <fa audio=\'audio/a.mp3\'>سلام</fa>.'
    expect(rewriteGuidebookAudio(md, resolve)).toBe(
      'Say <fa audio="/content/assets/audio/a.0123456789.mp3">سلام</fa> and ' +
        '<fa audio="/content/assets/audio/a.0123456789.mp3">سلام</fa>.',
    )
  })

  it('turns an unresolvable or empty ref into audio=""', () => {
    expect(rewriteGuidebookAudio('<fa audio="audio/missing.mp3">نان</fa>', resolve)).toBe(
      '<fa audio="">نان</fa>',
    )
    expect(rewriteGuidebookAudio('<fa audio="">نان</fa>', resolve)).toBe('<fa audio="">نان</fa>')
    expect(rewriteGuidebookAudio('<FA AUDIO=audio/a.mp3>نان</FA>', resolve)).toBe(
      '<FA AUDIO="/content/assets/audio/a.0123456789.mp3">نان</FA>',
    )
  })

  it('leaves other tags, attributes and text alone (ZWNJ included)', () => {
    const md =
      '<fa>می‌خوام</fa> <span audio="audio/a.mp3">x</span> <fast audio="audio/a.mp3"> audio="audio/a.mp3"'
    expect(rewriteGuidebookAudio(md, resolve)).toBe(md)
    expect(rewriteGuidebookAudio('<fa lang="x" audio="audio/a.mp3" id="p">آب</fa>', resolve)).toBe(
      '<fa lang="x" audio="/content/assets/audio/a.0123456789.mp3" id="p">آب</fa>',
    )
  })

  it('escapes the URL for the attribute', () => {
    expect(rewriteGuidebookAudio('<fa audio="audio/a.mp3">آب</fa>', () => '/x?a=1&b="2"')).toBe(
      '<fa audio="/x?a=1&amp;b=&quot;2&quot;">آب</fa>',
    )
  })
})

describe('bundleMediaIndex', () => {
  it('maps authoring refs of every media kind to their hashed refs', () => {
    const index = bundleMediaIndex({
      units: [
        {
          lexemes: [{ audio: 'audio/lx.1111111111.mp3', image: 'img/lx.2222222222.webp' }],
          sentences: [
            { audio: { normal: 'audio/s.3333333333.mp3', slow: 'audio/s_slow.4444444444.mp3' } },
          ],
        },
      ],
      letters: {
        track: { letters: [{ audio: 'audio/l.5555555555.mp3' }] },
        lexemes: [{ audio: 'audio/ex.6666666666.mp3' }],
      },
      characters: { characters: [{ image: 'img/c.7777777777.png' }] },
    } as unknown as Parameters<typeof bundleMediaIndex>[0])
    expect(index.get('audio/lx.mp3')).toBe('audio/lx.1111111111.mp3')
    expect(index.get('img/lx.webp')).toBe('img/lx.2222222222.webp')
    expect(index.get('audio/s.mp3')).toBe('audio/s.3333333333.mp3')
    expect(index.get('audio/s_slow.mp3')).toBe('audio/s_slow.4444444444.mp3')
    expect(index.get('audio/l.mp3')).toBe('audio/l.5555555555.mp3')
    expect(index.get('audio/ex.mp3')).toBe('audio/ex.6666666666.mp3')
    expect(index.get('img/c.png')).toBe('img/c.7777777777.png')
    expect(index.get('audio/s.3333333333.mp3')).toBe('audio/s.3333333333.mp3')
    expect(index.get('audio/nope.mp3')).toBeUndefined()
  })
})
