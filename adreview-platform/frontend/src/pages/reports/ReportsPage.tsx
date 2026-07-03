import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Button, Space, Typography } from 'antd'
import { DownloadOutlined, BarChartOutlined } from '@ant-design/icons'
import { reportsApi } from '@/api/admin'
import type { OverviewStats } from '@/types/domain'

const { Text } = Typography

export default function ReportsPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const s = await reportsApi.overview()
      setStats(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <BarChartOutlined />
            审核效率概览
          </Space>
        }
        extra={
          <Button
            icon={<DownloadOutlined />}
            href={reportsApi.exportAuditUrl()}
            target="_blank"
            rel="noreferrer"
          >
            导出审计 CSV
          </Button>
        }
      >
        {stats ? (
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Statistic title="素材总数" value={stats.total_materials} /></Col>
            <Col xs={12} md={6}><Statistic title="审核中" value={stats.in_review} /></Col>
            <Col xs={12} md={6}><Statistic title="已通过" value={stats.approved} valueStyle={{ color: '#16A34A' }} /></Col>
            <Col xs={12} md={6}><Statistic title="已驳回" value={stats.rejected} valueStyle={{ color: '#DC2626' }} /></Col>
            <Col xs={24}>
              <Card>
                <Statistic
                  title="平均审核时长（小时）"
                  value={stats.avg_review_hours ?? '-'}
                  precision={stats.avg_review_hours != null ? 2 : 0}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  基于已完成任务的创建-完成时间差
                </Text>
              </Card>
            </Col>
          </Row>
        ) : (
          <Text type="secondary">{loading ? '加载中…' : '无数据'}</Text>
        )}
      </Card>
    </Space>
  )
}
