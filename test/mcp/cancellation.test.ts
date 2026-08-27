import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'

describe('Kledo request cancellation', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('aborts the in-flight upstream request when its MCP signal is cancelled', async () => {
    let markRequestStarted: (() => void) | undefined
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    let markUpstreamClosed: (() => void) | undefined
    const upstreamClosed = new Promise<void>((resolve) => {
      markUpstreamClosed = resolve
    })

    const upstream = createServer((_request, response) => {
      markRequestStarted?.()
      response.once('close', () => markUpstreamClosed?.())
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
      timeoutMs: 5_000,
    })
    const controller = new AbortController()
    const query = gateway.query(
      { entity: 'sales_invoice', pageSize: 20 },
      controller.signal,
    )
    await requestStarted
    controller.abort()

    await expect(query).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    const closedBeforeDeadline = await Promise.race([
      upstreamClosed.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ])
    expect(closedBeforeDeadline).toBe(true)
  })
})
