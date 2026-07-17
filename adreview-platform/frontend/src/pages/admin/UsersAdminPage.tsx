import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import {
  usersApi,
  type UserCreatePayload,
  type UserUpdatePayload,
} from '@/api/admin'
import { useAuthStore } from '@/store'
import {
  MERGED_ROLE_LABELS,
  MERGED_ROLE_OPTIONS,
  pickPrimaryStaffSubrole,
  toMergedRoleKey,
  type User,
  type UserRole,
} from '@/types/domain'

const { Title } = Typography

interface BaseFormValues {
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
}

interface CreateFormValues extends BaseFormValues {
  password: string
  confirm_password: string
}

export default function UsersAdminPage() {
  const { message } = App.useApp()
  const currentUser = useAuthStore((s) => s.user)
  const [items, setItems] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [roleFilter, setRoleFilter] = useState<string[]>([])
  const [createForm] = Form.useForm<CreateFormValues>()
  const [editForm] = Form.useForm<BaseFormValues>()

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

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    createForm.resetFields()
    createForm.setFieldsValue({
      email: '',
      full_name: '',
      password: '',
      confirm_password: '',
      role: pickPrimaryStaffSubrole(),
      is_active: true,
    })
  }

  const openEdit = (u: User) => {
    setCreating(false)
    setEditing(u)
    editForm.setFieldsValue({
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      is_active: u.is_active,
    })
  }

  const closeDrawer = () => {
    setEditing(null)
    setCreating(false)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    if (v.password !== v.confirm_password) {
      message.error('两次密码不一致')
      return
    }
    const payload: UserCreatePayload = {
      email: v.email,
      full_name: v.full_name,
      password: v.password,
      role: v.role,
      is_active: v.is_active,
    }
    setSaving(true)
    try {
      const created = await usersApi.create(payload)
      setItems((prev) => [created, ...prev])
      message.success('已创建')
      closeDrawer()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const submitEdit = async () => {
    if (!editing) return
    const v = await editForm.validateFields().catch(() => null)
    if (!v) return
    const isSelf = currentUser?.id === editing.id
    const payload: UserUpdatePayload = {
      full_name: v.full_name,
      role: v.role,
    }
    if (!isSelf) payload.is_active = v.is_active
    setSaving(true)
    try {
      const updated = await usersApi.update(editing.id, payload)
      setItems((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      message.success('已保存')
      closeDrawer()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const submitDelete = async (u: User) => {
    try {
      await usersApi.delete(u.id)
      setItems((prev) => prev.filter((x) => x.id !== u.id))
      message.success(`已删除 ${u.email}`)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const filteredItems = useMemo(() => {
    if (roleFilter.length === 0) return items
    const matched: User[] = []
    for (const u of items) {
      if (roleFilter.includes(toMergedRoleKey(u.role))) matched.push(u)
    }
    return matched
  }, [items, roleFilter])

  const columns: TableColumnsType<User> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '邮箱', dataIndex: 'email' },
    { title: '姓名', dataIndex: 'full_name' },
    {
      title: '角色', dataIndex: 'role', width: 140,
      render: (r: UserRole) => {
        const merged = toMergedRoleKey(r)
        const color =
          merged === 'root_admin' || merged === 'superadmin'
            ? 'purple'
            : merged === 'admin'
            ? 'blue'
            : 'default'
        return <Tag color={color}>{MERGED_ROLE_LABELS[merged]}</Tag>
      },
    },
    {
      title: '状态', dataIndex: 'is_active', width: 100,
      render: (a: boolean) => (a ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 160, fixed: 'right',
      render: (_v, row) => {
        const isSelf = currentUser?.id === row.id
        return (
          <Space size="small">
            <Button type="link" size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
            {isSelf ? (
              <Tooltip title="不能删除当前登录账号">
                <Button type="link" size="small" disabled>
                  删除
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                title={`确认删除 ${row.email}?`}
                description="删除后该账号无法登录，但历史业务数据保留"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => submitDelete(row)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  const isSelfEditing = editing != null && currentUser?.id === editing.id

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          用户管理
        </Title>
        <Space size="middle" wrap>
          <Select
            mode="multiple"
            allowClear
            placeholder="按角色过滤"
            style={{ minWidth: 220 }}
            value={roleFilter}
            onChange={setRoleFilter}
            options={MERGED_ROLE_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增用户
          </Button>
        </Space>
      </div>

      <Table<User>
        rowKey="id"
        loading={loading}
        dataSource={filteredItems}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />

      <Drawer
        open={creating}
        onClose={closeDrawer}
        title="新增用户"
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button type="primary" loading={saving} onClick={submitCreate}>
              创建
            </Button>
          </Space>
        }
      >
        <Form<CreateFormValues> form={createForm} layout="vertical">
          <Form.Item
            name="email"
            label="邮箱"
            validateTrigger={['onBlur', 'onSubmit']}
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入合法邮箱' },
            ]}
          >
            <Input maxLength={255} placeholder="someone@example.com" />
          </Form.Item>
          <Form.Item
            name="full_name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }, { max: 128 }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '至少 8 位' },
              { max: 128, message: '不超过 128 位' },
            ]}
            extra="8 ~ 128 位"
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_r, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            extra="业务员 = 提交者 / 审核员 / MLR 专家"
          >
            <Select
              options={MERGED_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) =>
                createForm.setFieldValue('role', v === 'staff' ? pickPrimaryStaffSubrole() : v)
              }
            />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        open={editing != null}
        onClose={closeDrawer}
        title={editing ? `编辑用户: ${editing.email}` : ''}
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button type="primary" loading={saving} onClick={submitEdit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<BaseFormValues> form={editForm} layout="vertical">
          <Form.Item
            name="email"
            label="邮箱"
            extra="邮箱不可修改"
          >
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="full_name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }, { max: 128 }]}
          >
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            extra="业务员 = 提交者 / 审核员 / MLR 专家"
          >
            <Select
              options={MERGED_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) =>
                editForm.setFieldValue('role', v === 'staff' ? pickPrimaryStaffSubrole() : v)
              }
            />
          </Form.Item>
          <Form.Item
            name="is_active"
            label="启用"
            valuePropName="checked"
            extra={isSelfEditing ? '不能停用当前登录账号' : undefined}
          >
            <Switch disabled={isSelfEditing} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
