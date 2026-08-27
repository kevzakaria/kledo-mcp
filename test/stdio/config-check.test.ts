import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('configuration check executable', () => {
  it('validates production configuration without exposing the token', () => {
    const token = 'configuration-check-token-must-not-leak'
    const result = spawnSync(process.execPath, [resolve('dist/bin/check-config.js')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        KLEDO_API_BASE_URL: 'https://tenant.example/api/v1/',
        KLEDO_API_TOKEN: token,
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('configuration is valid')
    expect(result.stdout).not.toContain(token)
    expect(result.stderr).not.toContain(token)
  })

  it('fails safely for invalid configuration', () => {
    const token = 'invalid-configuration-token-must-not-leak'
    const result = spawnSync(process.execPath, [resolve('dist/bin/check-config.js')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        KLEDO_API_BASE_URL: 'http://tenant.example/api/v1/',
        KLEDO_API_TOKEN: token,
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('configuration is invalid')
    expect(result.stdout).not.toContain(token)
    expect(result.stderr).not.toContain(token)
  })
})
