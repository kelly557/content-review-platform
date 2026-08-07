import { useEffect, useState } from 'react'
import { Space, Typography } from 'antd'
import { useAuthStore } from '@/store'
import { QuickStartSteps } from './components/QuickStartSteps'
import { QuickEntryGrid } from './components/QuickEntryGrid'

const { Title, Text } = Typography

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

      <QuickEntryGrid />
    </Space>
  )
}