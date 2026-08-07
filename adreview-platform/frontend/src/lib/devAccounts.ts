/**
 * 开发/测试环境专用的角色快速切换账号清单。
 *
 * 仅供 dev 构建使用 — 生产构建由 `import.meta.env.DEV === false` gate
 * 剔除 UI（参考 AppLayout.tsx 的 dropdownItems）。
 *
 * 只保留 3 类视角，体现租户特性：
 *   - 超级管理员（平台）
 *   - 超级管理员（Acme 租户）
 *   - 业务员（Acme 租户 / Globex 租户）
 */
import type { UserRole } from '@/types/auth'

export interface DevAccount {
  role: UserRole
  identifier: string
  password: string
  label: string
  tenantCode: string | null
}

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    role: 'superadmin',
    identifier: 'superadmin@adreview.example.com',
    password: 'superadmin123',
    label: '超级管理员（平台）',
    tenantCode: null,
  },
  {
    role: 'admin',
    identifier: 'admin@adreview.example.com',
    password: 'admin123',
    label: '超级管理员（Acme 租户）',
    tenantCode: 'acme',
  },
  {
    role: 'reviewer',
    identifier: 'reviewer@adreview.example.com',
    password: 'reviewer123',
    label: '业务员（Acme 租户）',
    tenantCode: 'acme',
  },
  {
    role: 'mlr',
    identifier: 'mlr@adreview.example.com',
    password: 'mlr12345',
    label: '业务员（Globex 租户）',
    tenantCode: 'globex',
  },
]

export const IS_DEV = import.meta.env.DEV
