import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_get sales invoice', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('returns normalized detail, bounded line items, relation IDs, and no contact PII', async () => {
    const upstream = createServer((request, response) => {
      if (
        request.url !== '/api/v1/finance/invoices/9223372036854775807' ||
        request.headers.authorization !== 'Bearer fixture-secret'
      ) {
        response.writeHead(404).end()
        return
      }

      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          message: 'Invoice retrieved',
          data: {
            id: '9223372036854775807',
            ref_number: 'INV/2026/001',
            trans_date: '2026-08-01',
            due_date: '2026-08-31',
            shipping_date: '2026-08-15',
            contact: {
              id: 44,
              name: 'Alya',
              company: 'PT Maju Jaya',
              email: 'private@example.invalid',
              phone: '+62000000000',
              npwp: 'private-tax-id',
              address: 'private address',
            },
            amount_after_tax: '1500000.00',
            due: '500000.00',
            currency_id: 2,
            currency: { id: 2, code: 'USD', name: 'US Dollar' },
            memo: 'Routine installation',
            status_id: 3,
            updated_at: '2026-08-20T03:04:05Z',
            items: [
              {
                id: 501,
                desc: 'Service item',
                qty: '2.0000',
                price: '500000.00',
                amount: '1000000.00',
                amount_after_tax: '1110000.00',
                tax: '110000.00',
                subtotal: '1000000.00',
                product: { id: 71, code: 'SRV-01', name: 'Service' },
                item_tax: { id: 1, name: 'PPN', percent: 11 },
              },
              {
                id: 502,
                desc: null,
                qty: 1,
                price: 390000,
                amount: 390000,
                amount_after_tax: 390000,
                tax: 0,
                subtotal: 390000,
                product: null,
                item_tax: null,
              },
            ],
            parent_tran: {
              id: 99,
              ref_number: 'SO/2026/099',
              trans_type_id: 6,
              trans_date: '2026-07-30',
            },
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
      tenant: 'fixture-tenant',
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

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'sales_invoice',
        id: '9223372036854775807',
        include: ['line_items', 'relation_ids'],
        lineItemLimit: 1,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      entity: 'sales_invoice',
      record: {
        kind: 'sales_invoice',
        id: '9223372036854775807',
        reference: 'INV/2026/001',
        transactionDate: '2026-08-01',
        dueDate: '2026-08-31',
        shippingDate: '2026-08-15',
        statusId: '3',
        party: {
          id: '44',
          displayName: 'PT Maju Jaya',
          companyName: 'PT Maju Jaya',
          personName: 'Alya',
        },
        memo: 'Routine installation',
        total: {
          amount: '1500000.00',
          currency: 'USD',
          currencyId: '2',
          currencyName: 'US Dollar',
        },
        remaining: {
          amount: '500000.00',
          currency: 'USD',
          currencyId: '2',
          currencyName: 'US Dollar',
        },
        paymentState: 'partially_paid',
        sourceUpdatedAt: '2026-08-20T03:04:05Z',
      },
      lineItems: [
        {
          id: '501',
          description: 'Service item',
          quantity: '2.0000',
          unitPrice: {
            amount: '500000.00',
            currency: 'USD',
            currencyId: '2',
            currencyName: 'US Dollar',
          },
          subtotal: {
            amount: '1000000.00',
            currency: 'USD',
            currencyId: '2',
            currencyName: 'US Dollar',
          },
          total: {
            amount: '1110000.00',
            currency: 'USD',
            currencyId: '2',
            currencyName: 'US Dollar',
          },
          tax: {
            amount: '110000.00',
            currency: 'USD',
            currencyId: '2',
            currencyName: 'US Dollar',
          },
          product: { id: '71', code: 'SRV-01', name: 'Service' },
          taxRate: { id: '1', name: 'PPN', percent: '11' },
        },
      ],
      relations: [{ relation: 'derived_from', entity: 'sales_order', id: '99' }],
      truncation: { lineItems: true, omittedCount: 1 },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        warnings: [],
      },
    })
    expect(JSON.stringify(result.structuredContent)).not.toContain('private@')
    expect(JSON.stringify(result.structuredContent)).not.toContain('private-tax-id')
    expect(JSON.stringify(result.structuredContent)).not.toContain('private address')
  })

  it('rejects unsafe integer tokens and preserves exact large IDs and decimals', async () => {
    const upstream = createServer((request, response) => {
      const testCase = request.url?.split('/').at(-1)
      const unsafeNumber = '9007199254740993'
      const exactLargeString = `"${unsafeNumber}"`
      const wireId = (unsafeCase: string, fallback: string): string =>
        testCase === unsafeCase ? unsafeNumber : testCase === '108' ? exactLargeString : fallback
      const invoiceId = wireId('101', '101')
      const contactId = wireId('102', '44')
      const lineItemId = wireId('103', '501')
      const productId = wireId('104', '71')
      const taxId = wireId('105', '1')
      const parentId = wireId('106', '99')
      const quantity = testCase === '107' ? unsafeNumber : '"1.0000"'
      const amountAfterTax = testCase === '109' ? '9007199254740990.5' : '"1.00"'
      response.setHeader('content-type', 'application/json')
      response.end(
        `{"success":true,"data":{"id":${invoiceId},"ref_number":"INV/2026/unsafe","trans_date":"2026-08-01","due_date":null,"contact":{"id":${contactId},"name":"Fixture","company":null},"amount_after_tax":${amountAfterTax},"due":"0","memo":null,"items":[{"id":${lineItemId},"desc":null,"qty":${quantity},"price":"1.00","amount":"1.00","amount_after_tax":"1.00","tax":"0","subtotal":"1.00","product":{"id":${productId},"code":"FIX","name":"Fixture"},"item_tax":{"id":${taxId},"name":"Fixture tax","percent":"1.00"}}],"parent_tran":{"id":${parentId},"ref_number":"SO/2026/unsafe"}}}`,
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

    for (const id of ['101', '102', '103', '104', '105', '106', '107']) {
      const result = await client.callTool({
        name: 'kledo_get',
        arguments: { entity: 'sales_invoice', id },
      })

      expect(result, id).toMatchObject({
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
    }

    const exactStringResult = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'sales_invoice',
        id: '108',
        include: ['line_items', 'relation_ids'],
      },
    })
    expect(exactStringResult.isError).not.toBe(true)
    expect(exactStringResult.structuredContent).toMatchObject({
      record: {
        id: '9007199254740993',
        party: { id: '9007199254740993' },
      },
      lineItems: [
        {
          id: '9007199254740993',
          product: { id: '9007199254740993' },
          taxRate: { id: '9007199254740993' },
        },
      ],
      relations: [{ id: '9007199254740993' }],
    })

    const exactDecimalResult = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '109' },
    })
    expect(exactDecimalResult.isError).not.toBe(true)
    expect(exactDecimalResult.structuredContent).toMatchObject({
      record: { total: { amount: '9007199254740990.5' } },
    })
  })
})
