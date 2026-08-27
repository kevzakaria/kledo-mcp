import { type Readable, type Writable } from 'node:stream'

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

// The SDK can repeat attacker-controlled envelope values in protocol errors.
// Kledo's bounded tool schemas need far less than 1 MiB, and this cap keeps
// even an amplified SDK error comfortably below stdio's 10 MiB output limit.
export const KLEDO_STDIO_MAX_INPUT_BYTES = 1024 * 1024

export function createKledoStdioTransport(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): StdioServerTransport {
  return new StdioServerTransport(stdin, stdout, {
    maxBufferSize: KLEDO_STDIO_MAX_INPUT_BYTES,
  })
}
