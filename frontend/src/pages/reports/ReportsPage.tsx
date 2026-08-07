import { useState } from 'react'
import { Button, Space, Switch, Tabs, Tooltip, Typography } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { reportsApi } from '@/api/reports'
import { useAuthStore } from '@/store'
import { useMockReports } from '@/hooks/useMockReports'
import TrendTab from './tabs/TrendTab'
import AnomalyTab from './tabs/AnomalyTab'
import QualityTab from './tabs/QualityTab'
import RiskProfileTab from './tabs/RiskProfileTab'

const { Text } = Typography

export default function ReportsPage() {
  const { user } = useAuthStore()
  const isRootAdmin = user?.role === 'root_admin'
  const [tab, setTab] = useState<'trend' | 'anomaly' | 'quality' | 'risk'>('trend')
  const mock = useMockReports()

  const tabItems = [
    { key: 'trend', label: '趋势分析', children: <TrendTab mock={mock} /> },
    { key: 'anomaly', label: '异常分析', children: <AnomalyTab mock={mock} /> },
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
          <Space size="middle" align="center">
            <Space size="small" align="center">
              <Text type="secondary" style={{ fontSize: 12 }}>
                演示数据
              </Text>
              <Switch
                size="small"
                checked={mock.enabled}
                onChange={mock.setEnabled}
                checkedChildren="开"
                unCheckedChildren="关"
              />
              {mock.enabled && (
                <Tooltip title="重新生成 mock 数据 (变化 seed)">
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    onClick={mock.regenerate}
                  >
                    重新生成
                  </Button>
                </Tooltip>
              )}
            </Space>
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
