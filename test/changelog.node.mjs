import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { releaseSection, validateChangelog } from '../scripts/changelog.mjs'

const validChangelog = `# Changelog

## [Unreleased]

### Added

- Future capability.

## [0.1.0-rc.1] - 2026-08-27

### Added

- First preview.

[Unreleased]: https://github.com/kevzakaria/kledo-mcp/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/kevzakaria/kledo-mcp/releases/tag/v0.1.0-rc.1
`

const repository = (changelog = validChangelog) => ({
  changelog,
  packageJson: { files: ['CHANGELOG.md'], version: '0.1.0-rc.1' },
  packageLock: {
    packages: { '': { version: '0.1.0-rc.1' } },
    version: '0.1.0-rc.1',
  },
  serverJson: { version: '0.1.0-rc.1' },
})

describe('changelog validation', () => {
  it('accepts one current version and an Unreleased compare link', () => {
    assert.deepEqual(validateChangelog(repository()), [])
  })

  it('extracts only the requested version for GitHub Release highlights', () => {
    assert.equal(
      releaseSection(validChangelog, '0.1.0-rc.1'),
      '### Added\n\n- First preview.',
    )
  })

  it('requires package, server, changelog, and package contents to agree', () => {
    const result = validateChangelog({
      changelog: validChangelog,
      packageJson: { files: [], version: '0.1.0-rc.2' },
      packageLock: {
        packages: { '': { version: '0.1.0-rc.1' } },
        version: '0.1.0-rc.1',
      },
      serverJson: { version: '0.1.0-rc.1' },
    })

    assert.match(result.join('\n'), /first dated changelog version/u)
    assert.match(result.join('\n'), /server\.json version/u)
    assert.match(result.join('\n'), /package-lock\.json versions/u)
    assert.match(result.join('\n'), /files must include CHANGELOG\.md/u)
    assert.match(result.join('\n'), /release highlights for 0\.1\.0-rc\.2/u)
  })

  it('rejects duplicate Unreleased and version sections', () => {
    const duplicated = validChangelog
      .replace('## [Unreleased]', '## [Unreleased]\n\n## [Unreleased]')
      .replace(
        '[Unreleased]:',
        '## [0.1.0-rc.1] - 2026-08-27\n\n- Duplicate.\n\n[Unreleased]:',
      )
    const result = validateChangelog(repository(duplicated))

    assert.match(result.join('\n'), /exactly one ## \[Unreleased\]/u)
    assert.match(result.join('\n'), /duplicate version section/u)
  })
})
