import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadKledoProcessConfig } from '../../src/config.js'

describe('Kledo process configuration', () => {
  it('places the persistent identity catalog in the configured local state directory', () => {
    const config = loadKledoProcessConfig({
      KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
      KLEDO_API_TOKEN: 'fixture-secret',
      KLEDO_STATE_DIR: '/private/kledo-mcp-state',
    })

    expect(config.identityCatalogPath).toBe(
      join('/private/kledo-mcp-state', 'identity-catalog.sqlite'),
    )
  })

  it('rejects a relative local state directory', () => {
    expect(() =>
      loadKledoProcessConfig({
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: 'fixture-secret',
        KLEDO_STATE_DIR: 'relative-state',
      }),
    ).toThrow('KLEDO_STATE_DIR must be an absolute path')
  })
})
