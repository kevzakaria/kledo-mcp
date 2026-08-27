import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface KledoProcessConfig {
  baseUrl: URL
  token: string
  identityCatalogPath: string
}

export function loadKledoProcessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): KledoProcessConfig {
  const baseUrlValue = environment.KLEDO_API_BASE_URL?.trim()
  const token = environment.KLEDO_API_TOKEN?.trim()
  const configuredStateDirectory = environment.KLEDO_STATE_DIR?.trim()

  if (!baseUrlValue) throw new Error('KLEDO_API_BASE_URL is required')
  if (!token) throw new Error('KLEDO_API_TOKEN is required')

  let baseUrl: URL
  try {
    baseUrl = new URL(baseUrlValue)
  } catch {
    throw new Error('KLEDO_API_BASE_URL must be an absolute URL')
  }

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

  return {
    baseUrl,
    token,
    identityCatalogPath: join(stateDirectory, 'identity-catalog.sqlite'),
  }
}
