import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

// An older Sales Invoice as Kledo sends it: payment-like relations without a
// number, and relation types that are not part of the QU -> SO -> DO chain.
const legacyInvoice = {
  id: 510,
  ref_number: 'INV/FIXTURE/510',
  trans_type_id: 5,
  trans_date: '2025-02-20',
  due_date: '2025-03-20',
  shipping_date: null,
  contact: { id: 44, name: 'Fixture Person', company: 'Fixture Company' },
  amount_after_tax: '1110.00',
  due: '0.00',
  memo: null,
  status_id: 3,
  items: [],
  parent_tran: { id: 310, ref_number: 'DO/FIXTURE/310', trans_type_id: 7 },
  relations: [
    { id: 210, ref_number: 'SO/FIXTURE/210', trans_type_id: 6, trans_date: '2025-02-01' },
    { id: 310, ref_number: 'DO/FIXTURE/310', trans_type_id: 7, trans_date: '2025-02-19' },
    {
      id: 610,
      ref_number: null,
      trans_type_id: 17,
      trans_date: '2025-02-25',
      amount_after_tax: '500.00',
      business_tran_id: null,
    },
    { id: 620, ref_number: null, trans_type_id: 23, trans_date: '2025-02-02', amount_after_tax: '110.00' },
    { id: 630, ref_number: null, trans_type_id: 24, trans_date: '2025-02-26', amount_after_tax: '100.00' },
    {
      id: 640,
      ref_number: null,
      trans_type_id: 81,
      trans_date: '2025-02-27',
      amount_after_tax: '400.00',
      business_tran_id: 9,
    },
    { id: 650, ref_number: 'RT/FIXTURE/650', trans_type_id: 9, trans_date: '2025-03-01' },
    { id: 660, ref_number: 'INV/FIXTURE/660', trans_type_id: 5, trans_date: '2025-02-21' },
  ],
}

const paymentTransactions = [
  {
    id: 610,
    business_tran_id: 510,
    trans_type_id: 17,
    trans_date: '2025-02-25',
    amount_after_tax: '500.00',
    status_id: 3,
    bank_account_id: 77,
    payment_type_id: null,
    bank_account: { id: 77, name: 'Fixture Bank' },
  },
]

describe('kledo_get on Sales Invoices with legacy relations', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async (invoice: object) => {
    const upstream = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/finance/invoices/510') {
        response.end(JSON.stringify({ success: true, data: invoice }))
        return
      }
      if (request.url === '/api/v1/finance/invoices/510/transactions') {
        response.end(JSON.stringify({ success: true, data: paymentTransactions }))
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
    return client
  }

  const getInvoice = (client: Client, include: string[]) =>
    client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '510', include },
    })

  it('returns the record when relations have no number', async () => {
    const client = await connect(legacyInvoice)
    const result = await getInvoice(client, [])

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      record: { id: '510', reference: 'INV/FIXTURE/510' },
    })
  })

  it('keeps only the predecessor chain in document lineage', async () => {
    const client = await connect(legacyInvoice)
    const result = await getInvoice(client, ['document_lineage'])

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      documentLineage: {
        immediateParent: { documentType: 'sales_delivery', id: '310', number: 'DO/FIXTURE/310' },
        predecessors: [
          { documentType: 'sales_order', id: '210', number: 'SO/FIXTURE/210' },
          { documentType: 'sales_delivery', id: '310', number: 'DO/FIXTURE/310' },
        ],
      },
    })
  })

  it('returns a payment event with a null number when Kledo has none', async () => {
    const client = await connect(legacyInvoice)
    const result = await getInvoice(client, ['payment_events'])

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      paymentEvents: [{ id: '610', documentType: 'invoice_payment', number: null }],
    })
  })

  it('still fails safely when a predecessor has no number', async () => {
    const broken = {
      ...legacyInvoice,
      relations: legacyInvoice.relations.map((relation) =>
        relation.id === 210 ? { ...relation, ref_number: null } : relation,
      ),
    }
    const client = await connect(broken)
    const result = await getInvoice(client, ['document_lineage'])

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('SCHEMA_MISMATCH')
  })
})
