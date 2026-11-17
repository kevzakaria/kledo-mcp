import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

// Kledo detail responses name a line item's unit only by `unit_id`; the name
// lives in the paginated unit catalog.
const unitPages = [
  [
    { id: 2, name: 'PAIL' },
    { id: 8, name: 'M2' },
  ],
  [{ id: 15, name: 'Liter', deleted_at: '2025-01-01 00:00:00' }],
]

const money = {
  price: '100000.00',
  amount: '100000.00',
  amount_after_tax: '100000.00',
  tax: '0.00',
  subtotal: '100000.00',
  item_tax: null,
  product: null,
}

const items = [
  { ...money, id: 501, desc: 'Paint', qty: 1, unit_id: 2 },
  { ...money, id: 502, desc: 'Coating', qty: 1, unit_id: 15 },
  { ...money, id: 503, desc: 'Named', qty: 1, unit_id: 8, unit_name: 'Sheet' },
  { ...money, id: 504, desc: 'Unknown unit', qty: 1, unit_id: 99 },
  { ...money, id: 505, desc: 'No unit', qty: 1, unit_id: null },
]

const order = {
  id: 210,
  ref_number: 'SO/FIXTURE/210',
  trans_date: '2026-08-01',
  due_date: null,
  shipping_date: null,
  contact: { id: 44, name: 'Fixture Person', company: 'Fixture Company' },
  amount_after_tax: '500000.00',
  memo: null,
  status_id: 3,
  items,
}

const invoice = {
  id: 510,
  ref_number: 'INV/FIXTURE/510',
  trans_type_id: 5,
  trans_date: '2026-08-02',
  due_date: '2026-09-02',
  shipping_date: null,
  contact: { id: 44, name: 'Fixture Person', company: 'Fixture Company' },
  amount_after_tax: '500000.00',
  due: '500000.00',
  memo: null,
  status_id: 1,
  items,
  relations: [],
}

describe('kledo_get line item units', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      requestedUrls.push(url.pathname)
      response.setHeader('content-type', 'application/json')
      if (url.pathname === '/api/v1/finance/units') {
        const page = Number(url.searchParams.get('page'))
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: page,
              last_page: 2,
              per_page: 2,
              total: 3,
              data: unitPages[page - 1],
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/orders/210') {
        response.end(JSON.stringify({ success: true, data: order }))
        return
      }
      if (url.pathname === '/api/v1/finance/invoices/510') {
        response.end(JSON.stringify({ success: true, data: invoice }))
        return
      }
      if (url.pathname === '/api/v1/finance/invoices/510/transactions') {
        response.end(JSON.stringify({ success: true, data: [] }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
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
      tenant: 'fixture-tenant',
      allowInsecureLoopback: true,
      now: () => new Date('2026-08-28T01:00:00.000Z'),
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
    return { client, requestedUrls }
  }

  const expectedUnits = [
    { id: '501', unit: 'PAIL' },
    { id: '502', unit: 'Liter' },
    { id: '503', unit: 'Sheet' },
    { id: '504', unit: null },
    { id: '505', unit: null },
  ]

  it('names Sales Order line item units from the unit catalog', async () => {
    const { client } = await connect()
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_order', id: '210', include: ['line_items'] },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ lineItems: expectedUnits })
  })

  it('names Sales Invoice line item units and reads the catalog once', async () => {
    const { client, requestedUrls } = await connect()
    for (let call = 0; call < 2; call += 1) {
      const result = await client.callTool({
        name: 'kledo_get',
        arguments: { entity: 'sales_invoice', id: '510', include: ['line_items'] },
      })
      expect(result.isError, JSON.stringify(result)).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ lineItems: expectedUnits })
    }

    expect(requestedUrls.filter((path) => path === '/api/v1/finance/units')).toHaveLength(2)
  })

  it('skips the unit catalog when line items are not requested', async () => {
    const { client, requestedUrls } = await connect()
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '510', include: [] },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(requestedUrls).not.toContain('/api/v1/finance/units')
  })
})
