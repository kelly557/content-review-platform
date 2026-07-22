import { useEffect, useState } from 'react'
import { App, Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag, type MenuProps } from 'antd'
import {
  DashboardOutlined,
  FileImageOutlined,
  AuditOutlined,
  TeamOutlined,
  BarChartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  UserSwitchOutlined,
  SettingOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuthStore, useUiStore } from '@/store'
import { ROLE_LABELS } from '@/types/domain'
import { SystemHealthBanner } from '@/components/SystemHealthBanner'
import { DEV_ACCOUNTS, IS_DEV, type DevAccount } from '@/lib/devAccounts'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const ICON_SIZE = 18

type MenuItem = NonNullable<MenuProps['items']>[number]

type NavChild = {
  key: string
  path?: string
  label: string
  roles?: string[]
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
    }
  | {
      kind: 'group'
      key: string
      path: string
      label: string
      icon: React.ReactNode
      roles: string[]
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
      { kind: 'leaf', key: 'overview', path: '/overview', label: '总览', icon: <DashboardOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'] },
      { kind: 'leaf', key: 'online-review', path: '/online-review', label: '在线审核', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'] },
      { kind: 'leaf', key: 'triggers', path: '/triggers', label: '自动审核', icon: <ThunderboltOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['root_admin'] },
      { kind: 'leaf', key: 'materials', path: '/materials', label: '素材库', icon: <FileImageOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['root_admin'] },
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
        roles: ['admin', 'mlr', 'superadmin', 'root_admin'],
        children: [
{ key: 'strategies-list', path: '/strategies', label: '策略管理' },
        ],
      },
      {
        kind: 'group',
        key: 'strategy-resources',
        path: '/resources/words',
        label: '资源库',
        icon: <DatabaseOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'mlr', 'superadmin', 'root_admin'],
        children: [
          { key: 'strategies-words', path: '/resources/words', label: '词库管理' },
          { key: 'strategies-models', path: '/resources/models', label: '模型库管理' },
          { key: 'strategies-images', path: '/resources/images', label: '图片库管理', roles: ['root_admin'] },
          { key: 'strategies-replies', path: '/resources/replies', label: '代答库管理' },
          { key: 'strategies-knowledge', path: '/resources/knowledge', label: '知识库管理', roles: ['root_admin'] },
        ],
      },
      { kind: 'leaf', key: 'human-review-rules', path: '/human-review-rules', label: '人工审核策略', icon: <ClusterOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['root_admin'] },
    ],
  },
  {
    type: 'group',
    key: 'analytics',
    label: '审查结果',
    items: [
      { kind: 'leaf', key: 'query', path: '/query', label: '数据查询', icon: <SearchOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'] },
      { kind: 'leaf', key: 'reports', path: '/reports', label: '数据报表', icon: <BarChartOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'] },
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
        roles: ['admin', 'superadmin', 'root_admin'],
        children: [
          { key: 'admin-users', path: '/admin/users', label: '用户管理' },
          { key: 'admin-roles', path: '/admin/roles', label: '角色管理' },
        ],
      },
      // { kind: 'leaf', key: 'admin-tags', path: '/tags', label: '标签管理', icon: <TagsOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin'] },
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
      await login({ email: acc.email, password: acc.password })
      message.success(`已切换为 ${ROLE_LABELS[acc.role]}`)
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

  const filterByRole = (items: NavNode[]): NavNode[] =>
    items.filter((n) => n.roles.includes(user.role))

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
        const visibleChildren = node.children.filter(
          (c) => !c.roles || c.roles.includes(user.role),
        )
        items.push({
          key: node.key,
          icon: node.icon,
          label: node.label,
          children: visibleChildren.map((c) => {
            if (c.children && c.children.length > 0) {
              // 二级 group (例如 "图片审核规则" 下挂 "通用图片规则 / 个性化图片规则")
              const visibleGrand = c.children.filter(
                (gc) => !gc.roles || gc.roles.includes(user.role),
              )
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
              key: `switch-${acc.role}`,
              label: isCurrent
                ? `✓ 当前 ${ROLE_LABELS[acc.role]}`
                : `⇄ ${ROLE_LABELS[acc.role]}`,
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
          <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <Text style={{ color: '#fff' }}>{user.full_name}</Text>
              <Tag color="blue">{ROLE_LABELS[user.role]}</Tag>
            </Space>
          </Dropdown>
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
