import { useEffect, useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag, type MenuProps } from 'antd'
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
  SettingOutlined,
  ClusterOutlined,
  BookOutlined,
  TagsOutlined,
  DatabaseOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuthStore, useUiStore } from '@/store'
import { ROLE_LABELS } from '@/types/domain'
import { SystemHealthBanner } from '@/components/SystemHealthBanner'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const ICON_SIZE = 18

type MenuItem = NonNullable<MenuProps['items']>[number]

type NavChild = {
  key: string
  path: string
  label: string
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
      { kind: 'leaf', key: 'overview', path: '/overview', label: '总览', icon: <DashboardOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
      { kind: 'leaf', key: 'tasks', path: '/tasks', label: '审核任务', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
      { kind: 'leaf', key: 'materials', path: '/materials', label: '素材库', icon: <FileImageOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
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
        roles: ['admin', 'mlr'],
        children: [
          { key: 'strategies-list', path: '/strategies', label: '策略列表' },
          { key: 'strategies-image', path: '/strategies/rules-by-type/image', label: '图片审核规则' },
          { key: 'strategies-text', path: '/strategies/rules-by-type/text', label: '文本审核规则' },
          { key: 'strategies-audio', path: '/strategies/rules-by-type/audio', label: '语音审核规则' },
          { key: 'strategies-doc', path: '/strategies/rules-by-type/doc', label: '文档审核规则' },
          { key: 'strategies-video', path: '/strategies/rules-by-type/video', label: '视频审核规则' },
        ],
      },
      {
        kind: 'group',
        key: 'strategy-resources',
        path: '/strategies/words',
        label: '策略资源',
        icon: <DatabaseOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin', 'mlr'],
        children: [
          { key: 'strategies-words', path: '/strategies/words', label: '词库' },
          { key: 'strategies-images', path: '/strategies/images', label: '图片库' },
          { key: 'strategies-replies', path: '/strategies/replies', label: '代答库' },
          { key: 'strategies-library-groups', path: '/strategies/library-groups', label: '库管理' },
        ],
      },
      { kind: 'leaf', key: 'human-review-rules', path: '/human-review-rules', label: '人工审核策略', icon: <ClusterOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin', 'mlr'] },
      { kind: 'leaf', key: 'knowledge', path: '/knowledge', label: '知识库', icon: <BookOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin', 'mlr'] },
    ],
  },
{
    type: 'group',
    key: 'analytics',
    label: '审查结果',
    items: [
      { kind: 'leaf', key: 'query', path: '/query', label: '数据查询', icon: <SearchOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin'] },
      { kind: 'leaf', key: 'query-review', path: '/query/review', label: '复审队列', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin'] },
      { kind: 'leaf', key: 'reports', path: '/reports', label: '数据报表', icon: <BarChartOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin'] },
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
        label: '用户管理',
        icon: <TeamOutlined style={{ fontSize: ICON_SIZE }} />,
        roles: ['admin'],
        children: [
          { key: 'admin-users', path: '/admin/users', label: '用户列表' },
        ],
      },
      { kind: 'leaf', key: 'admin-tags', path: '/tags', label: '标签管理', icon: <TagsOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin'] },
    ],
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUiStore()
  const [isMobile, setIsMobile] = useState(false)

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
        items.push({
          key: node.key,
          icon: node.icon,
          label: node.label,
          children: node.children.map((c) => ({
            key: c.path,
            label: <Link to={c.path}>{c.label}</Link>,
          })),
        })
      }
    })
  })

  const allPaths = visibleSections.flatMap((section) =>
    section.items.flatMap((node) => {
      if (node.kind === 'leaf') return [node.path]
      return [node.key, ...node.children.map((c) => c.path)]
    }),
  )
  const candidates = allPaths
    .sort((a, b) => b.length - a.length)
    .filter((k) => !k.startsWith('__'))
  const activeKey =
    candidates.find(
      (k) =>
        location.pathname === k ||
        (k.startsWith('/') && location.pathname.startsWith(`${k}/`)),
    ) || '/overview'

  const openKeys = visibleSections
    .flatMap((section) => section.items)
    .filter((n): n is Extract<NavNode, { kind: 'group' }> => n.kind === 'group')
    .filter((n) => {
      if (location.pathname.startsWith(n.path)) return true
      return n.children.some((c) => location.pathname.startsWith(c.path))
    })
    .map((n) => n.key)

  const dropdownItems: MenuProps['items'] = [
    { key: 'profile', label: `${user.full_name}`, disabled: true },
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
    <Layout style={{ minHeight: '100vh' }}>
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
    </Layout>
  )
}
