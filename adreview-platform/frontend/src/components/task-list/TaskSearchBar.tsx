import { Input, Button, Space } from 'antd'
import { SearchOutlined, FilterOutlined } from '@ant-design/icons'

interface TaskSearchBarProps {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
  onToggleFilter: () => void
  filterVisible: boolean
}

export default function TaskSearchBar({
  value,
  onChange,
  onSearch,
  onToggleFilter,
  filterVisible,
}: TaskSearchBarProps) {
  return (
    <Space style={{ width: '100%', marginBottom: 16 }} size="middle">
      <Input.Search
        placeholder="搜索任务标题"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSearch={onSearch}
        prefix={<SearchOutlined />}
        style={{ width: 320 }}
        allowClear
      />
      <Button
        icon={<FilterOutlined />}
        type={filterVisible ? 'primary' : 'default'}
        onClick={onToggleFilter}
      >
        高级筛选
      </Button>
    </Space>
  )
}
