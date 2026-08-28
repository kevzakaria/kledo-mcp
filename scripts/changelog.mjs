import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const versionHeadingPattern =
  /^## \[((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?)\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/gmu

export const releaseSection = (changelog, version) => {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const heading = new RegExp(
    `^## \\[${escapedVersion}\\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$`,
    'mu',
  )
  const match = heading.exec(changelog)
  if (!match || match.index === undefined) return undefined

  const contentStart = match.index + match[0].length
  const remaining = changelog.slice(contentStart)
  const nextVersion = remaining.search(/^## \[/mu)
  const content = remaining.slice(0, nextVersion === -1 ? remaining.length : nextVersion)
  const withoutLinks = content.replace(/^\[[^\]]+\]:\s+https?:\/\/.*$/gmu, '').trim()

  return withoutLinks.length > 0 ? withoutLinks : undefined
}

export const validateChangelog = ({ changelog, packageJson, packageLock, serverJson }) => {
  const errors = []
  const unreleasedCount = changelog.match(/^## \[Unreleased\]$/gmu)?.length ?? 0
  if (unreleasedCount !== 1) {
    errors.push('CHANGELOG.md must contain exactly one ## [Unreleased] section.')
  }

  const versions = [...changelog.matchAll(versionHeadingPattern)].map((match) => match[1])
  if (versions.length === 0) {
    errors.push('CHANGELOG.md must contain at least one dated version section.')
  }
  if (new Set(versions).size !== versions.length) {
    errors.push('CHANGELOG.md contains a duplicate version section.')
  }

  const packageVersion = packageJson?.version
  if (typeof packageVersion !== 'string' || versions[0] !== packageVersion) {
    errors.push('The first dated changelog version must match package.json version.')
  }
  if (serverJson?.version !== packageVersion) {
    errors.push('server.json version must match package.json version.')
  }
  if (
    packageLock?.version !== packageVersion ||
    packageLock?.packages?.['']?.version !== packageVersion
  ) {
    errors.push('package-lock.json versions must match package.json version.')
  }
  if (!Array.isArray(packageJson?.files) || !packageJson.files.includes('CHANGELOG.md')) {
    errors.push('package.json files must include CHANGELOG.md.')
  }

  if (typeof packageVersion === 'string') {
    if (!releaseSection(changelog, packageVersion)) {
      errors.push(`CHANGELOG.md must contain release highlights for ${packageVersion}.`)
    }
    const releaseLink = `[${packageVersion}]:`
    if (!changelog.split('\n').some((line) => line.startsWith(releaseLink))) {
      errors.push(`CHANGELOG.md must define a link for ${packageVersion}.`)
    }
    const expectedUnreleased =
      `[Unreleased]: https://github.com/kevzakaria/kledo-mcp/compare/` +
      `v${packageVersion}...HEAD`
    if (!changelog.split('\n').includes(expectedUnreleased)) {
      errors.push(`CHANGELOG.md must compare Unreleased from v${packageVersion} to HEAD.`)
    }
  }

  return errors
}

const readRepositoryFiles = async () => {
  const [changelog, packageContents, lockContents, serverContents] = await Promise.all([
    readFile(resolve('CHANGELOG.md'), 'utf8'),
    readFile(resolve('package.json'), 'utf8'),
    readFile(resolve('package-lock.json'), 'utf8'),
    readFile(resolve('server.json'), 'utf8'),
  ])
  return {
    changelog,
    packageJson: JSON.parse(packageContents),
    packageLock: JSON.parse(lockContents),
    serverJson: JSON.parse(serverContents),
  }
}

const run = async () => {
  const command = process.argv[2] ?? 'check'
  const repository = await readRepositoryFiles()

  if (command === 'check') {
    const errors = validateChangelog(repository)
    if (errors.length > 0) {
      for (const error of errors) console.error(`changelog: ${error}`)
      process.exitCode = 1
      return
    }
    console.log(`changelog valid for ${repository.packageJson.version}`)
    return
  }

  if (command === 'extract') {
    const version = process.argv[3]
    if (!version) throw new Error('Provide the version to extract.')
    const section = releaseSection(repository.changelog, version)
    if (!section) throw new Error(`No changelog section found for ${version}.`)
    process.stdout.write(`## Highlights\n\n${section}\n`)
    return
  }

  throw new Error(`Unsupported changelog command: ${command}`)
}

const executedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (executedDirectly) await run()
