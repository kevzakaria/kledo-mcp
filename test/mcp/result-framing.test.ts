import {
  Client,
  InMemoryTransport,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import {
  KLEDO_DOCUMENT_RESOURCE,
  type KledoGateway,
  type KledoGetResult,
} from '../../src/kledo/gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'
import { KLEDO_STDIO_MAX_INPUT_BYTES } from '../../src/server/stdio-transport.js'

const SDK_STDIO_FRAME_LIMIT_BYTES = 10 * 1024 * 1024

describe('MCP result framing', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async (
    gateway: KledoGateway,
  ): Promise<{ client: Client; clientTransport: InMemoryTransport }> => {
    const client = new Client(
      { name: 'kledo-mcp-result-framing-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)
    return { client, clientTransport }
  }

  const callToolWithRequestId = async (
    client: Client,
    clientTransport: InMemoryTransport,
    requestId: string | ((request: JSONRPCRequest) => string),
    request: Parameters<Client['callTool']>[0],
  ): Promise<{
    result: Awaited<ReturnType<Client['callTool']>>
    rawRequest: JSONRPCRequest
    rawResponse: JSONRPCMessage
  }> => {
    const send = clientTransport.send.bind(clientTransport)
    const onmessage = clientTransport.onmessage
    let clientRequestId: string | number | undefined
    let rawRequest: JSONRPCRequest | undefined
    let rawResponse: JSONRPCMessage | undefined
    let wireRequestId: string | undefined

    clientTransport.send = async (message, options) => {
      if (isJSONRPCRequest(message) && message.method === 'tools/call') {
        clientRequestId = message.id
        wireRequestId = typeof requestId === 'function' ? requestId(message) : requestId
        rawRequest = { ...message, id: wireRequestId }
        await send(rawRequest, options)
        return
      }
      await send(message, options)
    }
    clientTransport.onmessage = (message, extra) => {
      if (isJSONRPCResponse(message) && message.id === wireRequestId) {
        rawResponse = message
        if (clientRequestId === undefined) throw new Error('Missing original client request ID')
        onmessage?.({ ...message, id: clientRequestId }, extra)
        return
      }
      onmessage?.(message, extra)
    }

    try {
      const result = await client.callTool(request)
      if (rawRequest === undefined) throw new Error('Missing raw MCP request')
      if (rawResponse === undefined) throw new Error('Missing raw MCP response')
      return { result, rawRequest, rawResponse }
    } finally {
      clientTransport.send = send
      clientTransport.onmessage = onmessage
    }
  }

  it('keeps a multi-mebibyte structured report below the stdio frame limit', async () => {
    const payload = 'x'.repeat(8 * 1024 * 1024 + 256 * 1024)
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used')
      },
      async get() {
        throw new Error('not used')
      },
      async report() {
        return {
          report: 'executive_summary',
          parameters: { month: '2026-08' },
          data: [{ payload }],
          meta: {
            fetchedAt: '2026-08-27T01:00:00.000Z',
            source: 'kledo_native_report',
            complete: true,
            warnings: [],
          },
        }
      },
    }
    const { client } = await connect(gateway)

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: { report: 'executive_summary', month: '2026-08' },
    })

    expect(result.isError).not.toBe(true)
    expect(
      ((result.structuredContent as { data: Array<{ payload: string }> }).data[0]?.payload ?? '')
        .length,
    ).toBe(payload.length)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringMatching(
          /structuredContent.*report=executive_summary.*rows=1.*complete=true.*text mirror omitted/i,
        ),
      },
    ])

    const serializedResultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
    expect(serializedResultBytes).toBeGreaterThan(8 * 1024 * 1024)

    // A one-MiB request ID is itself a valid inbound frame and conservatively
    // reserves far more room than normal JSON-RPC and MCP envelope metadata.
    const serializedFrame = `${JSON.stringify({
      jsonrpc: '2.0',
      id: 'r'.repeat(1024 * 1024),
      result,
    })}\n`
    expect(Buffer.byteLength(serializedFrame, 'utf8')).toBeLessThan(SDK_STDIO_FRAME_LIMIT_BYTES)
  })

  it('returns a bounded safe error when structured content alone cannot fit', async () => {
    const privateMarker = 'private-kledo-data-must-not-be-echoed'
    const payload = `${privateMarker}${'x'.repeat(9 * 1024 * 1024)}`
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used')
      },
      async get() {
        throw new Error('not used')
      },
      async report() {
        return {
          report: 'executive_summary',
          parameters: { month: '2026-08' },
          data: [{ payload }],
          meta: {
            fetchedAt: '2026-08-27T01:00:00.000Z',
            source: 'kledo_native_report',
            complete: true,
            warnings: [],
          },
        }
      },
    }
    const { client } = await connect(gateway)

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: { report: 'executive_summary', month: '2026-08' },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UPSTREAM_RESPONSE_TOO_LARGE',
            message: 'Kledo result exceeded the MCP transport size limit',
            retryable: false,
          }),
        },
      ],
    })
    expect(result).not.toHaveProperty('structuredContent')
    expect(JSON.stringify(result)).not.toContain(privateMarker)

    const serializedFrame = `${JSON.stringify({
      jsonrpc: '2.0',
      id: 'r'.repeat(1024 * 1024),
      result,
    })}\n`
    expect(Buffer.byteLength(serializedFrame, 'utf8')).toBeLessThan(SDK_STDIO_FRAME_LIMIT_BYTES)
  })

  it('accounts for the actual JSON-RPC request ID when bounding a large result', async () => {
    const privateMarker = 'large-id-private-kledo-data-must-not-be-echoed'
    const payload = `${privateMarker}${'x'.repeat(8 * 1024 * 1024 + 256 * 1024)}`
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used')
      },
      async get() {
        throw new Error('not used')
      },
      async report() {
        return {
          report: 'executive_summary',
          parameters: { month: '2026-08' },
          data: [{ payload }],
          meta: {
            fetchedAt: '2026-08-27T01:00:00.000Z',
            source: 'kledo_native_report',
            complete: true,
            warnings: [],
          },
        }
      },
    }
    const { client, clientTransport } = await connect(gateway)
    const requestId = 'r'.repeat(2 * 1024 * 1024)

    const { result, rawResponse } = await callToolWithRequestId(client, clientTransport, requestId, {
      name: 'kledo_report',
      arguments: { report: 'executive_summary', month: '2026-08' },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UPSTREAM_RESPONSE_TOO_LARGE',
            message: 'Kledo result exceeded the MCP transport size limit',
            retryable: false,
          }),
        },
      ],
    })
    expect(result).not.toHaveProperty('structuredContent')
    expect(JSON.stringify(rawResponse)).not.toContain(privateMarker)

    const serializedFrame = `${JSON.stringify(rawResponse)}\n`
    expect(Buffer.byteLength(serializedFrame, 'utf8')).toBeLessThan(
      SDK_STDIO_FRAME_LIMIT_BYTES,
    )
  })

  it('keeps a safe fallback response below 10 MiB for the largest accepted request', async () => {
    const privateMarker = 'fallback-private-kledo-error-must-not-leak'
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used')
      },
      async get() {
        throw new Error('not used')
      },
      async report() {
        throw new Error(privateMarker)
      },
    }
    const { client, clientTransport } = await connect(gateway)

    const { result, rawRequest, rawResponse } = await callToolWithRequestId(
      client,
      clientTransport,
      (request) => {
        const requestWithoutIdBytes = Buffer.byteLength(
          `${JSON.stringify({ ...request, id: '' })}\n`,
          'utf8',
        )
        return 'r'.repeat(KLEDO_STDIO_MAX_INPUT_BYTES - requestWithoutIdBytes)
      },
      {
        name: 'kledo_report',
        arguments: { report: 'executive_summary', month: '2026-08' },
      },
    )

    expect(Buffer.byteLength(`${JSON.stringify(rawRequest)}\n`, 'utf8')).toBe(
      KLEDO_STDIO_MAX_INPUT_BYTES,
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(rawResponse)).not.toContain(privateMarker)
    expect(Buffer.byteLength(`${JSON.stringify(rawResponse)}\n`, 'utf8')).toBeLessThan(
      SDK_STDIO_FRAME_LIMIT_BYTES,
    )
  })

  it('embeds a maximum-sized PDF once and still enforces the actual response frame', async () => {
    const pdfBytes = Buffer.alloc(6 * 1024 * 1024, 0x61)
    pdfBytes.write('%PDF-', 0, 'ascii')
    const blob = pdfBytes.toString('base64')
    const output: KledoGetResult = {
      entity: 'sales_invoice',
      record: { kind: 'sales_invoice', id: '500' },
      printDocument: {
        resourceUri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        byteCount: pdfBytes.byteLength,
        sha256: 'a'.repeat(64),
      },
      truncation: { lineItems: false },
      meta: { fetchedAt: '2026-08-28T01:00:00.000Z', warnings: [] },
    }
    Object.defineProperty(output, KLEDO_DOCUMENT_RESOURCE, {
      value: {
        uri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        blob,
      },
      enumerable: false,
    })
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used')
      },
      async get() {
        return output
      },
      async report() {
        throw new Error('not used')
      },
    }
    const { client, clientTransport } = await connect(gateway)

    const ordinaryResult = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(ordinaryResult.isError).not.toBe(true)
    expect(ordinaryResult.content).toContainEqual({
      type: 'resource',
      resource: {
        uri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        blob,
      },
    })
    expect(JSON.stringify(ordinaryResult.structuredContent)).not.toContain(blob.slice(0, 128))
    expect(Buffer.byteLength(JSON.stringify(ordinaryResult), 'utf8')).toBeLessThan(
      SDK_STDIO_FRAME_LIMIT_BYTES,
    )

    const { result, rawResponse } = await callToolWithRequestId(
      client,
      clientTransport,
      'r'.repeat(2 * 1024 * 1024),
      {
        name: 'kledo_get',
        arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
      },
    )

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UPSTREAM_RESPONSE_TOO_LARGE',
            message: 'Kledo result exceeded the MCP transport size limit',
            retryable: false,
          }),
        },
      ],
    })
    expect(JSON.stringify(rawResponse)).not.toContain(blob.slice(0, 128))
    expect(Buffer.byteLength(`${JSON.stringify(rawResponse)}\n`, 'utf8')).toBeLessThan(
      SDK_STDIO_FRAME_LIMIT_BYTES,
    )
  })
})
