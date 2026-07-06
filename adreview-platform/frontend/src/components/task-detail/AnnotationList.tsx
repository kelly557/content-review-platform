import { useEffect, useState } from 'react'
import { App, Badge, Empty, List, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { CheckCircleOutlined } from '@ant-design/icons'
import { annotationsApi } from '@/api/reviews'
import { useAuthStore } from '@/store'
import type { Annotation } from '@/types/domain'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  versionId: number
  /** Trigger reload (e.g. after a new annotation is created). */
  refreshKey: number
  /** Called when user clicks an image annotation: switch to preview tab. */
  onJumpToImage?: () => void
}

function fmtCoord(a: Annotation): string | null {
  if (a.page != null) return `第 ${a.page} 页`
  if (a.timestamp_ms != null) {
    const s = Math.floor(a.timestamp_ms / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }
  if (a.x != null && a.y != null && a.w != null && a.h != null) return '图片区域'
  return null
}

export default function AnnotationList({ versionId, refreshKey, onJumpToImage }: Props) {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const [items, setItems] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!versionId) return
    setLoading(true)
    try {
      const res = await annotationsApi.list(versionId, 1, 200)
      setItems(res.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [versionId, refreshKey])

  const onResolve = async (id: number) => {
    try {
      await annotationsApi.resolve(id)
      message.success('已标记为解决')
      load()
    } catch {
      message.error('操作失败')
    }
  }

  const unresolvedCount = items.filter((a) => !a.resolved).length

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Space style={{ marginBottom: 12 }}>
        <Text strong>批注列表</Text>
        <Badge
          count={unresolvedCount}
          showZero
          color={unresolvedCount > 0 ? colors.destructive : colors.mutedSoft}
          style={{ backgroundColor: 'transparent' }}
        />
      </Space>

      <Spin spinning={loading}>
        {items.length === 0 ? (
          <Empty description="暂无批注" />
        ) : (
          <List
            dataSource={items}
            renderItem={(a) => {
              const coord = fmtCoord(a)
              const canResolve = !a.resolved && (user?.id === a.author_id || user?.role === 'admin')
              return (
                <List.Item
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 8,
                    background: a.resolved ? colors.surface2 : colors.surface,
                    display: 'block',
                  }}
                  actions={
                    canResolve
                      ? [
                          <Tooltip title="标记为解决" key="resolve">
                            <a onClick={() => onResolve(a.id)}>
                              <CheckCircleOutlined /> 解决
                            </a>
                          </Tooltip>,
                        ]
                      : a.resolved
                        ? [<Text key="resolved" type="success" style={{ fontSize: 12 }}><CheckCircleOutlined /> 已解决</Text>]
                        : []
                  }
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {coord && (
                      <Space size={6}>
                        <Tag color="blue" style={{ margin: 0 }}>{coord}</Tag>
                        {coord === '图片区域' && onJumpToImage && (
                          <a style={{ fontSize: 12 }} onClick={onJumpToImage}>定位预览</a>
                        )}
                      </Space>
                    )}
                    {a.quote && (
                      <Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          borderLeft: `3px solid ${colors.accent}`,
                          paddingLeft: 8,
                          background: colors.accentSoft,
                          padding: '4px 8px',
                        }}
                      >
                        “{a.quote}”
                      </Text>
                    )}
                    <div>{a.body}</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(a.created_at).toLocaleString('zh-CN')}
                    </Text>
                  </Space>
                </List.Item>
              )
            }}
          />
        )}
      </Spin>
    </div>
  )
}