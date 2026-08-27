import { describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'

describe('Kledo API origin boundary', () => {
  it.each([
    'http://tenant.example/api/v1/',
    'http://company.example/api/v1/',
    'https://api.kledo.com/not-api-v1/',
    'https://user:password@api.kledo.com/api/v1/',
    'https://api.kledo.com/api/v1/?redirect=https://attacker.example',
    'https://api.kledo.com/api/v1/#secret',
  ])('rejects unsafe configured base URL %s', (baseUrl) => {
    expect(() => createKledoHttpGateway({ baseUrl: new URL(baseUrl), token: 'fixture-secret' })).toThrow()
  })

  it.each([
    'https://api.kledo.com/api/v1/',
    'https://tenant.example/api/v1/',
    'https://api.maju-jaya.example/api/v1/',
    'https://kledo-api.company.example/api/v1/',
  ])('accepts operator-configured HTTPS Kledo API origins %s', (baseUrl) => {
    expect(() => createKledoHttpGateway({ baseUrl: new URL(baseUrl), token: 'fixture-secret' })).not.toThrow()
  })
})
