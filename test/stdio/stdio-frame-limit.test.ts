import { PassThrough } from 'node:stream'

import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import type { KledoGateway } from '../../src/kledo/gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'
import {
  createKledoStdioTransport,
  KLEDO_STDIO_MAX_INPUT_BYTES,
} from '../../src/server/stdio-transport.js'

function unsupportedDiscoverFrame(bytes: number): Buffer {
  const prefix = Buffer.from(
    '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"unsupported-',
    'utf8',
  )
  const suffix = Buffer.from(
    '","io.modelcontextprotocol/clientCapabilities":{}}}}\n',
    'utf8',
  )
  const paddingBytes = bytes - prefix.length - suffix.length
  if (paddingBytes < 0) throw new Error('Requested frame is too small')

  const frame = Buffer.allocUnsafe(bytes)
  prefix.copy(frame, 0)
  frame.fill(0x78, prefix.length, prefix.length + paddingBytes)
  suffix.copy(frame, prefix.length + paddingBytes)
  return frame
}

const unusedGateway: KledoGateway = {
  async query() {
    throw new Error('not used')
  },
  async get() {
    throw new Error('not used')
  },
  async report() {
    throw new Error('not used')
  },
}

describe('Kledo stdio input frame limit', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const startServer = (
    input: PassThrough,
    output: PassThrough,
    onerror: (error: Error) => void = () => {},
  ) => {
    const handle = serveStdio(() => createKledoMcpServer({ gateway: unusedGateway }), {
      legacy: 'reject',
      transport: createKledoStdioTransport(input, output),
      onerror,
    })
    closeables.push(handle)
    return handle
  }

  it('keeps an amplified protocol error below 10 MiB for an exact-cap request', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    startServer(input, output)

    const responseReceived = new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = []
      output.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        if (chunk.includes(0x0a)) resolve(Buffer.concat(chunks))
      })
    })

    input.end(unsupportedDiscoverFrame(KLEDO_STDIO_MAX_INPUT_BYTES))
    const responseFrame = await responseReceived

    expect(responseFrame.length).toBeLessThan(STDIO_DEFAULT_MAX_BUFFER_SIZE)
    expect(JSON.parse(responseFrame.toString('utf8'))).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: {
        data: { requested: expect.stringMatching(/^unsupported-/) },
      },
    })
  })

  it('rejects a request one byte above the production cap', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const errorReceived = new Promise<Error>((resolve) => {
      startServer(input, output, resolve)
    })

    input.end(unsupportedDiscoverFrame(KLEDO_STDIO_MAX_INPUT_BYTES + 1))

    await expect(errorReceived).resolves.toMatchObject({
      message: `ReadBuffer exceeded maximum size of ${KLEDO_STDIO_MAX_INPUT_BYTES} bytes`,
    })
  })
})
