import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('identity warm-up executable', () => {
  it('requires explicit SQLite opt-in before contacting Kledo', () => {
    const token = 'warmup-opt-in-token-must-not-leak'
    const result = spawnSync(process.execPath, [resolve('dist/bin/warmup-identities.js')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        KLEDO_API_BASE_URL: 'https://127.0.0.1:1/api/v1/',
        KLEDO_API_TOKEN: token,
      },
      timeout: 10_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Persistent identity warm-up requires KLEDO_IDENTITY_CACHE=sqlite')
    expect(result.stdout).not.toContain(token)
    expect(result.stderr).not.toContain(token)
  })
})
