export type ApiKeyScope = 'read' | 'write'

export type ApiKeyStatus = 'active' | 'revoked' | 'expired'

export interface ApiKey {
  id: string
  tenant_id: string
  name: string
  description?: string
  key_prefix: string
  scope: ApiKeyScope
  created_by: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface ApiKeyCreateInput {
  tenant_id: string
  name: string
  description?: string
  scope: ApiKeyScope
  expires_at: string | null
}

export interface ApiKeyCreated extends ApiKey {
  plaintext: string
}

export interface ApiKeyListParams {
  tenant_id?: string
  scope?: ApiKeyScope
  status?: ApiKeyStatus
  q?: string
}

export function deriveKeyStatus(k: ApiKey): ApiKeyStatus {
  if (k.revoked_at) return 'revoked'
  if (k.expires_at && new Date(k.expires_at) < new Date()) return 'expired'
  return 'active'
}
