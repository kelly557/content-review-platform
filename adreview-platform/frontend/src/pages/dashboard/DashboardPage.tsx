import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Typography, Spin, Empty, Tag, Space, List } from 'antd'
import {
  FileImageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store'
import { reportsApi } from '@/api/admin'
import { materialsApi } from '@/api/materials'
import { reviewsApi } from '@/api/reviews'
import { STATUS_LABELS, STATUS_COLORS, DECISION_LABELS, TYPE_LABELS } from '@/types/domain'
import type { OverviewStats, ReviewTask, MaterialListItem } from '@/types/domain'

const { Title, Text } = Typography

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [myTasks, setMyTasks] = useState<ReviewTask[]>([])
  const [recent, setRecent] = useState<MaterialListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const isReviewer = ['reviewer', 'mlr', 'admin'].includes(user.role)
    Promise.all([
      isReviewer ? reportsApi.overview().catch(() => null) : Promise.resolve(null),
      isReviewer
        ? reviewsApi.myTasks({ pending: true, size: 5 }).then((p: { items: ReviewTask[] }) => p.items).catch(() => [] as ReviewTask[])
        : Promise.resolve([] as ReviewTask[]),
      materialsApi.list({ size: 5, mine: user.role === 'submitter' }).then((p: { items: MaterialListItem[] }) => p.items).catch(() => [] as MaterialListItem[]),
    ])
      .then(([s, t, r]) => {
        setStats(s)
        setMyTasks(t)
        setRecent(r)
      })
      .finally(() => setLoading(false))
  }, [user])

  if (!user) return null

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            欢迎回来，{user.full_name}
          </Title>
          <Text type="secondary">今天是 {new Date().toLocaleDateString('zh-CN')}</Text>
        </div>

        {stats && (
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Card>
                <Statistic
                  title="素材总数"
                  value={stats.total_materials}
                  prefix={<FileImageOutlined style={{ color: '#0369A1' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card>
                <Statistic
                  title="审核中"
                  value={stats.in_review}
                  prefix={<ClockCircleOutlined style={{ color: '#D97706' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card>
                <Statistic
                  title="已通过"
                  value={stats.approved}
                  prefix={<CheckCircleOutlined style={{ color: '#16A34A' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card>
                <Statistic
                  title="已驳回"
                  value={stats.rejected}
                  prefix={<CloseCircleOutlined style={{ color: '#DC2626' }} />}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card
              title="我的待办"
              extra={<a onClick={() => navigate('/reviews')}>查看全部</a>}
              styles={{ body: { padding: 0 } }}
            >
              {myTasks.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" style={{ padding: 32 }} />
              ) : (
                <List
                  dataSource={myTasks}
                  renderItem={(t) => (
                    <List.Item
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => navigate(`/reviews/${t.id}`)}
                    >
                      <List.Item.Meta
                        title={t.title}
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            阶段: {t.stage_key} · {new Date(t.created_at).toLocaleString('zh-CN')}
                          </Text>
                        }
                      />
                      <Tag color="processing">{DECISION_LABELS[t.final_decision]}</Tag>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card
              title="最近素材"
              extra={<a onClick={() => navigate('/materials')}>查看全部</a>}
              styles={{ body: { padding: 0 } }}
            >
              {recent.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" style={{ padding: 32 }} />
              ) : (
                <List
                  dataSource={recent}
                  renderItem={(m) => (
                    <List.Item
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => navigate(`/materials/${m.id}`)}
                    >
                      <List.Item.Meta
                        title={m.title}
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {TYPE_LABELS[m.material_type]} · {new Date(m.updated_at).toLocaleString('zh-CN')}
                          </Text>
                        }
                      />
                      <Tag color={STATUS_COLORS[m.status]}>{STATUS_LABELS[m.status]}</Tag>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        </Row>
      </Space>
    </Spin>
  )
}
