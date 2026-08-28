import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const releaseNoteLabels = Object.freeze([
  'security',
  'enhancement',
  'bug',
  'documentation',
  'dependencies',
  'maintenance',
  'skip-changelog',
])

const versionImpacts = Object.freeze(['major', 'minor', 'patch', 'none'])

const extractSection = (body, heading) => {
  const lines = body.replace(/\r\n?/gu, '\n').split('\n')
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  )
  if (start === -1) return ''

  const followingHeading = lines
    .slice(start + 1)
    .findIndex((line) => /^##\s+/u.test(line.trim()))
  const end = followingHeading === -1 ? lines.length : start + 1 + followingHeading

  return lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .trim()
}

const checkedVersionImpacts = (section) => {
  const checked = []
  for (const line of section.split('\n')) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(major|minor|patch|none)\b/iu)
    if (match?.[1]?.toLowerCase() === 'x' && match[2]) {
      checked.push(match[2].toLowerCase())
    }
  }
  return checked
}

export const validatePullRequestReleaseMetadata = (pullRequest) => {
  const errors = []
  const labels = Array.isArray(pullRequest?.labels)
    ? pullRequest.labels
        .map((label) => (typeof label === 'string' ? label : label?.name))
        .filter((label) => typeof label === 'string')
    : []
  const selectedLabels = releaseNoteLabels.filter((label) => labels.includes(label))

  if (selectedLabels.length !== 1) {
    errors.push(
      `Select exactly one release-note label: ${releaseNoteLabels.join(', ')}.`,
    )
  }

  const body = typeof pullRequest?.body === 'string' ? pullRequest.body : ''
  const releaseNote = extractSection(body, 'Release note')
  if (releaseNote.length === 0) {
    errors.push(
      'Fill in the Release note section. For skip-changelog, use Not applicable followed by a reason.',
    )
  } else if (releaseNote.length > 500) {
    errors.push('Keep the Release note section at or below 500 characters.')
  }

  const impactSection = extractSection(body, 'Version impact')
  const selectedImpacts = checkedVersionImpacts(impactSection)
  if (selectedImpacts.length !== 1) {
    errors.push(`Select exactly one version impact: ${versionImpacts.join(', ')}.`)
  }

  const category = selectedLabels.length === 1 ? selectedLabels[0] : undefined
  const versionImpact = selectedImpacts.length === 1 ? selectedImpacts[0] : undefined
  if (category === 'skip-changelog' && versionImpact !== 'none') {
    errors.push('skip-changelog requires version impact none.')
  }

  return {
    category,
    errors,
    releaseNote,
    versionImpact,
  }
}

const run = async () => {
  const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH
  if (!eventPath) throw new Error('Provide a GitHub pull_request event JSON path.')

  const event = JSON.parse(await readFile(resolve(eventPath), 'utf8'))
  if (!event.pull_request) throw new Error('Event JSON does not contain pull_request.')

  const result = validatePullRequestReleaseMetadata(event.pull_request)
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`release metadata: ${error}`)
    process.exitCode = 1
    return
  }

  console.log(
    `release metadata valid: category=${result.category} impact=${result.versionImpact}`,
  )
}

const executedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (executedDirectly) await run()
