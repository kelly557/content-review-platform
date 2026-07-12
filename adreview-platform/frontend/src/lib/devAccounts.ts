/**
 * 开发/测试环境专用的角色快速切换账号清单。
 *
 * 仅供 dev 构建使用 — 生产构建由 `import.meta.env.DEV === false` gate
 * 剔除 UI（参考 AppLayout.tsx 的 dropdownItems）。
 *
 * 密码来源：backend/scripts/seed.py:868-872。
 * 这些账号和密码本身已在 seed.py 中以明文存在，并非额外泄露。
 */
import type { UserRole } from '@/types/auth'

export interface DevAccount {
  role: UserRole
  email: string
  password: string
}

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    role: 'superadmin',
    email: 'superadmin@adreview.example.com',
    password: 'change-me-in-production-please-superadmin',
  },
  {
    role: 'admin',
    email: 'admin@adreview.example.com',
    password: 'change-me-in-production-please-admin',
  },
  {
    role: 'mlr',
    email: 'mlr@adreview.example.com',
    password: 'mlr12345',
  },
  {
    role: 'reviewer',
    email: 'reviewer@adreview.example.com',
    password: 'reviewer123',
  },
  {
    role: 'submitter',
    email: 'submitter@adreview.example.com',
    password: 'submitter123',
  },
]

export const IS_DEV = import.meta.env.DEV