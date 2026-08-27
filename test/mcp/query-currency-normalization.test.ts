import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_query currency normalization', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('preserves explicit Kledo currency metadata without guessing a missing ISO code', async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 3,
            total: 3,
            data: [
              {
                id: 101,
                ref_number: 'PI/2026/001',
                trans_date: '2026-08-01',
                amount_after_tax: '125.50',
                currency_id: 2,
                currency: { id: 2, code: 'usd', name: 'US Dollar' },
              },
              {
                id: 102,
                ref_number: 'PI/2026/002',
                trans_date: '2026-08-02',
                amount_after_tax: '250.00',
                currency_id: 9,
              },
              {
                id: 103,
                ref_number: 'PI/2026/003',
                trans_date: '2026-08-03',
                amount_after_tax: '375.00',
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
      arguments: { entity: 'purchase_invoice', pageSize: 3 },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      items: [
        {
          total: {
            amount: '125.50',
            currency: 'USD',
            currencyId: '2',
            currencyName: 'US Dollar',
          },
        },
        { total: { amount: '250.00', currency: null, currencyId: '9' } },
        { total: { amount: '375.00', currency: null } },
      ],
    })
    expect(JSON.stringify(result.structuredContent)).not.toContain('IDR')
  })
})
