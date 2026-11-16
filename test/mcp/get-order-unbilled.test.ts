import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

// Kledo order detail has no unbilled_amount. The list's unbilled_amount equals
// amount_after_tax - billed_amount; remaining_amount can differ, so the
// fixture gives it a different value on purpose.
const orderDetail = {
  id: 501,
  ref_number: 'SO/2026/010',
  trans_date: '2026-08-01',
  contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
  amount_after_tax: '1000.50',
  billed_amount: '600.25',
  remaining_amount: '700.00',
  due: '1000.50',
  status_id: 5,
  items: [],
}

describe('kledo_get unbilled on order detail', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async () => {
    const upstream = createServer((request, response) => {
      const data =
        request.url === '/api/v1/finance/orders/501'
          ? orderDetail
          : request.url === '/api/v1/finance/purchaseOrders/601'
            ? { ...orderDetail, id: 601, ref_number: 'PO/2026/010' }
            : undefined
      if (!data) {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ success: true, data }))
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
      now: () => new Date('2026-08-27T01:00:00.000Z'),
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
    return client
  }

  it('returns unbilled for a partly invoiced Sales Order through fields', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_order', id: '501', fields: ['unbilled'] },
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      record: { unbilled: { amount: '400.25', currency: null } },
    })
  })

  it('leaves Purchase Order detail without a derived unbilled value', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'purchase_order', id: '601' },
    })
    expect(result.isError).not.toBe(true)
    expect((result.structuredContent as { record: object }).record).not.toHaveProperty('unbilled')
  })
})
