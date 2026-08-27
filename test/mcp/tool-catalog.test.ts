import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoMcpServer } from '../../src/server/create-server.js'
import type { KledoGateway } from '../../src/kledo/gateway.js'

describe('Kledo MCP tool catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('advertises exactly the three approved read-only tools over MCP 2026', async () => {
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used while listing tools')
      },
      async get() {
        throw new Error('not used while listing tools')
      },
      async report() {
        throw new Error('not used while listing tools')
      },
    }

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

    const { tools } = await client.listTools()

    expect(tools.map(({ name }) => name)).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
    expect(
      tools.map(({ annotations }) => annotations),
    ).toEqual([
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    ])
    expect(tools.every(({ inputSchema, outputSchema }) => inputSchema && outputSchema)).toBe(true)
    expect(
      tools.every(({ description }) =>
        /business text.*untrusted data.*never.*instructions/i.test(description ?? ''),
      ),
    ).toBe(true)

    const queryTool = tools.find(({ name }) => name === 'kledo_query')
    const queryProperties = queryTool?.inputSchema.properties as
      | Record<
          string,
          {
            description?: string
            items?: {
              description?: string
              enum?: string[]
              properties?: Record<string, { description?: string; enum?: string[] }>
            }
          }
        >
      | undefined
    const filterField = queryProperties?.filters?.items?.properties?.field
    const sortField = queryProperties?.sort?.items?.properties?.field

    expect(queryTool?.description).toMatch(/sales_invoice.*contactId.*bank_transaction.*bankAccountId/is)
    expect(filterField?.enum).toEqual([
      'contactId',
      'statusId',
      'productId',
      'warehouseId',
      'salesPersonId',
      'bankAccountId',
      'transactionType',
      'typeId',
      'groupId',
      'categoryId',
      'archived',
      'canSell',
      'canPurchase',
      'tracked',
      'transactionDate',
      'dueDate',
      'shippingDate',
      'paymentDate',
      'amount',
    ])
    expect(filterField?.description).toMatch(/warehouse=none.*unit=none/is)
    expect(filterField?.description).toMatch(/ID filter operations default to eq only/i)
    expect(filterField?.description).toMatch(
      /in is allowed only for.*productId.*product\.categoryId.*bank_transaction\.transactionType.*sales_order\.statusId.*warehouseId.*purchase_invoice.*sales_quote/is,
    )
    expect(queryTool?.description).toMatch(/ID filter operations default to eq only/i)
    expect(sortField?.enum).toEqual([
      'transactionDate',
      'statusId',
      'dueDate',
      'total',
      'memo',
      'reference',
      'remaining',
      'paymentDate',
      'name',
      'company',
      'payable',
      'receivable',
      'code',
      'category',
      'basePrice',
      'salePrice',
    ])
    expect(sortField?.description).toMatch(/contact=.*payable.*warehouse=none/is)
    expect(queryProperties?.fields?.items?.enum).toEqual(
      expect.arrayContaining(['kind', 'id', 'party', 'paymentState', 'displayName', 'balance']),
    )
    expect(queryProperties?.fields?.items?.description).toMatch(/sales_invoice.*contact=.*displayName/is)
  })
})
