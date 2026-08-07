import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Space, Typography } from 'antd'
import {
  AuditOutlined,
  SettingOutlined,
  BookOutlined,
  ExperimentOutlined,
  MessageOutlined,
  SearchOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store'
import type { UserRole } from '@/types/auth'

const { Text } = Typography

interface EntryDef {
  key: string
  title: string
  icon: React.ReactNode
  description: string
  to: string
  visibleTo: UserRole[]
}

const ENTRIES: EntryDef[] = [
  {
    key: 'online-review',
    title: '在线审核',
    icon: <AuditOutlined />,
    description: '处理待审任务或发起机审',
    to: '/online-review',
    visibleTo: ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'],
  },
  {
    key: 'strategies',
    title: '审核策略',
    icon: <SettingOutlined />,
    description: '管理机审策略及图片/文本规则',
    to: '/strategies',
    visibleTo: ['admin', 'mlr', 'superadmin', 'root_admin'],
  },
  {
    key: 'words',
    title: '词库管理',
    icon: <BookOutlined />,
    description: '维护关键词黑白名单',
    to: '/resources/words',
    visibleTo: ['admin', 'mlr', 'superadmin', 'root_admin'],
  },
  {
    key: 'models',
    title: '模型库管理',
    icon: <ExperimentOutlined />,
    description: '维护文本/图片模型配置',
    to: '/resources/models',
    visibleTo: ['admin', 'mlr', 'superadmin', 'root_admin'],
  },
  {
    key: 'replies',
    title: '代答库管理',
    icon: <MessageOutlined />,
    description: '维护审核代答话术',
    to: '/resources/replies',
    visibleTo: ['admin', 'mlr', 'superadmin', 'root_admin'],
  },
  {
    key: 'query',
    title: '数据查询',
    icon: <SearchOutlined />,
    description: '查询审核明细',
    to: '/query',
    visibleTo: ['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'],
  },
  {
    key: 'reports',
    title: '数据报表',
    icon: <BarChartOutlined />,
    description: '查看统计报表',
    to: '/reports',
    visibleTo: ['reviewer', 'mlr', 'admin', 'superadmin', 'root_admin'],
  },
]

export function QuickEntryGrid() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  if (!user) return null

  const visible = ENTRIES.filter((e) => e.visibleTo.includes(user.role))

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          <span>功能快捷入口</span>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            按角色定制的常用入口
          </Text>
        </Space>
      }
      styles={{ body: { padding: '20px 24px 24px' } }}
    >
      {visible.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          暂无可用入口
        </Text>
      ) : (
        <Row gutter={[16, 16]}>
          {visible.map((e) => (
            <Col key={e.key} xs={12} sm={12} md={8} lg={6} xl={6}>
              <div
                role="button"
                aria-label={e.title}
                tabIndex={0}
                onClick={() => navigate(e.to)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    navigate(e.to)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 16,
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  transition: 'border-color 160ms ease, box-shadow 160ms ease',
                  height: '100%',
                }}
                onMouseEnter={(ev) => {
                  ev.currentTarget.style.borderColor = '#1677ff'
                  ev.currentTarget.style.boxShadow = '0 2px 8px rgba(22,119,255,0.12)'
                }}
                onMouseLeave={(ev) => {
                  ev.currentTarget.style.borderColor = '#E2E8F0'
                  ev.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div
                  aria-hidden
                  style={{
                    flex: '0 0 auto',
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: 'rgba(22,119,255,0.08)',
                    color: '#1677ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                  }}
                >
                  {e.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#0F172A',
                      lineHeight: '22px',
                    }}
                  >
                    {e.title}
                  </div>
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block', marginTop: 2 }}
                    ellipsis
                  >
                    {e.description}
                  </Text>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  )
}