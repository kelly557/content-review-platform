import { Card, Table, Tag, Typography, type TableColumnsType } from 'antd'
import { useEffect, useState } from 'react'
import { usersApi } from '@/api/admin'
import { ROLE_LABELS, type User } from '@/types/domain'

const { Title } = Typography

export default function UsersAdminPage() {
  const [items, setItems] = useState<User[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    usersApi.list().then(setItems).finally(() => setLoading(false))
  }, [])

  const columns: TableColumnsType<User> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '邮箱', dataIndex: 'email' },
    { title: '姓名', dataIndex: 'full_name' },
    {
      title: '角色', dataIndex: 'role', width: 120,
      render: (r: string) => <Tag color="blue">{ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r}</Tag>,
    },
    {
      title: '状态', dataIndex: 'is_active', width: 100,
      render: (a: boolean) => a ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ]

  return (
    <Card title={<Title level={4} style={{ margin: 0 }}>用户管理</Title>}>
      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ pageSize: 20 }} />
    </Card>
  )
}
