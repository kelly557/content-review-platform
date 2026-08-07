import { useEffect, useState } from 'react'
import { Card, Spin, Empty } from 'antd'
import { Column } from '@ant-design/charts'
import { reportsApi } from '@/api/reports'
import type { RiskDistributionBucket } from '@/types/domain'

interface Props {
  days?: number
}

const RISK_COLOR_MAP: Record<string, string> = {
  高风险: '#DC2626',
  中风险: '#D97706',
  低风险: '#16A34A',
  敏感: '#7C3AED',
  无风险: '#94A3B8',
}

export function RiskDistributionChart({ days = 7 }: Props) {
  const [data, setData] = useState<RiskDistributionBucket[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    reportsApi
      .riskDistribution(days)
      .then((res) => {
        if (!alive) return
        setData(res.buckets)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [days])

  const chart = data?.map((b) => ({ ...b, color: RISK_COLOR_MAP[b.level] || '#94A3B8' })) ?? []

  return (
    <Card title={`风险等级分布 · 近 ${days} 天`} size="small">
      <Spin spinning={loading}>
        {error ? (
          <Empty description={error} />
        ) : chart.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Column
            data={chart}
            xField="level"
            yField="count"
            height={260}
            colorField="color"
            scale={{ color: { range: chart.map((d) => d.color) } }}
            label={{
              position: 'top',
              style: { fill: '#475569', fontSize: 11 },
            }}
            axis={{
              x: { labelFontSize: 12 },
              y: { labelFontSize: 11 },
            }}
            animate={false}
          />
        )}
      </Spin>
    </Card>
  )
}