#!/usr/bin/env node

import { loadKledoProcessConfig } from '../config.js'
import { publicKledoError } from '../kledo/errors.js'
import { createKledoHttpGateway } from '../kledo/http-gateway.js'

try {
  const config = loadKledoProcessConfig()
  const gateway = createKledoHttpGateway(config)
  const result = await gateway.warmIdentityCatalog()
  const counts = Object.entries(result.counts)
    .map(([entityType, count]) => `${entityType}=${count}`)
    .join(', ')
  process.stdout.write(
    `Kledo identity warm-up complete. Stored ${counts} at ${result.fetchedAt}.\n`,
  )
} catch (error) {
  const safe = publicKledoError(error)
  process.stderr.write(`Kledo identity warm-up failed (${safe.code}). ${safe.message}\n`)
  process.exitCode = 1
}
