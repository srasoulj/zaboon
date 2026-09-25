import { describe, expect, it } from 'vitest'
import { rehypePersianRuns, splitPersianRuns, type HastLike } from './persian-runs'

const text = (value: string): HastLike => ({ type: 'text', value })
const fa = (value: string): HastLike => ({
  type: 'element',
  tagName: 'fa',
  properties: {},
  children: [text(value)],
})

describe('splitPersianRuns', () => {
  it('wraps runs of whole Persian words, keeping ZWNJ and Persian punctuation inside', () => {
    expect(splitPersianRuns('Say سلام، خوبی؟ to می‌خوام now.')).toEqual([
      text('Say '),
      fa('سلام، خوبی؟'),
      text(' to '),
      fa('می‌خوام'),
      text(' now.'),
    ])
  })
  it('leaves Latin-only text alone and handles text that is all Persian', () => {
    expect(splitPersianRuns('hello there')).toEqual([text('hello there')])
    expect(splitPersianRuns('نان')).toEqual([fa('نان')])
    // Trailing spaces stay outside the run.
    expect(splitPersianRuns('نان  ')).toEqual([fa('نان'), text('  ')])
  })
})

describe('rehypePersianRuns', () => {
  it('skips fa, code and pre, and recurses into everything else', () => {
    const tree: HastLike = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'p', children: [text('a نان b')] },
        { type: 'element', tagName: 'code', children: [text('نان')] },
        {
          type: 'element',
          tagName: 'pre',
          children: [{ type: 'element', tagName: 'code', children: [text('آب')] }],
        },
        fa('سلام'),
      ],
    }
    rehypePersianRuns()(tree)
    expect(tree.children![0]!.children).toEqual([text('a '), fa('نان'), text(' b')])
    expect(tree.children![1]!.children).toEqual([text('نان')])
    expect(tree.children![2]!.children![0]!.children).toEqual([text('آب')])
    expect(tree.children![3]).toEqual(fa('سلام'))
  })
})
