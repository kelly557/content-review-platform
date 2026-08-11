import { useEffect, useState } from 'react'
import { App, Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag, type MenuProps } from 'antd'
import {
  DashboardOutlined,
  AuditOutlined,
  TeamOutlined,
  BarChartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  UserSwitchOutlined,
  SettingOutlined,
  DatabaseOutlined,
  SearchOutlined,
  TagsOutlined,
  RobotOutlined,
  KeyOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuthStore, useUiStore } from '@/store'
import { SystemHealthBanner } from '@/components/SystemHealthBanner'
import { PageGuideButton } from '@/components/PageGuideButton'
import { DEV_ACCOUNTS, IS_DEV, type DevAccount } from '@/lib/devAccounts'
import { isPlatformAdmin, getRoleDisplayLabel } from '@/lib/tenantAuth'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const ICON_SIZE = 18

type MenuItem = NonNullable<MenuProps['items']>[number]

type NavChild = {
  key: string
  path?: string
  label: string
  roles?: string[]
  platformOnly?: boolean
  children?: NavChild[]
}

type NavNode =
  | {
      kind: 'leaf'
      key: string
      path: string
      label: string
      icon: React.ReactNode
      roles: string[]
      platformOnly?: boolean
    }
  | {
      kind: 'group'
      key: string
      path: string
      label: string
      icon: React.ReactNode
      roles: string[]
      platformOnly?: boolean
      children: NavChild[]
    }

const NAV_SECTIONS: Array<{
  type: 'group'
  key: string
  label: string
  items: NavNode[]
}> = [
  {
    type: 'group',
    key: 'workspace',
    label: '工作区',
    items: [
      { kind: 'leaf', key: 'overview', path: '/overview', label: '总览', icon: <DashboardOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin'] },
      { kind: 'leaf', key: 'online-review', path: '/online-review', label: '在线审核', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin'] },
    ],
  },
  {
    type: 'group',
    key: 'strategy',
    label: '策略中心',
    items: [
      {
        kind: 'group',
        key: 'strategies',
        path: '/strategies',
        label: '审核策略',
        icon: <SettingOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'mlr', 'reviewer', 'superadmin'],
        children: [
          { key: 'strategies-list', path: '/strategies', label: '策略管理' },
          { key: 'strategies-agents', path: '/strategies/agents', label: '审核智能体', roles: ['superadmin', 'admin'] },
        ],
      },
      {
        kind: 'group',
        key: 'strategy-resources',
        path: '/resources/words',
        label: '资源库',
        icon: <DatabaseOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'mlr', 'reviewer', 'superadmin'],
        children: [
          { key: 'strategies-words', path: '/resources/words', label: '词库管理' },
          { key: 'strategies-replies', path: '/resources/replies', label: '代答库管理' },
        ],
      },
    ],
  },
  {
    type: 'group',
    key: 'analytics',
    label: '审核结果',
    items: [
      { kind: 'leaf', key: 'query', path: '/query', label: '数据查询', icon: <SearchOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin', 'superadmin'] },
      { kind: 'leaf', key: 'reports', path: '/reports', label: '数据报表', icon: <BarChartOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin', 'superadmin'] },
    ],
  },
  {
    type: 'group',
    key: 'system',
    label: '系统管理',
    items: [
      {
        kind: 'group',
        key: 'admin',
        path: '/admin/users',
        label: '账号管理',
        icon: <TeamOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'superadmin'],
        children: [
          { key: 'admin-users', path: '/admin/users', label: '用户管理' },
          { key: 'admin-roles', path: '/admin/roles', label: '角色管理' },
          { key: 'admin-permissions', path: '/admin/permissions', label: '权限管理' },
        ],
      },
      {
        kind: 'group',
        key: 'admin-models',
        path: '/admin/models/large',
        label: '模型管理',
        icon: <RobotOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'superadmin'],
        children: [
          { key: 'admin-models-large', path: '/admin/models/large', label: '大模型' },
          { key: 'admin-models-small', path: '/admin/models/small', label: '小模型' },
        ],
      },
      {
        kind: 'leaf',
        key: 'admin-tags',
        path: '/admin/tags',
        label: '标签管理',
        icon: <TagsOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'superadmin'],
      },
      {
        kind: 'group',
        key: 'admin-platform',
        path: '/admin/tenants',
        label: '平台管理',
        icon: <KeyOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['superadmin', 'root_admin'],
        platformOnly: true,
        children: [
          { key: 'admin-tenants', path: '/admin/tenants', label: '租户管理', platformOnly: true, roles: ['root_admin'] },
          { key: 'admin-api-keys', path: '/admin/api-keys', label: 'API Keys', platformOnly: true, roles: ['superadmin', 'root_admin'] },
        ],
      },
    ],
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = App.useApp()
  const { user, login, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, appDimmed } = useUiStore()
  const [isMobile, setIsMobile] = useState(false)

  const switchTo = async (acc: DevAccount) => {
    try {
      await login({ identifier: acc.identifier, password: acc.password })
      message.success(`已切换为 ${acc.label}`)
    } catch {
      message.error('切换失败')
    }
  }

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (!user) {
    return null
  }

  const platform = isPlatformAdmin(user)

  // root_admin（平台租户管理员）：只看 platformOnly 项（租户管理 / API Keys）。
  // superadmin（超级管理员）：业务菜单 + platformOnly 项都按 roles 放行（含 API Keys）。
  // admin / 其他：只看业务菜单，platformOnly 项隐藏。
  const filterByRole = (items: NavNode[]): NavNode[] =>
    items.filter((n) => {
      if (platform) {
        return n.platformOnly === true && n.roles.includes(user.role)
      }
      return n.roles.includes(user.role)
    })

  const filterChildren = (children: NavChild[]): NavChild[] =>
    children.filter((c) => {
      if (!c.roles) return true
      if (platform) {
        return c.platformOnly === true && c.roles.includes(user.role)
      }
      return c.roles.includes(user.role)
    })

  const visibleSections = NAV_SECTIONS
    .map((section) => ({ ...section, items: filterByRole(section.items) }))
    .filter((section) => section.items.length > 0)

  const items: MenuItem[] = []
  visibleSections.forEach((section, idx) => {
    if (idx > 0) {
      items.push({ type: 'divider' })
    }
    items.push({
      key: `__group_${section.key}`,
      type: 'group',
      label: (
        <span
          style={{
            color: '#94A3B8',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            paddingLeft: 4,
          }}
        >
          {sidebarCollapsed ? '' : section.label}
        </span>
      ),
    })
    section.items.forEach((node) => {
      if (node.kind === 'leaf') {
        items.push({
          key: node.path,
          icon: node.icon,
          label: <Link to={node.path}>{node.label}</Link>,
        })
      } else {
        const visibleChildren = filterChildren(node.children)
        items.push({
          key: node.key,
          icon: node.icon,
          label: node.label,
          children: visibleChildren.map((c) => {
            if (c.children && c.children.length > 0) {
              // 二级 group (例如 "图片审核规则" 下挂 "通用图片规则 / 个性化图片规则")
              const visibleGrand = filterChildren(c.children)
              return {
                key: c.key,
                label: c.label,
                children: visibleGrand.map((gc) => ({
                  key: gc.path ?? gc.key,
                  label: <Link to={gc.path ?? '#'}>{gc.label}</Link>,
                })),
              }
            }
            return {
              key: c.path ?? c.key,
              label: <Link to={c.path ?? '#'}>{c.label}</Link>,
            }
          }),
        })
      }
    })
  })

  const collectPaths = (
    nodes: ReadonlyArray<NavNode | NavChild>,
  ): string[] => {
    const out: string[] = []
    for (const n of nodes) {
      const roleOk =
        !('roles' in n) || !n.roles || n.roles.includes(user.role)
      if ('path' in n && n.path && roleOk) {
        out.push(n.path)
      }
      if ('children' in n && n.children) {
        out.push(...collectPaths(n.children))
      }
    }
    return out
  }
  const allPaths = visibleSections.flatMap((section) =>
    collectPaths(section.items),
  )
  const candidates = allPaths
    .sort((a, b) => b.length - a.length)
    .filter((k) => !k.startsWith('__'))
  const activeKey =
    candidates.find(
      (k) =>
        location.pathname === k ||
        (k.startsWith('/') && location.pathname.startsWith(`${k}/`)),
    ) ?? ''

  const openKeys = visibleSections
    .flatMap((section) => section.items)
    .filter((n): n is Extract<NavNode, { kind: 'group' }> => n.kind === 'group')
    .filter((n) => {
      const visibleChildren = n.children.filter(
        (c) => !c.roles || c.roles.includes(user.role),
      )
      if (n.path && location.pathname.startsWith(n.path)) return true
      return visibleChildren.some(
        (c) => c.path && location.pathname.startsWith(c.path),
      )
    })
    .map((n) => n.key)

  const dropdownItems: MenuProps['items'] = [
    { key: 'profile', label: `${user.full_name}`, disabled: true },
    ...(IS_DEV
      ? [
          { type: 'divider' as const },
          {
            key: 'switch-header',
            label: '切换为',
            disabled: true,
            style: { fontSize: 11, color: '#94A3B8' },
          },
          ...DEV_ACCOUNTS.map((acc) => {
            const isCurrent = user.role === acc.role
            return {
              key: `switch-${acc.identifier}`,
              label: isCurrent
                ? `✓ 当前 ${acc.label}`
                : `⇄ ${acc.label}`,
              disabled: isCurrent,
              icon: isCurrent ? undefined : <UserSwitchOutlined />,
              onClick: isCurrent ? undefined : () => switchTo(acc),
            }
          }),
        ]
      : []),
    { type: 'divider' },
    {
      key: 'logout',
      label: '退出登录',
      icon: <LogoutOutlined />,
      onClick: () => {
        logout()
        navigate('/login', { replace: true })
      },
    },
  ]

  return (
    <Layout
      className={appDimmed ? 'app-layout-dimmed' : undefined}
      style={{ minHeight: '100vh' }}
    >
      <Sider
        theme="dark"
        collapsible
        collapsed={sidebarCollapsed}
        trigger={null}
        breakpoint="md"
        collapsedWidth={isMobile ? 0 : 64}
        width={240}
        style={{ position: 'sticky', top: 0, height: '100vh' }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 600,
            fontSize: sidebarCollapsed ? 13 : 15,
            borderBottom: '1px solid #1E293B',
            padding: '0 12px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {sidebarCollapsed ? '内审' : '内容安全审核管理平台'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeKey]}
          defaultOpenKeys={openKeys}
          items={items}
          style={{ borderRight: 0, paddingTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 clamp(12px, 2vw, 20px)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            boxShadow: '0 1px 0 #E2E8F0',
          }}
        >
          <Space>
            <Button
              type="text"
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSidebar}
              style={{ color: '#fff' }}
            />
          </Space>
          <Space size="middle">
            <PageGuideButton />
            <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} />
                <Text style={{ color: '#fff' }}>{user.full_name}</Text>
                <Tag color="blue">{getRoleDisplayLabel(user)}</Tag>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            padding: 'clamp(12px, 2vw, 20px)',
            background: '#F1F5F9',
            margin: 0,
          }}
        >
          <SystemHealthBanner />
          <Outlet />
        </Content>
      </Layout>
      <div className="app-dim-mask" hidden={!appDimmed} aria-hidden />
    </Layout>
  )
}
