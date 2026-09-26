import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from './errors'
import { readBody } from './with-route'

const Body = z.object({ n: z.number().int() })
const LIMIT = 64

/** A JSON body of exactly `bytes` bytes (UTF-8): `{"n":1,"pad":"…"}` padded with `ch`. */
function body(bytes: number, ch = 'x'): string {
  const head = '{"n":1,"pad":"'
  const room = bytes - head.length - '"}'.length
  const size = new TextEncoder().encode(ch).length
  if (room < 0 || room % size !== 0) throw new Error(`cannot pad to ${bytes} bytes with ${ch}`)
  return `${head}${ch.repeat(room / size)}"}`
}

const post = (content: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/test', {
    method: 'POST',
    body: content,
    headers,
    duplex: 'half',
  } as RequestInit)

async function refused(promise: Promise<unknown>): Promise<void> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({
    code: 'validation',
    status: 400,
    message: `request body is larger than ${LIMIT} bytes`,
  })
}

describe('readBody: the request body cap', () => {
  it('accepts a body of exactly the limit, and one just under it', async () => {
    expect(new TextEncoder().encode(body(LIMIT)).length).toBe(LIMIT)
    expect(await readBody(post(body(LIMIT)), Body, LIMIT)).toEqual({ n: 1 })
    expect(await readBody(post(body(LIMIT - 1)), Body, LIMIT)).toEqual({ n: 1 })
    const declared = post(body(LIMIT), { 'content-length': String(LIMIT) })
    expect(await readBody(declared, Body, LIMIT)).toEqual({ n: 1 })
  })

  it('refuses a declared content-length over the limit without reading the body', async () => {
    const req = post(body(20), { 'content-length': String(LIMIT + 1) })
    await refused(readBody(req, Body, LIMIT))
    expect(req.bodyUsed).toBe(false)
  })

  it('refuses a body over the limit when it declares no length, or a false one', async () => {
    await refused(readBody(post(body(LIMIT + 1)), Body, LIMIT))
    await refused(readBody(post(body(LIMIT + 1), { 'content-length': '10' }), Body, LIMIT))
  })

  it('counts bytes, not characters', async () => {
    const persian = body(LIMIT + 2, 'س') // 2 bytes each: fewer than LIMIT characters
    expect(persian.length).toBeLessThan(LIMIT)
    await refused(readBody(post(persian), Body, LIMIT))
    expect(await readBody(post(body(LIMIT, 'س')), Body, LIMIT)).toEqual({ n: 1 })
  })

  it('stops reading an endless body at the limit and cancels it', async () => {
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 16
        controller.enqueue(new Uint8Array(16).fill(0x20))
      },
      cancel() {
        cancelled = true
      },
    })
    await refused(readBody(post(endless), Body, LIMIT))
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(LIMIT + 16 * 2)
  })

  it('still reads an empty body as {} and refuses JSON that does not match', async () => {
    expect(await readBody(post(''), z.object({}), LIMIT)).toEqual({})
    await expect(readBody(post('{'), Body, LIMIT)).rejects.toMatchObject({
      code: 'validation',
      message: 'request body is not valid JSON',
    })
    await expect(readBody(post('{"n":"one"}'), Body, LIMIT)).rejects.toMatchObject({
      code: 'validation',
      details: [{ path: 'n' }],
    })
  })
})
