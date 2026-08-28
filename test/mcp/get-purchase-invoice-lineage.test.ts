import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const traceEnabled = process.env.KLEDO_TEST_TRACE === '1'

function traceStep(label: string, detail: string): void {
  if (!traceEnabled) return
  process.stdout.write(`[trace] ${label.padEnd(20)} ${detail}\n`)
}

const purchaseInvoiceDetailFixture = {
  id: 700,
  ref_number: 'PI/FIXTURE/700',
  trans_type_id: 3,
  trans_date: '2026-08-20',
  due_date: '2026-09-20',
  shipping_date: '2026-08-19',
  contact: {
    id: 44,
    name: 'Private Fixture Vendor',
    company: 'Private Fixture Supplier',
    email: 'private-purchase@example.invalid',
  },
  amount_after_tax: '1110.00',
  due: '610.00',
  memo: 'Private Fixture Purchase Project',
  status_id: 3,
  items: [],
  parent_tran: {
    id: 600,
    ref_number: 'PD/FIXTURE/600',
    trans_type_id: 8,
  },
  relations: [
    { id: 500, ref_number: 'PO/FIXTURE/500', trans_type_id: 2 },
    { id: 600, ref_number: 'PD/FIXTURE/600', trans_type_id: 8 },
    { id: 400, ref_number: 'PQ/FIXTURE/400', trans_type_id: 63 },
    {
      id: 800,
      ref_number: 'PP/FIXTURE/800',
      trans_type_id: 16,
      trans_date: '2026-08-25',
      amount_after_tax: '500.00',
    },
  ],
  transactions: [
    {
      id: 800,
      business_tran_id: 700,
      trans_type_id: 16,
      trans_date: '2026-08-25',
      amount_after_tax: '500.00',
      status_id: 3,
      bank_account_id: 77,
      payment_type_id: null,
      bank_account: { id: 77, name: 'Fixture Purchase Bank' },
    },
    { id: 500, trans_type_id: 2 },
  ],
}

describe('kledo_get Purchase Invoice document lineage', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  async function connectClient(handler: RequestListener): Promise<Client> {
    const upstream = createServer(handler)
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
      now: () => new Date('2026-08-28T02:00:00.000Z'),
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

  it('returns a typed PQ to PO to PD chain and a joined Purchase Payment event', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')

      if (request.url === '/api/v1/finance/purchaseInvoices/700') {
        traceStep('Kledo fixture API', 'Purchase Invoice detail with embedded payment facts')
        response.end(
          JSON.stringify({
            success: true,
            data: purchaseInvoiceDetailFixture,
          }),
        )
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    traceStep('MCP client', 'kledo_get(PQ/PO/PD lineage + PP event)')
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'purchase_invoice',
        id: '700',
        include: ['document_lineage', 'payment_events', 'relation_ids'],
      },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(requestedUrls).toEqual(['/api/v1/finance/purchaseInvoices/700'])
    expect(result.structuredContent).toMatchObject({
      entity: 'purchase_invoice',
      documentLineage: {
        anchor: {
          documentType: 'purchase_invoice',
          transactionTypeId: '3',
          id: '700',
          number: 'PI/FIXTURE/700',
        },
        immediateParent: {
          documentType: 'purchase_delivery',
          transactionTypeId: '8',
          id: '600',
          number: 'PD/FIXTURE/600',
        },
        predecessors: [
          {
            documentType: 'purchase_quote',
            transactionTypeId: '63',
            id: '400',
            number: 'PQ/FIXTURE/400',
          },
          {
            documentType: 'purchase_order',
            transactionTypeId: '2',
            id: '500',
            number: 'PO/FIXTURE/500',
          },
          {
            documentType: 'purchase_delivery',
            transactionTypeId: '8',
            id: '600',
            number: 'PD/FIXTURE/600',
          },
        ],
        complete: true,
      },
      paymentEvents: [
        {
          relation: 'payment_for',
          documentType: 'purchase_payment',
          transactionTypeId: '16',
          id: '800',
          invoiceId: '700',
          number: 'PP/FIXTURE/800',
          transactionDate: '2026-08-25',
          amount: { amount: '500.00', currency: null },
          statusId: '3',
          bankAccount: { id: '77', name: 'Fixture Purchase Bank' },
          paymentTypeId: null,
        },
      ],
      relations: [{ relation: 'derived_from', entity: 'purchase_delivery', id: '600' }],
      truncation: {
        lineItems: false,
        documentLineage: false,
        paymentEvents: false,
      },
      meta: {
        fetchedAt: '2026-08-28T02:00:00.000Z',
        tenant: 'fixture-tenant',
        warnings: [],
      },
    })
    expect(JSON.stringify(result.structuredContent)).not.toContain(
      'private-purchase@example.invalid',
    )
  })

  it('marks bounded purchase predecessor and payment-event slices as incomplete', async () => {
    const client = await connectClient((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            ...purchaseInvoiceDetailFixture,
            relations: [
              ...purchaseInvoiceDetailFixture.relations,
              {
                id: 801,
                ref_number: 'PP/FIXTURE/801',
                trans_type_id: 16,
                trans_date: '2026-08-26',
                amount_after_tax: '110.00',
              },
            ],
            transactions: [
              ...purchaseInvoiceDetailFixture.transactions,
              {
                ...purchaseInvoiceDetailFixture.transactions[0],
                id: 801,
                trans_date: '2026-08-26',
                amount_after_tax: '110.00',
              },
            ],
          },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'purchase_invoice',
        id: '700',
        include: ['document_lineage', 'payment_events'],
        lineageLimit: 2,
        paymentEventLimit: 1,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      documentLineage: {
        predecessors: [
          { documentType: 'purchase_quote', id: '400' },
          { documentType: 'purchase_order', id: '500' },
        ],
        complete: false,
      },
      paymentEvents: [{ id: '800' }],
      truncation: {
        documentLineage: true,
        omittedLineageDocumentCount: 1,
        paymentEvents: true,
        omittedPaymentEventCount: 1,
      },
    })
  })

  it('fails closed when the Purchase Invoice parent is absent from typed relations', async () => {
    const client = await connectClient((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            ...purchaseInvoiceDetailFixture,
            relations: purchaseInvoiceDetailFixture.relations.filter(
              ({ trans_type_id }) => trans_type_id !== 8,
            ),
          },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'purchase_invoice',
        id: '700',
        include: ['document_lineage'],
      },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'SCHEMA_MISMATCH',
            message: 'Kledo returned an immediate parent missing from Purchase Invoice lineage',
            retryable: false,
          }),
        },
      ],
    })
  })
})
