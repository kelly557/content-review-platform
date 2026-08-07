import { api } from './client'

export type AccessCheckModality = 'text' | 'image' | 'audio' | 'video'

export interface AccessCheckInput {
  modality: AccessCheckModality
  endpoint_url: string
  name?: string
}

export interface AccessCheckResult {
  ok: boolean
  discoveredTags: string[]
  latencyMs: number
  message?: string
}

export async function runAccessCheck(
  input: AccessCheckInput,
): Promise<AccessCheckResult> {
  const { data } = await api.post<{
    ok: boolean
    discovered_tags: string[]
    latency_ms: number
    message?: string
  }>('/registered-models/access-check', {
    modality: input.modality,
    endpoint_url: input.endpoint_url,
    name: input.name,
  })
  return {
    ok: data.ok,
    discoveredTags: data.discovered_tags ?? [],
    latencyMs: data.latency_ms,
    message: data.message,
  }
}
