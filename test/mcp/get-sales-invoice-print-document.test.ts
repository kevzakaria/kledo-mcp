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

const fixturePdfBase64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MiA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDMwIDEwMCBUZCAoS2xlZG8gUERGIGZpeHR1cmUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzM5IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDA5CiUlRU9GCg=='
const fixturePdf = Buffer.from(fixturePdfBase64, 'base64')
const fixturePdfSha256 = '4f66cd87a350fb7581397c77a2a775e1202f8b682236aaeff615817aa18b2074'
const privatePrintLocator = 'fixture-print-locator'

const salesInvoiceFixture = {
  id: 500,
  ref_number: 'INV/FIXTURE/500',
  trans_type_id: 5,
  trans_date: '2026-08-20',
  due_date: '2026-09-20',
  shipping_date: '2026-08-19',
  contact: { id: 44, name: 'Fixture Person', company: 'Fixture Company' },
  amount_after_tax: '1110.00',
  due: '610.00',
  memo: 'Fixture Project',
  status_id: 3,
  items: [],
  relations: [],
  parent_tran: null,
  print_url: privatePrintLocator,
}

describe('kledo_get Sales Invoice print document', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  async function connectClient(
    handler: RequestListener,
    gatewayOptions: {
      maxPrintDocumentBytes?: number
      printDocumentTimeoutMs?: number
      maxAttempts?: number
    } = {},
  ): Promise<Client> {
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
      now: () => new Date('2026-08-28T03:00:00.000Z'),
      ...gatewayOptions,
    })
    const client = new Client(
      { name: 'kledo-mcp-print-document-test', version: '0.1.0' },
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

  it('retrieves a bounded PDF through the public tool without exposing the opaque locator', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      if (request.headers.authorization !== 'Bearer fixture-secret') {
        response.writeHead(404).end()
        return
      }

      if (request.url === '/api/v1/finance/invoices/500') {
        traceStep('Kledo fixture API', 'Sales Invoice detail exposes an internal print locator')
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }

      if (request.url === `/api/v1/finance/invoices/500/download/${privatePrintLocator}`) {
        traceStep('Kledo fixture API', `validated PDF response (${fixturePdf.byteLength} bytes)`)
        response.setHeader('content-type', 'application/pdf')
        response.setHeader('content-length', String(fixturePdf.byteLength))
        response.end(fixturePdf)
        return
      }

      response.writeHead(404).end()
    })

    traceStep('MCP client', 'kledo_get(sales_invoice, include=print_document)')
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/finance/invoices/500',
      `/api/v1/finance/invoices/500/download/${privatePrintLocator}`,
    ])
    expect(result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      printDocument: {
        resourceUri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        byteCount: fixturePdf.byteLength,
        sha256: fixturePdfSha256,
      },
    })
    expect(result.content).toContainEqual({
      type: 'resource',
      resource: {
        uri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        blob: fixturePdfBase64,
      },
    })
    expect(JSON.stringify(result)).not.toContain(privatePrintLocator)
  })

  it('fails explicitly when the invoice detail has no printable PDF locator', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: { ...salesInvoiceFixture, print_url: null },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(requestedUrls).toEqual(['/api/v1/finance/invoices/500'])
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UNSUPPORTED_OPERATION',
            message: 'This Sales Invoice does not provide a printable PDF',
            retryable: false,
          }),
        },
      ],
    })
  })

  it.each([
    {
      label: 'non-PDF media type',
      contentType: 'text/html',
      body: Buffer.from('%PDF-fake'),
    },
    {
      label: 'missing PDF magic bytes',
      contentType: 'application/pdf',
      body: Buffer.from('not-a-pdf'),
    },
  ])('rejects a $label without returning its body', async ({ contentType, body }) => {
    const client = await connectClient((request, response) => {
      if (request.url === '/api/v1/finance/invoices/500') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }
      response.setHeader('content-type', contentType)
      response.end(body)
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'SCHEMA_MISMATCH',
            message: 'Kledo returned an invalid print document',
            retryable: false,
          }),
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(body.toString('utf8'))
  })

  it('rejects a declared PDF larger than the document byte limit', async () => {
    const client = await connectClient((request, response) => {
      if (request.url === '/api/v1/finance/invoices/500') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }
      response.setHeader('content-type', 'application/pdf')
      response.setHeader('content-length', '33')
      response.end()
    }, { maxPrintDocumentBytes: 32 })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UPSTREAM_RESPONSE_TOO_LARGE',
            message: 'Kledo response exceeded the configured size limit',
            retryable: false,
          }),
        },
      ],
    })
  })

  it('stops a chunked PDF once streamed bytes exceed the document byte limit', async () => {
    const client = await connectClient((request, response) => {
      if (request.url === '/api/v1/finance/invoices/500') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }
      response.setHeader('content-type', 'application/pdf')
      response.setHeader('transfer-encoding', 'chunked')
      response.write(Buffer.from('%PDF-123456789012345'))
      response.end(Buffer.from('67890123456789012345'))
    }, { maxPrintDocumentBytes: 32 })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('UPSTREAM_RESPONSE_TOO_LARGE'),
        },
      ],
    })
    expect(result).not.toHaveProperty('structuredContent')
  })

  it('rejects print_document for non-Sales-Invoice entities before any HTTP request', async () => {
    let requestCount = 0
    const client = await connectClient((_request, response) => {
      requestCount += 1
      response.writeHead(500).end()
    })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'purchase_invoice', id: '700', include: ['print_document'] },
    })

    expect(requestCount).toBe(0)
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('purchase_invoice does not support print_document'),
        },
      ],
    })
  })

  it('does not follow a print redirect or forward the bearer token to its target', async () => {
    let redirectedRequestCount = 0
    const redirectTarget = createServer((_request, response) => {
      redirectedRequestCount += 1
      response.end(fixturePdf)
    })
    await new Promise<void>((resolve) => redirectTarget.listen(0, '127.0.0.1', resolve))
    const { port: redirectPort } = redirectTarget.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          redirectTarget.close((error) => (error ? reject(error) : resolve())),
        ),
    })

    const client = await connectClient((request, response) => {
      if (request.url === '/api/v1/finance/invoices/500') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }
      response.writeHead(302, {
        location: `http://127.0.0.1:${redirectPort}/must-not-receive-auth`,
      })
      response.end()
    }, { maxAttempts: 1 })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result.isError).toBe(true)
    expect(redirectedRequestCount).toBe(0)
    expect(JSON.stringify(result)).not.toContain(privatePrintLocator)
  })

  it('applies a dedicated bounded timeout while Kledo generates the PDF', async () => {
    const client = await connectClient((request, response) => {
      if (request.url === '/api/v1/finance/invoices/500') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ success: true, data: salesInvoiceFixture }))
        return
      }
      setTimeout(() => {
        response.setHeader('content-type', 'application/pdf')
        response.end(fixturePdf)
      }, 50)
    }, { printDocumentTimeoutMs: 5, maxAttempts: 1 })

    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_invoice', id: '500', include: ['print_document'] },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'UPSTREAM_TIMEOUT',
            message: 'Kledo request timed out',
            retryable: true,
          }),
        },
      ],
    })
  })
})
