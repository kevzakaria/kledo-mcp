import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterEach, describe, expect, it } from 'vitest'

describe('packaged stdio executable', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('negotiates MCP 2026 over real pipes with protocol-clean stdout', async () => {
    const token = 'stdio-fixture-token-must-not-leak'
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/bin/stdio.js')],
      cwd: resolve('.'),
      env: {
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: token,
      },
      stderr: 'pipe',
    })
    const stderr: Buffer[] = []
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    const client = new Client(
      { name: 'kledo-mcp-stdio-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    closeables.push(client, transport)

    await client.connect(transport)
    const { tools } = await client.listTools()

    expect(tools.map(({ name }) => name)).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
    expect(Buffer.concat(stderr).toString('utf8')).not.toContain(token)
  })

  it('negotiates the MCP 2025-06-18 protocol used by Codex', () => {
    const token = 'legacy-stdio-fixture-token-must-not-leak'
    const requests = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'codex-compat-test', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]

    const result = spawnSync(process.execPath, [resolve('dist/bin/stdio.js')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: token,
      },
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      timeout: 5_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(token)
    expect(result.stderr).not.toContain(token)

    const responses = result.stdout
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            id: number
            result?: {
              protocolVersion?: string
              tools?: Array<{ name: string }>
            }
            error?: unknown
          },
      )

    expect(responses.find(({ id }) => id === 1)).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18' },
    })
    expect(responses.find(({ id }) => id === 2)?.result?.tools?.map(({ name }) => name)).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
  })
})
