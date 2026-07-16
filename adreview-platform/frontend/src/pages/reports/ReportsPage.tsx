import { useState } from 'react'
import { Button, Space, Tabs } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { reportsApi } from '@/api/reports'
import { useAuthStore } from '@/store'
import TrendTab from './tabs/TrendTab'
import AnomalyTab from './tabs/AnomalyTab'
import QualityTab from './tabs/QualityTab'
import RiskProfileTab from './tabs/RiskProfileTab'

export default function ReportsPage() {
  const { user } = useAuthStore()
  const isRootAdmin = user?.role === 'root_admin'
  const [tab, setTab] = useState<'trend' | 'anomaly' | 'quality' | 'risk'>('trend')

  const tabItems = [
    { key: 'trend', label: '趋势分析', children: <TrendTab /> },
    { key: 'anomaly', label: '异常分析', children: <AnomalyTab /> },
    ...(isRootAdmin
      ? [
          { key: 'quality', label: '质量分析', children: <QualityTab /> },
          { key: 'risk', label: '风险画像', children: <RiskProfileTab /> },
        ]
      : []),
  ]

  return (
    <div style={{ width: '100%' }}>
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'trend' | 'anomaly' | 'quality' | 'risk')}
        items={tabItems}
        tabBarExtraContent={
          <Space>
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
      />
    </div>
  )
}
