import { useNavigate } from 'react-router-dom'
import { Steps, Card, Button, Space, Typography } from 'antd'
import {
  SettingOutlined,
  ExperimentOutlined,
  ApiOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store'
import type { UserRole } from '@/types/auth'

const { Text } = Typography

interface StepDef {
  key: string
  title: string
  icon: React.ReactNode
  description: string
  ctas: Array<{ label: string; to: string; primary?: boolean }>
  visibleTo: UserRole[] | 'all'
}

const STEPS: StepDef[] = [
  {
    key: 'config-strategy',
    title: '配置策略',
    icon: <SettingOutlined />,
    description: '进入策略中心，按业务场景选择机审服务并组装审核策略。',
    ctas: [{ label: '审核策略', to: '/strategies', primary: true }],
    visibleTo: 'all',
  },
  {
    key: 'test-strategy',
    title: '测试策略',
    icon: <ExperimentOutlined />,
    description: '在在线审核页提交一段测试素材，验证策略命中是否符合预期。',
    ctas: [{ label: '在线审核', to: '/online-review', primary: true }],
    visibleTo: 'all',
  },
  {
    key: 'integrate',
    title: '完成接口调用',
    icon: <ApiOutlined />,
    description: '参考 API 文档将审核能力集成到业务系统，平台会异步返回审核结果。',
    ctas: [],
    visibleTo: 'all',
  },
  {
    key: 'view-result',
    title: '查看审核结果',
    icon: <EyeOutlined />,
    description: '在数据查询中查看每条审核明细，或在数据报表查看汇总统计。',
    ctas: [
      { label: '数据查询', to: '/query', primary: true },
      { label: '数据报表', to: '/reports' },
    ],
    visibleTo: 'all',
  },
]

export function QuickStartSteps() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  if (!user) return null

  const visible = STEPS.filter(
    (s) => s.visibleTo === 'all' || s.visibleTo.includes(user.role),
  )

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          <span>产品介绍 · 使用流程</span>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            平台核心流程与角色对应功能一览
          </Text>
        </Space>
      }
      styles={{ body: { padding: '24px 24px 8px' } }}
    >
      <Steps
        direction="horizontal"
        current={-1}
        responsive={false}
        items={visible.map((s) => ({
          key: s.key,
          title: s.title,
          description: (
            <div style={{ minHeight: 96 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {s.description}
              </Text>
              {s.ctas.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Space size="small" wrap>
                    {s.ctas.map((c) => (
                      <Button
                        key={c.label}
                        type={c.primary ? 'primary' : 'default'}
                        size="small"
                        onClick={() => navigate(c.to)}
                      >
                        {c.label}
                      </Button>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          ),
          icon: s.icon,
          status: 'wait' as const,
        }))}
      />
    </Card>
  )
}