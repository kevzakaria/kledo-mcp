import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface KledoProcessConfig {
  baseUrl: URL
  token: string
  identityCatalogPath?: string
  debug: boolean
}

export function loadKledoProcessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): KledoProcessConfig {
  const baseUrlValue = environment.KLEDO_API_BASE_URL?.trim()
  const token = environment.KLEDO_API_TOKEN?.trim()
  const identityCache = environment.KLEDO_IDENTITY_CACHE?.trim() || 'memory'
  const configuredStateDirectory = environment.KLEDO_STATE_DIR?.trim()
  const debugValue = environment.KLEDO_DEBUG?.trim()

  if (!baseUrlValue) throw new Error('KLEDO_API_BASE_URL is required')
  if (!token) throw new Error('KLEDO_API_TOKEN is required')
  if (identityCache !== 'memory' && identityCache !== 'sqlite') {
    throw new Error('KLEDO_IDENTITY_CACHE must be memory or sqlite')
  }
  if (configuredStateDirectory && identityCache !== 'sqlite') {
    throw new Error('KLEDO_STATE_DIR requires KLEDO_IDENTITY_CACHE=sqlite')
  }
  if (debugValue && debugValue !== '0' && debugValue !== '1') {
    throw new Error('KLEDO_DEBUG must be 0 or 1')
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(baseUrlValue)
  } catch {
    throw new Error('KLEDO_API_BASE_URL must be an absolute URL')
  }

  let identityCatalogPath: string | undefined
  if (identityCache === 'sqlite') {
    let stateDirectory: string
    if (configuredStateDirectory) {
      if (!isAbsolute(configuredStateDirectory)) {
        throw new Error('KLEDO_STATE_DIR must be an absolute path')
      }
      stateDirectory = configuredStateDirectory
    } else if (environment.XDG_STATE_HOME?.trim()) {
      const xdgStateHome = environment.XDG_STATE_HOME.trim()
      if (!isAbsolute(xdgStateHome)) {
        throw new Error('XDG_STATE_HOME must be an absolute path')
      }
      stateDirectory = join(xdgStateHome, 'kledo-mcp')
    } else {
      stateDirectory =
        process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support', 'kledo-mcp')
          : join(homedir(), '.local', 'state', 'kledo-mcp')
    }
    identityCatalogPath = join(stateDirectory, 'identity-catalog.sqlite')
  }

  return {
    baseUrl,
    token,
    ...(identityCatalogPath ? { identityCatalogPath } : {}),
    debug: debugValue === '1',
  }
}
