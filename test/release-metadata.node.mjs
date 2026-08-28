import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { validatePullRequestReleaseMetadata } from '../scripts/release-metadata.mjs'

const body = ({ note = 'Adds a bounded fixture capability.', impact = 'minor' } = {}) => `
## Summary

Synthetic change.

## Release note

${note}

## Version impact

- [ ] major
- [${impact === 'minor' ? 'x' : ' '}] minor
- [${impact === 'patch' ? 'x' : ' '}] patch
- [${impact === 'none' ? 'x' : ' '}] none
`

describe('pull request release metadata', () => {
  it('accepts one category, one public note, and one version impact', () => {
    const result = validatePullRequestReleaseMetadata({
      body: body(),
      labels: [{ name: 'enhancement' }, { name: 'help wanted' }],
    })

    assert.deepEqual(result.errors, [])
    assert.equal(result.category, 'enhancement')
    assert.equal(result.versionImpact, 'minor')
  })

  it('accepts skip-changelog only with a reason and none impact', () => {
    const result = validatePullRequestReleaseMetadata({
      body: body({ note: 'Not applicable: synthetic test maintenance only.', impact: 'none' }),
      labels: [{ name: 'skip-changelog' }],
    })

    assert.deepEqual(result.errors, [])
  })

  it('rejects missing or multiple release categories', () => {
    const missing = validatePullRequestReleaseMetadata({ body: body(), labels: [] })
    const multiple = validatePullRequestReleaseMetadata({
      body: body(),
      labels: [{ name: 'enhancement' }, { name: 'documentation' }],
    })

    assert.match(missing.errors.join('\n'), /exactly one release-note label/u)
    assert.match(multiple.errors.join('\n'), /exactly one release-note label/u)
  })

  it('rejects missing notes and ambiguous version impact', () => {
    const invalidBody = body({ note: '<!-- placeholder -->' }).replace(
      '- [ ] patch',
      '- [x] patch',
    )
    const result = validatePullRequestReleaseMetadata({
      body: invalidBody,
      labels: [{ name: 'bug' }],
    })

    assert.match(result.errors.join('\n'), /Fill in the Release note/u)
    assert.match(result.errors.join('\n'), /exactly one version impact/u)
  })

  it('rejects a versioned change hidden by skip-changelog', () => {
    const result = validatePullRequestReleaseMetadata({
      body: body({ note: 'Not applicable: maintenance.', impact: 'patch' }),
      labels: [{ name: 'skip-changelog' }],
    })

    assert.match(result.errors.join('\n'), /requires version impact none/u)
  })
})
