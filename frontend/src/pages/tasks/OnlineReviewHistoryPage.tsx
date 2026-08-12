import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  listOnlineReviewLogs,
  type ListLogsParams,
} from '@/api/onlineReview'
import type { OnlineReviewLogListItem } from '@/api/onlineReviewTypes'
import { colors } from '@/styles/theme'

const { Title, Text } = Typography

const MEDIA_LABEL: Record<string, string> = {
  text: '文本',
  image: '图文',
  video: '视频',
  document: '文档',
}

export default function OnlineReviewHistoryPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<OnlineReviewLogListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [params] = useState<ListLogsParams>({ limit: 50 })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listOnlineReviewLogs(params)
      setRows(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const columns: ColumnsType<OnlineReviewLogListItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 80,
      render: (id: number) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/online-review/history/${id}`)}>
          #{id}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'media_type',
      width: 80,
      render: (v: string) => <Tag>{MEDIA_LABEL[v] || v}</Tag>,
    },
    {
      title: '结论',
      dataIndex: 'conclusion',
      width: 90,
      render: (v: string, r) => (
        <Tag color={r.conclusion_type === 2 ? 'error' : 'success'}>{v}</Tag>
      ),
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: 100,
    },
    {
      title: '引擎',
      dataIndex: 'engines_used',
      width: 140,
      render: (v: string[]) => (
        <Space size={4}>
          {v.map((e) => (
            <Tag key={e} bordered={false} color={e === 'llm' ? 'geekblue' : 'default'}>
              {e === 'llm' ? '大模型' : '词库'}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 140,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '输入预览',
      dataIndex: 'input_preview',
      ellipsis: true,
      render: (v: string) => (
        <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>
          {v || <Text type="secondary">（空）</Text>}
        </Text>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'latency_ms',
      width: 90,
      render: (v: number) => `${v} ms`,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          在线审核历史
        </Title>
        <Button onClick={load} loading={loading}>
          刷新
        </Button>
      </div>
      {error && (
        <Alert
          type="error"
          message="加载失败"
          description={error}
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError(null)}
        />
      )}
      <Card
        size="small"
        style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="small"
          scroll={{ x: 900 }}
        />
      </Card>
    </div>
  )
}
