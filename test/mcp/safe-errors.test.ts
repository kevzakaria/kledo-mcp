import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('safe MCP errors', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('maps a Kledo 401 without leaking the credential or upstream response body', async () => {
    const upstreamBodySecret = 'customer-private-upstream-body'
    const apiToken = 'fixture-api-token-must-not-leak'
    const upstream = createServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: upstreamBodySecret, token: apiToken }))
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
      token: apiToken,
      allowInsecureLoopback: true,
    })
    const client = new Client(
      { name: 'kledo-mcp-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice' },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'AUTH_INVALID',
            message: 'Kledo authentication failed',
            retryable: false,
          }),
        },
      ],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(apiToken)
    expect(serialized).not.toContain(upstreamBodySecret)
  })

  it('maps a malformed success envelope to a safe schema error', async () => {
    const upstreamBodySecret = 'malformed-customer-private-data'
    const upstream = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: { unexpected: upstreamBodySecret },
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
    const client = new Client(
      { name: 'kledo-mcp-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice' },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'SCHEMA_MISMATCH',
            message: 'Kledo returned data in an unexpected format',
            retryable: false,
          }),
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(upstreamBodySecret)
  })

  it('retries a bounded read-only request after a 429 and then succeeds', async () => {
    let requestCount = 0
    const upstream = createServer((_request, response) => {
      requestCount += 1
      if (requestCount === 1) {
        response.writeHead(429, { 'retry-after': '0' }).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
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
    const client = new Client(
      { name: 'kledo-mcp-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice' },
    })

    expect(result.isError).not.toBe(true)
    expect(requestCount).toBe(2)
  })

  it('returns RATE_LIMITED without retrying earlier than a long Retry-After', async () => {
    let requestCount = 0
    const waits: number[] = []
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(429, { 'retry-after': '60' }).end()
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
      maxAttempts: 3,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
      },
    })
    const client = new Client(
      { name: 'kledo-mcp-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice' },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'RATE_LIMITED',
            message: 'Kledo rate limit reached',
            retryable: true,
          }),
        },
      ],
    })
    expect(requestCount).toBe(1)
    expect(waits).toEqual([])
  })
})
