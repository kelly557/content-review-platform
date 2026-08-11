/**
 * 开发/测试环境专用的角色快速切换账号清单。
 *
 * 仅供 dev 构建使用 — 生产构建由 `import.meta.env.DEV === false` gate
 * 剔除 UI（参考 AppLayout.tsx 的 dropdownItems）。
 *
 * 每个租户 3 个角色（超级管理员/管理员/业务员）+ 平台租户管理员：
 *   - 租户管理员（平台）
 *   - 超级管理员（Acme 租户 / Globex 租户）
 *   - 管理员（Acme 租户 / Globex 租户）
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
    role: 'root_admin',
    identifier: 'rootadmin@adreview.example.com',
    password: 'rootadmin123',
    label: '租户管理员（平台）',
    tenantCode: null,
  },
  {
    role: 'superadmin',
    identifier: 'acme_superadmin',
    password: 'acme_super123',
    label: '超级管理员（Acme 租户）',
    tenantCode: 'acme',
  },
  {
    role: 'superadmin',
    identifier: 'globex_superadmin',
    password: 'globex_super123',
    label: '超级管理员（Globex 租户）',
    tenantCode: 'globex',
  },
  {
    role: 'admin',
    identifier: 'admin@adreview.example.com',
    password: 'admin123',
    label: '管理员（Acme 租户）',
    tenantCode: 'acme',
  },
  {
    role: 'admin',
    identifier: 'globex_admin',
    password: 'globex12345',
    label: '管理员（Globex 租户）',
    tenantCode: 'globex',
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
