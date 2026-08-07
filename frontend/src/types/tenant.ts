export interface Tenant {
  id: number
  public_id: string
  code: string
  name: string
  contact_email: string
  is_active: boolean
  created_at: string
  key_count?: number
  user_count?: number
}

export interface TenantCreateInput {
  code: string
  name: string
  contact_email?: string
  is_active?: boolean
}

export interface TenantUpdateInput {
  name?: string
  contact_email?: string
  is_active?: boolean
}
