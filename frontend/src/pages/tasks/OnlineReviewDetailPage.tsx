import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Typography } from 'antd'
import { getOnlineReviewLog } from '@/api/onlineReview'
import type { OnlineReviewLogDetail, OnlineReviewInputItem } from '@/api/onlineReviewTypes'
import JsonTreeView from '@/components/task-create/JsonTreeView'
import { colors } from '@/styles/theme'

const { Title, Text, Paragraph } = Typography

const MEDIA_LABEL: Record<string, string> = {
  text: '文本',
  image: '图文',
  video: '视频',
  document: '文档',
}

/** 按多模态类型渲染单个输入项: 文本/图/帧/页 分开展示. */
function InputItemView({ item, index }: { item: OnlineReviewInputItem; index: number }) {
  const kind = item.kind || 'text'
  const label = (() => {
    switch (kind) {
      case 'frame':
        return `第 ${item.frame_no ?? index + 1} 帧`
      case 'page':
        return `第 ${item.page_no ?? index + 1} 页`
      case 'image':
        return `图 ${index + 1}${item.name ? ` · ${item.name}` : ''}`
      case 'text':
        return item.name || `文本 ${index + 1}`
      default:
        return item.name || `片段 ${index + 1}`
    }
  })()

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        padding: '10px 12px',
        marginBottom: 8,
        background: colors.surface,
      }}
    >
      <div style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Tag bordered={false} color={kind === 'text' ? 'default' : 'blue'}>
          {label}
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {kind}
        </Text>
      </div>
      {item.text ? (
        <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {item.text}
        </Paragraph>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          （无文本内容）
        </Text>
      )}
    </div>
  )
}

export default function OnlineReviewDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<OnlineReviewLogDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    getOnlineReviewLog(Number(id))
      .then(setDetail)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="加载失败" description={error} />
        <Button style={{ marginTop: 16 }} onClick={() => navigate('/online-review/history')}>
          返回列表
        </Button>
      </div>
    )
  }
  if (!detail) return null

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button size="small" onClick={() => navigate('/online-review/history')}>
            ← 返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            在线审核记录 #{detail.id}
          </Title>
        </Space>
      </div>

      {detail.llm_error && (
        <Alert
          type="warning"
          showIcon
          message="大模型未参与本次检测"
          description={detail.llm_error}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card size="small" title="基本信息" style={{ marginBottom: 16, background: colors.surface }}>
        <Descriptions size="small" column={3} bordered>
          <Descriptions.Item label="媒体类型">{MEDIA_LABEL[detail.media_type] || detail.media_type}</Descriptions.Item>
          <Descriptions.Item label="结论">
            <Tag color={detail.conclusion_type === 2 ? 'error' : 'success'}>{detail.conclusion}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="风险等级">{detail.risk_level}</Descriptions.Item>
          <Descriptions.Item label="引擎">
            <Space size={4}>
              {detail.engines_used.map((e) => (
                <Tag key={e} bordered={false} color={e === 'llm' ? 'geekblue' : 'default'}>
                  {e === 'llm' ? '大模型' : '词库'}
                </Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="模型">{detail.model || '—'}</Descriptions.Item>
          <Descriptions.Item label="耗时">{detail.latency_ms} ms</Descriptions.Item>
          <Descriptions.Item label="关联 LLM 调用">
            {detail.correlation_id ? (
              <Text code copyable style={{ fontSize: 12 }}>
                {detail.correlation_id.slice(0, 16)}…
              </Text>
            ) : (
              <Text type="secondary">—</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="策略 ID">{detail.strategy_id ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="时间">{new Date(detail.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        size="small"
        title={`输入内容（${detail.input_items.length} 项）`}
        style={{ marginBottom: 16, background: colors.surface }}
      >
        {detail.input_items.length === 0 ? (
          <Text type="secondary">无输入内容</Text>
        ) : (
          detail.input_items.map((it, i) => <InputItemView key={i} item={it} index={i} />)
        )}
      </Card>

      <Card size="small" title={`命中详情（${detail.hits.length} 条）`} style={{ background: colors.surface }}>
        {detail.hits.length === 0 ? (
          <Text type="secondary">未检测到风险内容</Text>
        ) : (
          <div
            style={{
              background: colors.surface,
              padding: '12px 14px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
            }}
          >
            <JsonTreeView data={detail.hits} initialDepth={2} />
          </div>
        )}
      </Card>
    </div>
  )
}
