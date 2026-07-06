import { useEffect, useState } from 'react'
import {
  Breadcrumb,
  Spin,
  Typography,
  Alert,
  Space,
  Button,
  Tag,
} from 'antd'
import {
  LinkOutlined,
  PictureOutlined,
  FontSizeOutlined,
  SoundOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import CreateStrategyForm from '@/components/CreateStrategyForm'
import { strategiesApi } from '@/api/strategies'
import type { Strategy } from '@/types/domain'

const { Title } = Typography

const SPLIT_HINTS = [
  { key: 'image', label: '图片审核', icon: <PictureOutlined /> },
  { key: 'text', label: '文本审核', icon: <FontSizeOutlined /> },
  { key: 'audio', label: '语音审核', icon: <SoundOutlined /> },
  { key: 'doc', label: '文档审核', icon: <FileTextOutlined /> },
  { key: 'video', label: '视频审核', icon: <VideoCameraOutlined /> },
] as const

export default function CreateStrategyPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const location = useLocation()
  const isEdit = Boolean(id)
  const [loading, setLoading] = useState(isEdit)
  const [initial, setInitial] = useState<Strategy | null>(null)
  const stateStep = (location.state ?? {}) as { step?: 0 | 1 }
  const initialStep = stateStep.step

  useEffect(() => {
    if (!id) return
    let cancel = false
    setLoading(true)
    strategiesApi
      .get(Number(id))
      .then((s) => {
        if (!cancel) setInitial(s)
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [id])

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/strategies')}>策略中心</a> },
          { title: isEdit ? '编辑策略' : '创建策略' },
        ]}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          {isEdit ? '编辑策略' : '创建策略'}
        </Title>
      </div>

      {isEdit && loading ? (
        <Spin />
      ) : isEdit && initial ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="保存策略后，可按审核类型单独管理已选规则"
            description={
              <Space wrap size={8}>
                {SPLIT_HINTS.map((h) => (
                  <Link
                    key={h.key}
                    to={`/strategies/rules-by-type/${h.key}?strategy=${initial.id}`}
                  >
                    <Tag
                      color="blue"
                      icon={h.icon}
                      style={{ cursor: 'pointer' }}
                    >
                      {h.label}
                    </Tag>
                  </Link>
                ))}
                <Link to={`/strategies/${initial.id}/rule-config`}>
                  <Tag color="default" icon={<LinkOutlined />} style={{ cursor: 'pointer' }}>
                    检测点阈值配置
                  </Tag>
                </Link>
              </Space>
            }
          />
          <CreateStrategyForm
            mode="edit"
            strategyId={initial.id}
            initial={initial}
            initialStep={initialStep}
            onCancel={() => navigate('/strategies')}
          />
        </>
      ) : isEdit ? (
        <Spin />
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="两步创建：先设置基本信息，再选择要纳入此策略的检测规则"
            description={
              <Space wrap size={8}>
                {SPLIT_HINTS.map((h) => (
                  <Button
                    key={h.key}
                    size="small"
                    type="default"
                    icon={h.icon}
                    onClick={() => navigate(`/strategies/rules-by-type/${h.key}`)}
                  >
                    {h.label}
                  </Button>
                ))}
              </Space>
            }
          />
          <CreateStrategyForm
            initialStep={initialStep}
            onCancel={() => navigate('/strategies')}
          />
        </>
      )}
    </div>
  )
}
