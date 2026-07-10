import { useEffect, useState } from 'react'
import { Card, Spin, Empty } from 'antd'
import { Line } from '@ant-design/charts'
import { reportsApi } from '@/api/reports'
import type { RiskTimeseriesPoint } from '@/types/domain'

interface Props {
  days?: number
}

export function RiskTrendChart({ days = 7 }: Props) {
  const [data, setData] = useState<RiskTimeseriesPoint[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    reportsApi
      .riskTrend(days)
      .then((res) => {
        if (!alive) return
        setData(res.points)
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

  const flat =
    data?.flatMap((p) => [
      { date: p.date, level: '高风险', count: p.high },
      { date: p.date, level: '中风险', count: p.medium },
    ]) ?? []

  return (
    <Card title={`风险检出趋势 · 近 ${days} 天`} size="small">
      <Spin spinning={loading}>
        {error ? (
          <Empty description={error} />
        ) : flat.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Line
            data={flat}
            xField="date"
            yField="count"
            seriesField="level"
            smooth
            height={260}
            point={{ shapeField: 'circle', sizeField: 3 }}
            color={['#DC2626', '#D97706']}
            legend={{ color: { position: 'top-right' } }}
            axis={{
              x: { labelAutoRotate: false, labelFontSize: 11 },
              y: { labelFontSize: 11 },
            }}
            style={{ fillOpacity: 0.15 }}
            animate={false}
          />
        )}
      </Spin>
    </Card>
  )
}