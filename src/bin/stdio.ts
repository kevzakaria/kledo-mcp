#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { loadKledoProcessConfig } from '../config.js'
import { createKledoHttpGateway } from '../kledo/http-gateway.js'
import { createKledoMcpServer } from '../server/create-server.js'
import { createKledoStdioTransport } from '../server/stdio-transport.js'

try {
  const config = loadKledoProcessConfig()
  const gateway = createKledoHttpGateway(config)
  const handle = serveStdio(() => createKledoMcpServer({ gateway }), {
    legacy: 'serve',
    transport: createKledoStdioTransport(),
    onerror: () => {
      process.stderr.write('Kledo MCP transport error\n')
    },
  })

  const close = () => {
    void handle.close().finally(() => {
      process.exitCode = 0
    })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
} catch {
  process.stderr.write('Kledo MCP configuration error\n')
  process.exitCode = 1
}
