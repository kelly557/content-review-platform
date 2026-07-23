import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import { PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { rolesApi } from '@/api/admin'
import type { UserRole } from '@/types/domain'
import {
  ROLE_KEY_MAX_LENGTH,
  ROLE_KEY_PATTERN,
  type RoleRow,
  type RoleUpdatePayload,
} from '@/types/role'

const { Title, Paragraph } = Typography

interface RoleFormValues {
  key: string
  display_name: string
  description?: string
  is_active: boolean
}

const DEFAULT_FORM_VALUES: RoleFormValues = {
  key: '',
  display_name: '',
  description: '',
  is_active: true,
}

// 已存在于 UserRole enum 的 key 集合 (仅 UI 用来打"标准 enum"标记)
const ENUM_KEYS = new Set<UserRole>([
  'staff',
  'reviewer',
  'admin',
  'superadmin',
  'root_admin',
])

export default function RolesMetaAdminPage() {
  const { message } = App.useApp()
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<RoleFormValues>()

  const fetchRoles = () => {
    setRolesLoading(true)
    rolesApi
      .list()
      .then((d) => setRoles(d.items))
      .finally(() => setRolesLoading(false))
  }

  useEffect(() => {
    fetchRoles()
  }, [])

  const enterEditMode = (r: RoleRow) => {
    setEditing(r)
    setMode('edit')
    form.setFieldsValue({
      key: r.key,
      display_name: r.display_name,
      description: r.description ?? '',
      is_active: r.is_active,
    })
  }

  const resetForm = () => {
    setEditing(null)
    setMode('create')
    form.resetFields()
    form.setFieldsValue(DEFAULT_FORM_VALUES)
  }

  const submit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      if (mode === 'edit' && editing) {
        const payload: RoleUpdatePayload = {
          display_name: v.display_name,
          description: v.description ?? '',
          is_active: v.is_active,
        }
        await rolesApi.update(editing.id, payload)
        message.success('已保存')
      } else {
        await rolesApi.create({
          key: v.key as UserRole,
          display_name: v.display_name,
          description: v.description ?? '',
          is_active: v.is_active,
        })
        message.success('已创建')
      }
      resetForm()
      fetchRoles()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const submitDelete = async (r: RoleRow) => {
    try {
      await rolesApi.delete(r.id)
      message.success(`已删除 ${r.key}`)
      if (editing?.id === r.id) resetForm()
      fetchRoles()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const roleColumns: TableColumnsType<RoleRow> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '显示名', dataIndex: 'display_name', width: 140 },
    {
      title: 'Key',
      dataIndex: 'key',
      width: 160,
      render: (k: UserRole) =>
        ENUM_KEYS.has(k) ? <Tag>{k}</Tag> : <Tag color="orange">{k} (自定义)</Tag>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (v?: string | null) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (a: boolean) =>
        a ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '内置',
      dataIndex: 'is_builtin',
      width: 80,
      render: (b: boolean) =>
        b ? <Tag color="processing">内置</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_v, row) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => enterEditMode(row)}>
            编辑
          </Button>
          {row.is_builtin ? (
            <Button type="link" size="small" disabled>
              删除
            </Button>
          ) : (
            <Popconfirm
              title={`确认删除 ${row.key}?`}
              description="删除后该角色配置元数据将丢失，已有用户的 role 不会受影响"
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
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>角色管理</Title>
      <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 16 }}>
        管理平台角色元数据（显示名、描述、状态）。Key 是角色的英文标识符，
        创建后不可修改。如需将新建角色分配给用户，需后端同步添加
        UserRole enum 值。内置角色禁用删除（仅 UX 提示）。菜单权限矩阵请前往「权限管理」页面。
      </Paragraph>

      <Card
        title={
          mode === 'edit' && editing
            ? `编辑角色: ${editing.key}`
            : '新增角色'
        }
        style={{ marginBottom: 16 }}
        extra={
          mode === 'edit' ? <Tag color="processing">编辑模式</Tag> : null
        }
      >
        <Form<RoleFormValues> form={form} layout="vertical" initialValues={DEFAULT_FORM_VALUES}>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item
                name="key"
                label={
                  <span>
                    Key
                    <Tooltip
                      title="英文标识符，小写字母开头，仅含字母/数字/下划线，长度 1-32。创建后不可修改。如需分配给用户，需后端同步添加 UserRole enum 值。"
                      placement="top"
                    >
                      <QuestionCircleOutlined style={{ marginLeft: 6, color: '#94A3B8' }} />
                    </Tooltip>
                  </span>
                }
                rules={[
                  { required: true, message: '请输入 key' },
                  {
                    pattern: ROLE_KEY_PATTERN,
                    message: '格式：小写字母开头，仅字母/数字/下划线',
                  },
                ]}
                extra={
                  mode === 'edit'
                    ? '编辑模式下 key 不允许修改'
                    : '若新建 key 不在 UserRole enum 内，列表将标记为"自定义"，分配用户前需后端协同'
                }
              >
                <Input
                  placeholder="custom_role"
                  maxLength={ROLE_KEY_MAX_LENGTH}
                  disabled={mode === 'edit'}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={10}>
              <Form.Item
                name="display_name"
                label="显示名"
                rules={[{ required: true, message: '请输入显示名' }, { max: 64 }]}
              >
                <Input maxLength={64} placeholder="如: 业务员" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6} md={4}>
              <Form.Item name="is_active" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述" rules={[{ max: 255 }]}>
            <Input.TextArea rows={2} maxLength={255} showCount />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button
                type="primary"
                icon={mode === 'create' ? <PlusOutlined /> : undefined}
                loading={saving}
                onClick={submit}
              >
                {mode === 'edit' ? '保存' : '创建'}
              </Button>
              <Button onClick={resetForm}>
                {mode === 'edit' ? '取消编辑' : '重置'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Table<RoleRow>
        rowKey="id"
        loading={rolesLoading}
        dataSource={roles}
        columns={roleColumns}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </div>
  )
}
