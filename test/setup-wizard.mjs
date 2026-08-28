import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'kledo-mcp-wizard-'))
const environmentFile = join(temporaryRoot, 'wizard.env')
const browserLog = join(temporaryRoot, 'browser.log')
const fakeBin = join(temporaryRoot, 'bin')
const dummyToken = 'wizard-smoke-token-not-a-secret-0123456789'

const digest = (value) => createHash('sha256').update(value).digest('hex')

const parseEnvironment = (contents) =>
  Object.fromEntries(
    contents
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )

const runWizard = (input) =>
  spawnSync('bash', [join(repositoryRoot, 'scripts/setup.sh')], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ENV_FILE: environmentFile,
      KLEDO_WIZARD_BROWSER_LOG: browserLog,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      TERM: 'dumb',
    },
    input,
    timeout: 60_000,
  })

const assertSuccessfulRun = (result, label) => {
  assert.equal(result.error, undefined, `${label} should not have a process error`)
  assert.equal(result.status, 0, `${label} failed:\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /configuration is valid/)
  assert.match(result.stdout, /Setup complete/)
  assert.match(result.stdout, /node --env-file=/)
  assert.match(result.stdout, /warmup-identities\.js/)
  assert.equal(result.stdout.includes(dummyToken), false, `${label} leaked the token to stdout`)
  assert.equal(result.stderr.includes(dummyToken), false, `${label} leaked the token to stderr`)
}

try {
  await mkdir(fakeBin)
  const browserStub = `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "$KLEDO_WIZARD_BROWSER_LOG"\n`
  for (const command of ['wslview', 'explorer.exe', 'xdg-open', 'open']) {
    const commandPath = join(fakeBin, command)
    await writeFile(commandPath, browserStub, { mode: 0o755 })
    await chmod(commandPath, 0o755)
  }

  const firstRun = runWizard(
    [
      '',
      'http://tenant.example/api/v1/',
      'https://tenant.example/api/v1/',
      `Bearer ${dummyToken}`,
      '',
    ].join('\n'),
  )
  assertSuccessfulRun(firstRun, 'first wizard run')
  assert.match(firstRun.stdout, /Use an HTTPS URL ending exactly at \/api\/v1\//)

  const firstContents = await readFile(environmentFile, 'utf8')
  const firstValues = parseEnvironment(firstContents)
  assert.equal(firstValues.KLEDO_API_BASE_URL, 'https://tenant.example/api/v1/')
  assert.equal(firstValues.KLEDO_API_TOKEN, dummyToken)
  assert.equal((await stat(environmentFile)).mode & 0o777, 0o600)

  const firstDigest = digest(firstContents)
  const secondRun = runWizard(['', '', '', ''].join('\n'))
  assertSuccessfulRun(secondRun, 'second wizard run')
  assert.match(secondRun.stdout, /Enter keeps current/)

  const secondContents = await readFile(environmentFile, 'utf8')
  assert.equal(digest(secondContents), firstDigest)
  assert.equal((await stat(environmentFile)).mode & 0o777, 0o600)

  const openedUrls = (await readFile(browserLog, 'utf8')).trim().split('\n')
  assert.deepEqual(openedUrls, [
    'https://app.kledo.com/#/settings/apps?activeKey=6',
    'https://app.kledo.com/#/settings/apps?activeKey=6',
  ])

  console.log('setup wizard smoke test passed')
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
