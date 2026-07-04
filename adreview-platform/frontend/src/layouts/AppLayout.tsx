import { useEffect, useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag, App, type MenuProps } from 'antd'
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
  TagsOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuthStore, useUiStore } from '@/store'
import { ROLE_LABELS } from '@/types/domain'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const ICON_SIZE = 18

type MenuItem = NonNullable<MenuProps['items']>[number]

type NavChild = {
  key: string
  path: string
  label: string
}

type NavNode = {
  key: string
  path: string
  label: string
  icon: React.ReactNode
  roles: string[]
  children?: NavChild[]
}

const ALL_NAV: NavNode[] = [
  { key: 'dashboard', path: '/dashboard', label: '工作台', icon: <DashboardOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
  { key: 'materials', path: '/materials', label: '素材库', icon: <FileImageOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
  { key: 'tasks', path: '/tasks', label: '审核任务', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['submitter', 'reviewer', 'mlr', 'admin'] },
  { key: 'reports', path: '/reports', label: '数据报表', icon: <BarChartOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['reviewer', 'mlr', 'admin'] },
  {
    key: 'strategies',
    path: '/strategies',
    label: '策略中心',
    icon: <SettingOutlined style={{ fontSize: ICON_SIZE }} />,
    roles: ['admin', 'mlr'],
    children: [
      { key: 'strategies-list', path: '/strategies', label: '策略管理' },
      { key: 'strategies-scene', path: '/strategies/scene-config', label: '场景管理' },
      { key: 'strategies-image', path: '/strategies/custom-image', label: '自定义图片' },
      { key: 'strategies-text', path: '/strategies/custom-text', label: '自定义文本' },
    ],
  },
  { key: 'admin', path: '/admin/users', label: '系统管理', icon: <TeamOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin'] },
  { key: 'tags', path: '/tags', label: '标签管理', icon: <TagsOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin', 'mlr'] },
  { key: 'human-review-rules', path: '/human-review-rules', label: '人工审核策略', icon: <AuditOutlined style={{ fontSize: ICON_SIZE }} />, roles: ['admin', 'mlr'] },
]

export default function AppLayout() {
  const { message } = App.useApp()
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

  const items: MenuItem[] = ALL_NAV.filter((n) => n.roles.includes(user.role)).map((n) => {
    if (!n.children) {
      return {
        key: n.path,
        icon: n.icon,
        label: <Link to={n.path}>{n.label}</Link>,
      }
    }
    return {
      key: n.key,
      icon: n.icon,
      label: n.label,
      children: n.children.map((c) => ({
        key: c.path,
        label:
          c.path === '#soon' ? (
            <span
              onClick={() => message.info(`${c.label} - 即将上线`)}
              style={{ cursor: 'pointer' }}
            >
              {c.label}
            </span>
          ) : (
            <Link to={c.path}>{c.label}</Link>
          ),
      })),
    }
  })

  const allPaths = ALL_NAV.filter((n) => n.roles.includes(user.role)).flatMap((n) =>
    n.children ? n.children.map((c) => c.path) : [n.path],
  )
  const candidates = allPaths
    .filter((k) => k !== '#soon')
    .sort((a, b) => b.length - a.length)
  const activeKey =
    candidates.find((k) => location.pathname === k || location.pathname.startsWith(`${k}/`)) ||
    '/dashboard'

  const openKeys = ALL_NAV.filter((n) => n.children && n.roles.includes(user.role))
    .filter((n) => location.pathname.startsWith(n.path))
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
            fontSize: 16,
            borderBottom: '1px solid #1E293B',
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
          style={{ borderRight: 0 }}
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
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
