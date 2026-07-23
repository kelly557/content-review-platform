export type UserRole =
  | 'submitter' // deprecated: 已并入 staff, 仅历史数据兼容
  | 'reviewer'
  | 'mlr' // deprecated: 已并入 staff, 仅历史数据兼容
  | 'staff'
  | 'admin'
  | 'superadmin'
  | 'root_admin'

export interface User {
  id: number
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}
