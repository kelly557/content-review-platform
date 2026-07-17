/**
 * 开发/测试环境专用的角色快速切换账号清单。
 *
 * 仅供 dev 构建使用 — 生产构建由 `import.meta.env.DEV === false` gate
 * 剔除 UI（参考 AppLayout.tsx 的 dropdownItems）。
 *
 * 默认管理员密码使用固定配置：
 *   - admin       => `admin123`
 *   - superadmin  => `superadmin123`
 *   - root_admin  => `rootadmin123`
 * reviewer / mlr / submitter 使用 seed.py 中的固定测试密码。
 */
import type { UserRole } from '@/types/auth'

export interface DevAccount {
  role: UserRole
  email: string
  password: string
}

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    role: 'root_admin',
    email: 'rootadmin@adreview.example.com',
    password: 'rootadmin123',
  },
  {
    role: 'superadmin',
    email: 'superadmin@adreview.example.com',
    password: 'superadmin123',
  },
  {
    role: 'admin',
    email: 'admin@adreview.example.com',
    password: 'admin123',
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
