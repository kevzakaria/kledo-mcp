import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import type { KledoGateway } from '../../src/kledo/gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

function typeArrayPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => typeArrayPaths(item, `${path}[${index}]`))
  }
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === 'type' && Array.isArray(child) ? [`${path}.type`] : []),
    ...typeArrayPaths(child, `${path}.${key}`),
  ])
}

describe('published tool JSON Schemas', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('write every nullable field as anyOf, never as a type array', async () => {
    const unused = async () => {
      throw new Error('not used while listing tools')
    }
    const gateway: KledoGateway = { query: unused, get: unused, report: unused }
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

    expect(tools.map(({ name }) => name).sort()).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
    for (const tool of tools) {
      expect(typeArrayPaths(tool.inputSchema), tool.name).toEqual([])
      expect(typeArrayPaths(tool.outputSchema), tool.name).toEqual([])
    }
    const get = tools.find(({ name }) => name === 'kledo_get')
    const outputSchema = get?.outputSchema as {
      properties: { invoicePayments: { items: { properties: { amount: unknown } } } }
    }
    expect(outputSchema.properties.invoicePayments.items.properties.amount).toMatchObject({
      properties: { currency: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    })
  })
})
