import { useState } from 'react'
import { Button, Card, Space, Tabs, Typography } from 'antd'
import { BarChartOutlined, DownloadOutlined } from '@ant-design/icons'
import { reportsApi } from '@/api/reports'
import TrendTab from './tabs/TrendTab'
import AnomalyTab from './tabs/AnomalyTab'
import QualityTab from './tabs/QualityTab'
import RiskProfileTab from './tabs/RiskProfileTab'

const { Text } = Typography

export default function ReportsPage() {
  const [tab, setTab] = useState<'trend' | 'anomaly' | 'quality' | 'risk'>('trend')

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <BarChartOutlined />
            数据分析
          </Space>
        }
        extra={
          <Space>
            <Text type="secondary">四个分析维度: 趋势 / 异常 / 质量 / 风险画像</Text>
            <Button
              icon={<DownloadOutlined />}
              href={reportsApi.exportAuditUrl()}
              target="_blank"
              rel="noreferrer"
            >
              导出审计 CSV
            </Button>
          </Space>
        }
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as 'trend' | 'anomaly' | 'quality' | 'risk')}
          items={[
            { key: 'trend', label: '趋势分析', children: <TrendTab /> },
            { key: 'anomaly', label: '异常分析', children: <AnomalyTab /> },
            { key: 'quality', label: '质量分析', children: <QualityTab /> },
            { key: 'risk', label: '风险画像', children: <RiskProfileTab /> },
          ]}
        />
      </Card>
    </Space>
  )
}
