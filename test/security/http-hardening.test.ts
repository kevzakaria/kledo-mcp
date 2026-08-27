import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { publicKledoError } from '../../src/kledo/errors.js'
import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'

describe('Kledo HTTP hardening', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
    vi.unstubAllGlobals()
  })

  it('preserves a mapped HTTP error when cancelling its response body fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel: () => {
            throw new Error('fixture cancellation failure')
          },
        }),
        { status: 429, headers: { 'retry-after': '60' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const gateway = createKledoHttpGateway({
      baseUrl: new URL('https://fixture.example/api/v1/'),
      token: 'fixture-secret',
      maxAttempts: 3,
    })

    await expect(
      gateway.query({ entity: 'sales_invoice', pageSize: 20 }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Kledo rate limit reached',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects and cancels an oversized streamed response without leaking its body', async () => {
    const upstreamBodySecret = 'customer-private-response-body'
    const payload = JSON.stringify({
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        per_page: 20,
        total: 1,
        data: [
          {
            id: 101,
            ref_number: 'INV/2026/001',
            trans_date: '2026-08-01',
            due_date: null,
            contact: { id: 44, name: 'Fixture', company: null },
            amount_after_tax: '1000.00',
            due: '1000.00',
            memo: upstreamBodySecret.repeat(100),
            updated_at: null,
          },
        ],
      },
    })

    let closedBeforeNaturalCompletion = false
    let markClosed: (() => void) | undefined
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve
    })
    const upstream = createServer((_request, response) => {
      let offset = 0
      let completedNaturally = false
      response.writeHead(200, { 'content-type': 'application/json' })
      const timer = setInterval(() => {
        const nextOffset = Math.min(offset + 64, payload.length)
        response.write(payload.slice(offset, nextOffset))
        offset = nextOffset
        if (offset === payload.length) {
          completedNaturally = true
          clearInterval(timer)
          response.end()
        }
      }, 5)
      response.once('close', () => {
        clearInterval(timer)
        closedBeforeNaturalCompletion = !completedNaturally
        markClosed?.()
      })
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })

    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
      maxResponseBytes: 256,
    })

    let caught: unknown
    try {
      await gateway.query({ entity: 'sales_invoice', pageSize: 20 })
    } catch (error) {
      caught = error
    }
    await closed

    const publicError = publicKledoError(caught)
    expect(publicError).toEqual({
      code: 'UPSTREAM_RESPONSE_TOO_LARGE',
      message: 'Kledo response exceeded the configured size limit',
      retryable: false,
    })
    expect(JSON.stringify(publicError)).not.toContain(upstreamBodySecret)
    expect(closedBeforeNaturalCompletion).toBe(true)
  })

  it('holds a shared concurrency permit through retries and response body consumption', async () => {
    const payload = JSON.stringify({
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        per_page: 20,
        total: 1,
        data: [
          {
            id: 101,
            ref_number: 'INV/2026/001',
            trans_date: '2026-08-01',
            due_date: null,
            contact: { id: 44, name: 'Fixture', company: null },
            amount_after_tax: '1000.00',
            due: '1000.00',
            memo: null,
            updated_at: null,
          },
        ],
      },
    })
    const requests: string[] = []
    let firstAttempts = 0
    let markFirstBodyStarted: (() => void) | undefined
    const firstBodyStarted = new Promise<void>((resolve) => {
      markFirstBodyStarted = resolve
    })
    const upstream = createServer((request, response) => {
      const search = new URL(request.url ?? '/', 'http://fixture.local').searchParams.get('search')
      requests.push(search ?? '')
      if (search === 'first') {
        firstAttempts += 1
        if (firstAttempts === 1) {
          response.writeHead(429, { 'retry-after': '0' }).end()
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write(payload.slice(0, 64))
        markFirstBodyStarted?.()
        setTimeout(() => response.end(payload.slice(64)), 60)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(payload)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })

    let markRetryWaiting: (() => void) | undefined
    const retryWaiting = new Promise<void>((resolve) => {
      markRetryWaiting = resolve
    })
    let releaseRetry: (() => void) | undefined
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 2,
      maxConcurrency: 1,
      sleep: async () => {
        markRetryWaiting?.()
        await retryGate
      },
    })

    const first = gateway.query({ entity: 'sales_invoice', search: 'first', pageSize: 20 })
    await retryWaiting
    const second = gateway.query({ entity: 'sales_invoice', search: 'second', pageSize: 20 })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    const requestsWhileRetrying = [...requests]

    releaseRetry?.()
    await firstBodyStarted
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    const requestsWhileReadingBody = [...requests]
    await Promise.all([first, second])

    expect(requestsWhileRetrying).toEqual(['first'])
    expect(requestsWhileReadingBody).toEqual(['first', 'first'])
    expect(requests).toEqual(['first', 'first', 'second'])
  })

  it('cancels a queued request without leaking or consuming a concurrency permit', async () => {
    const payload = JSON.stringify({
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        per_page: 20,
        total: 0,
        data: [],
      },
    })
    let requestCount = 0
    let finishFirst: (() => void) | undefined
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      if (requestCount === 1) {
        response.write(payload.slice(0, 1))
        finishFirst = () => response.end(payload.slice(1))
        markFirstStarted?.()
        return
      }
      response.end(payload)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
      maxConcurrency: 1,
    })

    const first = gateway.query({ entity: 'sales_invoice', search: 'first', pageSize: 20 })
    await firstStarted
    const controller = new AbortController()
    const queued = gateway.query(
      { entity: 'sales_invoice', search: 'cancelled', pageSize: 20 },
      controller.signal,
    )
    controller.abort()

    await expect(queued).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(requestCount).toBe(1)
    finishFirst?.()
    await first

    await gateway.query({ entity: 'sales_invoice', search: 'third', pageSize: 20 })
    expect(requestCount).toBe(2)
  })

  it('defaults to at most four concurrent upstream response bodies', async () => {
    const payload = JSON.stringify({
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        per_page: 20,
        total: 0,
        data: [],
      },
    })
    let requestCount = 0
    let markFourStarted: (() => void) | undefined
    const fourStarted = new Promise<void>((resolve) => {
      markFourStarted = resolve
    })
    const finishers: Array<() => void> = []
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      if (requestCount <= 4) {
        response.write(payload.slice(0, 1))
        finishers.push(() => response.end(payload.slice(1)))
        if (requestCount === 4) markFourStarted?.()
        return
      }
      response.end(payload)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
    })

    const queries = Array.from({ length: 5 }, (_, index) =>
      gateway.query({ entity: 'sales_invoice', search: String(index + 1), pageSize: 20 }),
    )
    await fourStarted
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    const countWhileBodiesOpen = requestCount
    for (const finish of finishers) finish()
    await Promise.all(queries)

    expect(countWhileBodiesOpen).toBe(4)
    expect(requestCount).toBe(5)
  })

  it('rejects a paginated report that returns more rows than requested', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 1,
            total: 2,
            data: [{ id: 1 }, { id: 2 }],
          },
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
    })

    await expect(
      gateway.report({ report: 'aged_receivable', asOf: '2026-08-31', pageSize: 1 }),
    ).rejects.toMatchObject({
      code: 'SCHEMA_MISMATCH',
      message: 'Kledo returned more report rows than requested',
    })
  })

  it('rejects an entity page whose final-page metadata omits reported records', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 20,
            total: 2,
            data: [
              {
                id: 101,
                ref_number: 'INV/2026/001',
                trans_date: '2026-08-01',
                due_date: null,
                contact: { id: 44, name: 'Fixture', company: null },
                amount_after_tax: '1000.00',
                due: '1000.00',
                memo: null,
              },
            ],
          },
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
    })

    await expect(
      gateway.query({ entity: 'sales_invoice', pageSize: 20 }),
    ).rejects.toMatchObject({
      code: 'SCHEMA_MISMATCH',
      message: 'Kledo returned inconsistent pagination data',
    })
  })

  it('rejects a single-page entity envelope that omits reported records', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 20,
            total: 2,
            data: [{ id: 1, code: 'FIX', name: 'Fixture' }],
          },
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
    })

    await expect(gateway.query({ entity: 'product', pageSize: 20 })).rejects.toMatchObject({
      code: 'SCHEMA_MISMATCH',
      message: 'Kledo returned inconsistent pagination data',
    })
  })

  it('rejects a report page whose final-page metadata omits reported rows', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 2,
            total: 2,
            data: [{ id: 1 }],
          },
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })
    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      maxAttempts: 1,
    })

    await expect(
      gateway.report({ report: 'aged_receivable', asOf: '2026-08-31', pageSize: 2 }),
    ).rejects.toMatchObject({
      code: 'SCHEMA_MISMATCH',
      message: 'Kledo returned inconsistent pagination data',
    })
  })
})
