import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

// One synthetic document, as Kledo sends it in a list row and in a detail body.
const header = {
  id: 701,
  ref_number: 'DOC/2026/701',
  trans_date: '2026-08-01',
  due_date: '2026-08-31',
  shipping_date: null,
  contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
  sales_id: 90001,
  tags: [{ id: 1, name: 'Penjualan Material', owner_id: 90002 }],
  amount_after_tax: '1500000.00',
  due: '500000.00',
  memo: 'Routine installation',
  status_id: 5,
  updated_at: '2026-08-20T03:04:05Z',
}

const listRow = { ...header, sales_person: { id: 90001, name: 'Sales Contoh Satu' } }

const taxedItem = {
  id: 1,
  desc: 'Pipa',
  qty: '2',
  unit_name: 'Batang',
  price: '500000.00',
  amount: '1000000.00',
  amount_after_tax: '1110000.00',
  tax: '110000.00',
  subtotal: '1000000.00',
  product: { id: 9, code: 'PP-01', name: 'Pipa' },
  item_tax: { id: 3, name: 'PPN', percent: '11' },
}
const untaxedItem = {
  ...taxedItem,
  id: 2,
  unit_name: null,
  amount_after_tax: '1000000.00',
  tax: '0',
  item_tax: null,
}

const detail = {
  ...header,
  sales: { id: 90001, name: 'Sales Contoh Satu' },
  billed_amount: '1250000.00',
  items: [taxedItem, untaxedItem],
  relations: [],
}

const routes: Record<string, object> = {
  '/api/v1/finance/invoices': { current_page: 1, last_page: 1, per_page: 10, total: 1, data: [listRow] },
  '/api/v1/finance/orders': {
    current_page: 1,
    last_page: 1,
    per_page: 10,
    total: 1,
    data: [{ ...listRow, unbilled_amount: '250000.00' }],
  },
  '/api/v1/finance/invoices/701': detail,
  '/api/v1/finance/orders/701': detail,
}

describe('one document record for kledo_query and kledo_get', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async () => {
    const upstream = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture.local').pathname
      const data = routes[path]
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

  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError).not.toBe(true)
    return result.structuredContent as Record<string, unknown>
  }

  for (const entity of ['sales_invoice', 'sales_order'] as const) {
    it(`returns the same ${entity} record from query and get`, async () => {
      const client = await connect()
      const queried = await call(client, 'kledo_query', { entity, pageSize: 10 })
      const got = await call(client, 'kledo_get', { entity, id: '701' })
      const [item] = queried.items as Array<Record<string, unknown>>
      expect(got.record).toEqual(item)
    })
  }

  it('returns line items in one shape for Sales Invoice and Sales Order', async () => {
    const client = await connect()
    const invoice = await call(client, 'kledo_get', {
      entity: 'sales_invoice',
      id: '701',
      include: ['line_items'],
    })
    const order = await call(client, 'kledo_get', {
      entity: 'sales_order',
      id: '701',
      include: ['line_items'],
    })
    const money = (amount: string) => ({ amount, currency: null })
    const expected = [
      {
        id: '1',
        description: 'Pipa',
        quantity: '2',
        unit: 'Batang',
        unitPrice: money('500000.00'),
        subtotal: money('1000000.00'),
        total: money('1110000.00'),
        tax: money('110000.00'),
        product: { id: '9', code: 'PP-01', name: 'Pipa' },
        taxRate: { id: '3', name: 'PPN', percent: '11' },
      },
      {
        id: '2',
        description: 'Pipa',
        quantity: '2',
        unit: null,
        unitPrice: money('500000.00'),
        subtotal: money('1000000.00'),
        total: money('1000000.00'),
        tax: money('0'),
        product: { id: '9', code: 'PP-01', name: 'Pipa' },
        taxRate: null,
      },
    ]
    expect(invoice.lineItems).toEqual(expected)
    expect(order.lineItems).toEqual(expected)
  })
})
