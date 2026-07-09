import { useEffect, useState, useCallback } from 'react'
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  type TableColumnsType,
} from 'antd'
import { webhookAllowlistApi, type WebhookAllowlistEntry } from '@/api/triggers'

interface FormValues {
  cidr: string
  label?: string
  note?: string
  is_enabled: boolean
}

export default function WebhookAllowlistPage() {
  const { message } = App.useApp()
  const [items, setItems] = useState<WebhookAllowlistEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<WebhookAllowlistEntry | null>(null)
  const [form] = Form.useForm<FormValues>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await webhookAllowlistApi.list({ size: 100 })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      message.error('加载失败')
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
    form.setFieldsValue({ is_enabled: true })
    setModalOpen(true)
  }

  const openEdit = (record: WebhookAllowlistEntry) => {
    setEditing(record)
    form.setFieldsValue({
      cidr: record.cidr,
      label: record.label ?? undefined,
      note: record.note ?? undefined,
      is_enabled: record.is_enabled,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editing) {
        await webhookAllowlistApi.update(editing.id, values)
        message.success('已更新')
      } else {
        await webhookAllowlistApi.create(values)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      if (err.response?.data?.detail) message.error(err.response.data.detail)
    }
  }

  const handleDelete = (record: WebhookAllowlistEntry) => {
    Modal.confirm({
      title: '删除 IP',
      content: `确认删除 CIDR「${record.cidr}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await webhookAllowlistApi.remove(record.id)
          message.success('已删除')
          load()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } } }
          message.error(err.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  const handleToggle = async (record: WebhookAllowlistEntry, next: boolean) => {
    try {
      await webhookAllowlistApi.update(record.id, { is_enabled: next })
      message.success(next ? '已启用' : '已禁用')
      load()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail || '操作失败')
    }
  }

  const columns: TableColumnsType<WebhookAllowlistEntry> = [
    { title: 'CIDR', dataIndex: 'cidr', width: 200 },
    { title: '标签', dataIndex: 'label', width: 160, ellipsis: true, render: (v) => v ?? '-' },
    { title: '备注', dataIndex: 'note', ellipsis: true, render: (v) => v ?? '-' },
    {
      title: '启用',
      key: 'enabled',
      width: 80,
      render: (_, r) => (
        <Switch size="small" checked={r.is_enabled} onChange={(v) => handleToggle(r, v)} />
      ),
    },
    { title: '创建人', dataIndex: 'created_by', width: 100, render: (v) => v ?? '-' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => handleDelete(r)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>Webhook IP 白名单</div>
        <Space>
          <Button onClick={load}>刷新</Button>
          <Button type="primary" onClick={openCreate}>
            新增 IP
          </Button>
        </Space>
      </div>

      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: '#FFF7E6',
          border: '1px solid #FFD591',
          borderRadius: 6,
        }}
      >
        <Space>
          <Tag color="orange">注意</Tag>
          <span style={{ fontSize: 13 }}>
            启用白名单后，不在列表中的 IP 访问 webhook 将被拒绝（403）。白名单为空时默认拒绝所有请求。
          </span>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize: 50, total, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="暂无白名单" /> }}
      />

      <Modal
        title={editing ? '编辑 IP' : '新增 IP'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="确认"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="CIDR"
            name="cidr"
            rules={[
              { required: true, message: '请输入 CIDR' },
              {
                pattern: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/,
                message: 'CIDR 格式不正确',
              },
            ]}
            extra="IPv4: 10.0.0.0/8 ；IPv6: ::1/128"
          >
            <Input placeholder="10.0.0.0/24" />
          </Form.Item>
          <Form.Item label="标签" name="label">
            <Input placeholder="内部测试网段" maxLength={128} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item label="启用" name="is_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}