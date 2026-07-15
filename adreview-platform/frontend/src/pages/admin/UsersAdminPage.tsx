import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useState } from 'react'
import { usersApi, type UserUpdatePayload } from '@/api/admin'
import { ROLE_LABELS, type User, type UserRole } from '@/types/domain'

const { Title } = Typography

const ROLE_OPTIONS: UserRole[] = ['submitter', 'reviewer', 'mlr', 'admin', 'superadmin']

interface EditFormValues {
  full_name: string
  role: UserRole
  is_active: boolean
}

export default function UsersAdminPage() {
  const { message } = App.useApp()
  const [items, setItems] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [editForm] = Form.useForm<EditFormValues>()

  const fetchList = () => {
    setLoading(true)
    usersApi
      .list()
      .then(setItems)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchList()
  }, [])

  const openEdit = (u: User) => {
    setEditing(u)
    editForm.setFieldsValue({
      full_name: u.full_name,
      role: u.role,
      is_active: u.is_active,
    })
  }

  const submitEdit = async () => {
    if (!editing) return
    const v = await editForm.validateFields().catch(() => null)
    if (!v) return
    const payload: UserUpdatePayload = {
      full_name: v.full_name,
      role: v.role,
      is_active: v.is_active,
    }
    setSaving(true)
    try {
      const updated = await usersApi.update(editing.id, payload)
      setItems((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      message.success('已保存')
      setEditing(null)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const columns: TableColumnsType<User> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '邮箱', dataIndex: 'email' },
    { title: '姓名', dataIndex: 'full_name' },
    {
      title: '角色', dataIndex: 'role', width: 140,
      render: (r: string) => (
        <Tag color={r === 'superadmin' ? 'purple' : 'blue'}>
          {ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r}
        </Tag>
      ),
    },
    {
      title: '状态', dataIndex: 'is_active', width: 100,
      render: (a: boolean) => a ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 120,
      render: (_v, row) => (
        <Button type="link" size="small" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <Card title={<Title level={4} style={{ margin: 0 }}>用户管理</Title>}>
      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ pageSize: 20 }} />

      <Drawer
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing ? `编辑用户: ${editing.email}` : ''}
        width={480}
        extra={
          <Space>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" loading={saving} onClick={submitEdit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<EditFormValues> form={editForm} layout="vertical">
          <Form.Item
            name="full_name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            extra="超级管理员可管理通用规则与通用平台资源"
          >
            <Select
              options={ROLE_OPTIONS.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          </Form.Item>
          <Form.Item
            name="is_active"
            label="启用"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  )
}
