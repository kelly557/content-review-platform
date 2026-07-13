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
  void counts
  const items = [
    { key: 'all', label: '' },
    { key: 'pending', label: '' },
    { key: 'approved', label: '' },
    { key: 'rejected', label: '' },
    { key: 'returned', label: '' },
    { key: 'canceled', label: '' },
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
