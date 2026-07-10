import { useEffect, useState } from 'react'
import { Card, Spin, Empty, List, Tag, Typography, Space } from 'antd'
import { reportsApi } from '@/api/reports'
import type { TopRiskLabelItem } from '@/types/domain'

const { Text } = Typography

interface Props {
  days?: number
  limit?: number
}

const RISK_TAG_COLOR: Record<string, string> = {
  高风险: 'red',
  中风险: 'orange',
  低风险: 'gold',
  敏感: 'purple',
  无风险: 'green',
}

function formatHitAt(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function TopRiskList({ days = 7, limit = 5 }: Props) {
  const [items, setItems] = useState<TopRiskLabelItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    reportsApi
      .riskTopLabels(days, limit)
      .then((res) => {
        if (!alive) return
        setItems(res.items)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [days, limit])

  return (
    <Card title={`Top ${limit} 风险类型 · 近 ${days} 天`} size="small">
      <Spin spinning={loading}>
        {error ? (
          <Empty description={error} />
        ) : !items || items.length === 0 ? (
          <Empty description={`近 ${days} 天无风险命中`} />
        ) : (
          <List
            dataSource={items}
            renderItem={(item, idx) => (
              <List.Item key={item.label} style={{ padding: '12px 4px' }}>
                <Space style={{ width: '100%' }} align="start" size={12}>
                  <Text
                    style={{
                      minWidth: 24,
                      color: '#94A3B8',
                      fontSize: 13,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {idx + 1}.
                  </Text>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={8} wrap>
                      <Tag color={RISK_TAG_COLOR[item.risk_level] || 'default'}>
                        {item.risk_level}
                      </Tag>
                      <Text strong style={{ fontSize: 13 }}>
                        {item.label}
                      </Text>
                    </Space>
                    <div style={{ marginTop: 6 }}>
                      <Text style={{ fontSize: 12, color: '#0369A1', fontWeight: 600 }}>
                        命中 {item.count} 次
                      </Text>
                    </div>
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, display: 'block', marginTop: 2 }}
                    >
                      最近命中: {formatHitAt(item.last_hit_at)}
                    </Text>
                  </div>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Spin>
    </Card>
  )
}