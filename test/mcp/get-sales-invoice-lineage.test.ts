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

const salesInvoiceDetailFixture = {
  id: 500,
  ref_number: 'INV/FIXTURE/500',
  trans_type_id: 5,
  trans_date: '2026-08-20',
  due_date: '2026-09-20',
  shipping_date: '2026-08-19',
  contact: {
    id: 44,
    name: 'Private Fixture Person',
    company: 'Private Fixture Company',
    email: 'private-fixture@example.invalid',
  },
  amount_after_tax: '1110.00',
  due: '610.00',
  memo: 'Private Fixture Project',
  status_id: 3,
  items: [],
  parent_tran: {
    id: 300,
    ref_number: 'DO/FIXTURE/300',
    trans_type_id: 7,
  },
  relations: [
    {
      id: 200,
      ref_number: 'SO/FIXTURE/200',
      trans_type_id: 6,
      trans_date: '2026-08-10',
      business_tran_id: 100,
      contact: { email: 'private-relation@example.invalid' },
    },
    {
      id: 300,
      ref_number: 'DO/FIXTURE/300',
      trans_type_id: 7,
      trans_date: '2026-08-19',
      business_tran_id: 200,
    },
    {
      id: 100,
      ref_number: 'QU/FIXTURE/100',
      trans_type_id: 4,
      trans_date: '2026-08-01',
      business_tran_id: null,
    },
    {
      id: 600,
      ref_number: 'IP/FIXTURE/600',
      trans_type_id: 17,
      trans_date: '2026-08-25',
      amount_after_tax: '500.00',
      business_tran_id: null,
    },
  ],
}

const invoicePaymentTransactionsFixture = [
  {
    id: 600,
    business_tran_id: 500,
    trans_type_id: 17,
    trans_date: '2026-08-25',
    amount_after_tax: '500.00',
    status_id: 3,
    bank_account_id: 77,
    payment_type_id: null,
    bank_account: { id: 77, name: 'Fixture Bank' },
  },
  { id: 200, trans_type_id: 6 },
]

describe('kledo_get Sales Invoice document lineage', () => {
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

  it('returns a typed QU to SO to DO predecessor chain and a joined Invoice Payment event', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')

      if (request.url === '/api/v1/finance/invoices/500') {
        traceStep('Kledo fixture API', 'Sales Invoice detail with full typed relations')
        response.end(
          JSON.stringify({
            success: true,
            data: salesInvoiceDetailFixture,
          }),
        )
        return
      }

      if (request.url === '/api/v1/finance/invoices/500/transactions') {
        traceStep('Kledo fixture API', 'compact Invoice Payment transactions')
        response.end(
          JSON.stringify({
            success: true,
            data: invoicePaymentTransactionsFixture,
          }),
        )
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    traceStep('MCP client', 'kledo_get(document_lineage + payment_events + relation_ids)')
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'sales_invoice',
        id: '500',
        include: ['document_lineage', 'payment_events', 'relation_ids'],
        lineageLimit: 50,
        paymentEventLimit: 50,
      },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/finance/invoices/500',
      '/api/v1/finance/invoices/500/transactions',
    ])
    expect(result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      documentLineage: {
        anchor: {
          documentType: 'sales_invoice',
          transactionTypeId: '5',
          id: '500',
          number: 'INV/FIXTURE/500',
        },
        immediateParent: {
          documentType: 'sales_delivery',
          transactionTypeId: '7',
          id: '300',
          number: 'DO/FIXTURE/300',
        },
        predecessors: [
          {
            documentType: 'sales_quote',
            transactionTypeId: '4',
            id: '100',
            number: 'QU/FIXTURE/100',
          },
          {
            documentType: 'sales_order',
            transactionTypeId: '6',
            id: '200',
            number: 'SO/FIXTURE/200',
          },
          {
            documentType: 'sales_delivery',
            transactionTypeId: '7',
            id: '300',
            number: 'DO/FIXTURE/300',
          },
        ],
        complete: true,
      },
      paymentEvents: [
        {
          relation: 'payment_for',
          documentType: 'invoice_payment',
          transactionTypeId: '17',
          id: '600',
          invoiceId: '500',
          number: 'IP/FIXTURE/600',
          transactionDate: '2026-08-25',
          amount: { amount: '500.00', currency: null },
          statusId: '3',
          bankAccount: { id: '77', name: 'Fixture Bank' },
          paymentTypeId: null,
        },
      ],
      relations: [{ relation: 'derived_from', entity: 'sales_delivery', id: '300' }],
      truncation: {
        lineItems: false,
        documentLineage: false,
        paymentEvents: false,
      },
      meta: {
        fetchedAt: '2026-08-28T01:00:00.000Z',
        tenant: 'fixture-tenant',
        warnings: [],
      },
    })
    const serialized = JSON.stringify(result.structuredContent)
    expect(serialized).not.toContain('private-fixture@example.invalid')
    expect(serialized).not.toContain('private-relation@example.invalid')
  })

  it('marks bounded predecessor and payment-event slices as incomplete', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url?.endsWith('/transactions')) {
        response.end(
          JSON.stringify({
            success: true,
            data: [
              ...invoicePaymentTransactionsFixture,
              {
                ...invoicePaymentTransactionsFixture[0],
                id: 601,
                trans_date: '2026-08-26',
                amount_after_tax: '110.00',
              },
            ],
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          success: true,
          data: {
            ...salesInvoiceDetailFixture,
            relations: [
              ...salesInvoiceDetailFixture.relations,
              {
                id: 601,
                ref_number: 'IP/FIXTURE/601',
                trans_type_id: 17,
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
        entity: 'sales_invoice',
        id: '500',
        include: ['document_lineage', 'payment_events'],
        lineageLimit: 2,
        paymentEventLimit: 1,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/finance/invoices/500',
      '/api/v1/finance/invoices/500/transactions',
    ])
    expect(result.structuredContent).toMatchObject({
      documentLineage: {
        predecessors: [
          { documentType: 'sales_quote', id: '100' },
          { documentType: 'sales_order', id: '200' },
        ],
        complete: false,
      },
      paymentEvents: [{ id: '600' }],
      truncation: {
        documentLineage: true,
        omittedLineageDocumentCount: 1,
        paymentEvents: true,
        omittedPaymentEventCount: 1,
      },
    })
  })

  it('fails closed when the immediate parent is absent from authoritative relations', async () => {
    const client = await connectClient((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            ...salesInvoiceDetailFixture,
            relations: salesInvoiceDetailFixture.relations.filter(
              ({ trans_type_id }) => trans_type_id !== 7,
            ),
          },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'sales_invoice',
        id: '500',
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
            message: 'Kledo returned an immediate parent missing from Sales Invoice lineage',
            retryable: false,
          }),
        },
      ],
    })
  })
})
