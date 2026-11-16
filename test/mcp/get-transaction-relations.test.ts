import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const common = {
  id: 101,
  ref_number: 'DOC/2026/001',
  trans_date: '2026-08-01',
  due_date: null,
  shipping_date: null,
  contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
  amount_after_tax: '1500000.00',
  memo: null,
  status_id: 3,
  updated_at: null,
  items: [],
}

const detailByUrl: Record<string, object> = {
  '/api/v1/finance/orders/101': {
    ...common,
    parent_tran: { id: 10, ref_number: 'QU/2026/010', trans_type_id: 4 },
    quote: { id: 10, ref_number: 'QU/2026/010' },
  },
  '/api/v1/finance/purchaseOrders/101': {
    ...common,
    parent_tran: { id: 20, ref_number: 'PQ/2026/020', trans_type_id: 63 },
  },
  '/api/v1/finance/deliveries/101': {
    ...common,
    parent_tran: { id: 99, ref_number: 'SO/2026/099', trans_type_id: 6 },
  },
  '/api/v1/finance/purchaseDeliveries/101': {
    ...common,
    parent_tran: { id: 30, ref_number: 'XX/2026/030', trans_type_id: 9999 },
  },
  '/api/v1/finance/quotes/101': {
    ...common,
    parent_tran: { id: 40, ref_number: 'XX/2026/040' },
  },
}

describe('kledo_get typed Predecessor Document relations', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async () => {
    const upstream = createServer((request, response) => {
      const data = detailByUrl[request.url ?? '']
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

  const relationsOf = async (client: Client, entity: string) => {
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity, id: '101', include: ['relation_ids'] },
    })
    expect(result.isError).not.toBe(true)
    return (result.structuredContent as { relations: unknown }).relations
  }

  it('labels a Sales Order created from a Sales Quote as derived from that quote only', async () => {
    const client = await connect()
    expect(await relationsOf(client, 'sales_order')).toEqual([
      { relation: 'derived_from', entity: 'sales_quote', id: '10' },
    ])
  })

  it('labels a Purchase Order created from a Purchase Quote as derived from that quote', async () => {
    const client = await connect()
    expect(await relationsOf(client, 'purchase_order')).toEqual([
      { relation: 'derived_from', entity: 'purchase_quote', id: '20' },
    ])
  })

  it('keeps a Sales Delivery derived from its Sales Order', async () => {
    const client = await connect()
    expect(await relationsOf(client, 'sales_delivery')).toEqual([
      { relation: 'derived_from', entity: 'sales_order', id: '99' },
    ])
  })

  it('does not guess a relation for an unknown or missing parent type', async () => {
    const client = await connect()
    expect(await relationsOf(client, 'purchase_delivery')).toEqual([])
    expect(await relationsOf(client, 'sales_quote')).toEqual([])
  })
})
