import { useEffect, useState } from 'react'
import { Row, Col, Space, Typography } from 'antd'
import { useAuthStore } from '@/store'
import { QuickStartSteps } from './components/QuickStartSteps'
import { RiskTrendChart } from './components/RiskTrendChart'
import { RiskDistributionChart } from './components/RiskDistributionChart'
import { TopRiskList } from './components/TopRiskList'

const { Title, Text } = Typography

const DAYS = 7

export default function OverviewPage() {
  const { user } = useAuthStore()
  const [now] = useState(() => new Date())

  useEffect(() => {
    document.title = '总览 · 内容安全审核管理平台'
  }, [])

  if (!user) return null

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          欢迎回来，{user.full_name}
        </Title>
        <Text type="secondary">
          今天是 {now.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>
      </div>

      <QuickStartSteps />

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <RiskTrendChart days={DAYS} />
          <div style={{ marginTop: 24 }}>
            <RiskDistributionChart days={DAYS} />
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <TopRiskList days={DAYS} limit={5} />
        </Col>
      </Row>
    </Space>
  )
}