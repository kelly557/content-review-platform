import { useNavigate } from 'react-router-dom'
import { Steps, Card, Button, Space, Typography } from 'antd'
import {
  UploadOutlined,
  SendOutlined,
  SettingOutlined,
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
    key: 'upload',
    title: '上传素材',
    icon: <UploadOutlined />,
    description: '将待审核的素材（图片/视频/文本/PDF）提交到平台。',
    ctas: [{ label: '新建素材', to: '/materials', primary: true }],
    visibleTo: 'all',
  },
  {
    key: 'submit',
    title: '提交审核',
    icon: <SendOutlined />,
    description: '选择审核策略，把素材送入审核流程。',
    ctas: [{ label: '新建审核任务', to: '/tasks/new', primary: true }],
    visibleTo: ['submitter', 'reviewer', 'mlr', 'admin'],
  },
  {
    key: 'review',
    title: '审核内容',
    icon: <ThunderboltOutlined />,
    description: '查看待审核任务，执行人工审核或复核机审结果。',
    ctas: [
      { label: '进入审核任务', to: '/tasks', primary: true },
      { label: '数据查询', to: '/query' },
    ],
    visibleTo: ['reviewer', 'mlr', 'admin'],
  },
  {
    key: 'config',
    title: '配置策略 / 规则',
    icon: <SettingOutlined />,
    description: '配置审核策略、规则、词库 / 图片库 / 代答库、人工审核策略。',
    ctas: [
      { label: '审核策略', to: '/strategies', primary: true },
      { label: '知识库', to: '/knowledge/words' },
      { label: '人工审核策略', to: '/human-review-rules' },
    ],
    visibleTo: ['admin', 'mlr'],
  },
  {
    key: 'view',
    title: '查看结果',
    icon: <EyeOutlined />,
    description: '查询审核结果明细，下载审计 / 质量报告。',
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
          <span>快速开始</span>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            按推荐顺序使用平台的每个功能
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
            </div>
          ),
          icon: s.icon,
          status: 'wait' as const,
        }))}
      />
    </Card>
  )
}