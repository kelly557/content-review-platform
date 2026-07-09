import { Tabs } from 'antd'

interface TaskStatusTabsProps {
  activeKey: string
  onChange: (key: string) => void
  counts: {
    all: number
    pending: number
    approved: number
    rejected: number
    returned: number
    canceled: number
  }
}

export default function TaskStatusTabs({ activeKey, onChange, counts }: TaskStatusTabsProps) {
  const items = [
    { key: 'all', label: `全部 (${counts.all})` },
    { key: 'pending', label: `待处理 (${counts.pending})` },
    { key: 'approved', label: `已通过 (${counts.approved})` },
    { key: 'rejected', label: `已驳回 (${counts.rejected})` },
    { key: 'returned', label: `已退回 (${counts.returned})` },
    { key: 'canceled', label: `已取消 (${counts.canceled})` },
  ]

  return (
    <Tabs
      activeKey={activeKey}
      onChange={onChange}
      items={items}
      style={{ marginBottom: 16 }}
    />
  )
}
