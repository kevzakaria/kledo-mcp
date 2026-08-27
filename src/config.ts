export interface KledoProcessConfig {
  baseUrl: URL
  token: string
}

export function loadKledoProcessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): KledoProcessConfig {
  const baseUrlValue = environment.KLEDO_API_BASE_URL?.trim()
  const token = environment.KLEDO_API_TOKEN?.trim()

  if (!baseUrlValue) throw new Error('KLEDO_API_BASE_URL is required')
  if (!token) throw new Error('KLEDO_API_TOKEN is required')

  let baseUrl: URL
  try {
    baseUrl = new URL(baseUrlValue)
  } catch {
    throw new Error('KLEDO_API_BASE_URL must be an absolute URL')
  }

  return { baseUrl, token }
}
