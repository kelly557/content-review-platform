import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined, MoreOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { tenantsApi } from '@/api/tenants'
import { usersApi } from '@/api/admin'
import type { Tenant, TenantCreateInput } from '@/types/tenant'

const { Title, Text } = Typography

export default function TenantsAdminPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<TenantCreateInput & {
    is_active?: boolean
    admin_identifier?: string
    admin_password?: string
    admin_name?: string
  }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await tenantsApi.list()
      setTenants(list)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || (e as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true })
    setDrawerOpen(true)
  }

  const openEdit = (t: Tenant) => {
    setEditing(t)
    form.setFieldsValue({
      code: t.code,
      name: t.name,
      contact_email: t.contact_email,
      is_active: t.is_active,
    })
    setDrawerOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await tenantsApi.update(editing.id, {
          name: values.name.trim(),
          contact_email: values.contact_email?.trim() || undefined,
          is_active: values.is_active ?? true,
        })
        message.success('租户已更新')
      } else {
        const tenant = await tenantsApi.create({
          code: values.code.trim(),
          name: values.name.trim(),
          contact_email: values.contact_email?.trim() || undefined,
          is_active: values.is_active ?? true,
        })
        try {
          const identifier = values.admin_identifier!.trim()
          const isAdminEmail = identifier.includes('@')
          const baseName = values.admin_name?.trim() || identifier.split('@')[0]
          const password = values.admin_password!
          const roles: Array<{ role: 'superadmin' | 'admin' | 'staff'; suffix: string; label: string }> = [
            { role: 'superadmin', suffix: '_superadmin', label: '超级管理员' },
            { role: 'admin', suffix: '_admin', label: '管理员' },
            { role: 'staff', suffix: '_staff', label: '业务员' },
          ]
          for (const r of roles) {
            try {
              const userIdentifier = isAdminEmail
                ? `${identifier.split('@')[0]}${r.suffix}@${identifier.split('@')[1]}`
                : `${identifier}${r.suffix}`
              await usersApi.create({
                email: isAdminEmail ? userIdentifier : null,
                username: isAdminEmail ? null : userIdentifier,
                full_name: `${baseName}（${r.label}）`,
                password,
                role: r.role,
                is_active: true,
                tenant_id: tenant.id,
              })
            } catch {
              // 单个角色创建失败不阻断其他
            }
          }
        } catch (e) {
          const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.warning(`租户已创建，但部分默认用户创建失败：${detail ?? '请手动创建'}`)
        }
        message.success('租户已创建')
      }
      setDrawerOpen(false)
      form.resetFields()
      await load()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (detail) message.error(detail)
      else if ((e as Error).message) message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleActive = async (t: Tenant) => {
    const next = !t.is_active
    try {
      await tenantsApi.update(t.id, { is_active: next })
      message.success(next ? '已启用' : '已禁用')
      await load()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || (e as Error).message)
    }
  }

  const columns: ColumnsType<Tenant> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        width: '28%',
        render: (_, t) => (
          <div>
            <span style={{ fontWeight: 500 }}>{t.name}</span>
            {!t.is_active && (
              <Tag color="default" style={{ marginLeft: 8 }}>
                已禁用
              </Tag>
            )}
          </div>
        ),
      },
      {
        title: 'Code',
        dataIndex: 'code',
        key: 'code',
        width: '15%',
        render: (c: string) => <Text code>{c}</Text>,
      },
      {
        title: '联系人',
        dataIndex: 'contact_email',
        key: 'contact',
        width: '22%',
        render: (e: string) => (e ? <Text>{e}</Text> : <Text type="secondary">-</Text>),
      },
      {
        title: 'Keys',
        dataIndex: 'key_count',
        key: 'keys',
        width: '8%',
        render: (n: number) => <Tag>{n ?? 0}</Tag>,
      },
      {
        title: '用户',
        dataIndex: 'user_count',
        key: 'users',
        width: '8%',
        render: (n: number) => <Tag>{n ?? 0}</Tag>,
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created',
        width: '15%',
        render: (iso: string) => dayjs(iso).format('YYYY-MM-DD'),
      },
      {
        title: '操作',
        key: 'actions',
        width: '10%',
        render: (_, t) => (
          <Dropdown
            menu={{
              items: [
                { key: 'edit', label: '编辑', onClick: () => openEdit(t) },
                {
                  key: 'toggle',
                  label: t.is_active ? '禁用' : '启用',
                  onClick: () => handleToggleActive(t),
                },
                { type: 'divider' as const },
                {
                  key: 'view-users',
                  label: '查看用户',
                  onClick: () => navigate(`/admin/users?tenant_id=${t.id}`),
                },
                {
                  key: 'view-keys',
                  label: '查看 API Key',
                  onClick: () => navigate(`/admin/api-keys?tenant_id=${t.id}`),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} size="small">
              更多
            </Button>
          </Dropdown>
        ),
      },
    ],
    [navigate],
  )

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            租户管理
          </Title>
          <Text type="secondary">系统所有租户及其关联 API Key 数量</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建租户
          </Button>
        </Space>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tenants}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (n) => `共 ${n} 条` }}
          size="middle"
        />
      )}

      <Drawer
        title={editing ? '编辑租户' : '新建租户'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              {editing ? '保存' : '创建'}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="Code (租户唯一标识)"
            rules={[
              { required: true, message: '请输入 code' },
              { pattern: /^[a-z0-9_-]{2,32}$/, message: '2-32 位小写字母/数字/下划线/连字符' },
            ]}
          >
            <Input placeholder="如：acme" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 128, message: '不超过 128 字符' },
            ]}
          >
            <Input placeholder="如：Acme 投放" maxLength={128} showCount />
          </Form.Item>
          <Form.Item
            name="contact_email"
            label="联系人邮箱"
            rules={[{ type: 'email', message: '邮箱格式不正确' }]}
          >
            <Input placeholder="选填" />
          </Form.Item>
          {!editing && (
            <>
              <Form.Item
                name="admin_identifier"
                label="初始超级管理员（用户名或邮箱）"
                rules={[
                  { required: true, message: '请输入用户名或邮箱' },
                ]}
              >
                <Input placeholder="zhangsan 或 admin@acme.com" maxLength={255} />
              </Form.Item>
              <Form.Item
                name="admin_name"
                label="初始超级管理员姓名"
                rules={[{ max: 128, message: '不超过 128 字符' }]}
              >
                <Input placeholder="选填，默认用标识前缀" maxLength={128} />
              </Form.Item>
              <Form.Item
                name="admin_password"
                label="初始超级管理员密码"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 8, message: '至少 8 位' },
                  { max: 128, message: '不超过 128 位' },
                ]}
                extra="8 ~ 128 位，3 个默认角色用户共用此密码"
              >
                <Input.Password placeholder="至少 8 位" />
              </Form.Item>
            </>
          )}
          {editing && (
            <Form.Item name="is_active" label="启用状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          )}
        </Form>
      </Drawer>
    </div>
  )
}
