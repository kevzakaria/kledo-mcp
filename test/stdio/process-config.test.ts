import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadKledoProcessConfig } from '../../src/config.js'

describe('Kledo process configuration', () => {
  it('keeps identity resolution memory-only by default', () => {
    const config = loadKledoProcessConfig({
      KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
      KLEDO_API_TOKEN: 'fixture-secret',
    })

    expect(config).not.toHaveProperty('identityCatalogPath')
  })

  it('places the persistent identity catalog in the configured local state directory', () => {
    const config = loadKledoProcessConfig({
      KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
      KLEDO_API_TOKEN: 'fixture-secret',
      KLEDO_IDENTITY_CACHE: 'sqlite',
      KLEDO_STATE_DIR: '/private/kledo-mcp-state',
    })

    expect(config.identityCatalogPath).toBe(
      join('/private/kledo-mcp-state', 'identity-catalog.sqlite'),
    )
    expect(config.debug).toBe(false)
  })

  it('enables only the explicit sanitized debug mode', () => {
    const config = loadKledoProcessConfig({
      KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
      KLEDO_API_TOKEN: 'fixture-secret',
      KLEDO_DEBUG: '1',
    })

    expect(config.debug).toBe(true)
    expect(() =>
      loadKledoProcessConfig({
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: 'fixture-secret',
        KLEDO_DEBUG: 'verbose',
      }),
    ).toThrow('KLEDO_DEBUG must be 0 or 1')
  })

  it('rejects a relative local state directory', () => {
    expect(() =>
      loadKledoProcessConfig({
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: 'fixture-secret',
        KLEDO_IDENTITY_CACHE: 'sqlite',
        KLEDO_STATE_DIR: 'relative-state',
      }),
    ).toThrow('KLEDO_STATE_DIR must be an absolute path')
  })

  it('rejects a persistent state directory without SQLite opt-in', () => {
    expect(() =>
      loadKledoProcessConfig({
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: 'fixture-secret',
        KLEDO_STATE_DIR: '/private/kledo-mcp-state',
      }),
    ).toThrow('KLEDO_STATE_DIR requires KLEDO_IDENTITY_CACHE=sqlite')
  })

  it('rejects an unknown identity-cache mode', () => {
    expect(() =>
      loadKledoProcessConfig({
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: 'fixture-secret',
        KLEDO_IDENTITY_CACHE: 'disk',
      }),
    ).toThrow('KLEDO_IDENTITY_CACHE must be memory or sqlite')
  })
})
