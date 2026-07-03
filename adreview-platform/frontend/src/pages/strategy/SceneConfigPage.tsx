import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Tag,
  App,
  type TableColumnsType,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { serviceCategoriesApi } from '@/api/serviceCategories'
import type { ServiceCategory } from '@/types/domain'

const { Title, Text } = Typography

export default function SceneConfigPage() {
  const { message, modal } = App.useApp()
  const [items, setItems] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ServiceCategory | null>(null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await serviceCategoriesApi.list({ size: 200 })
      setItems(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
  }, [])

  const openCreate = () => {
    setEditingItem(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (cat: ServiceCategory) => {
    setEditingItem(cat)
    form.setFieldsValue({
      name: cat.name,
      description: cat.description,
      sort_order: cat.sort_order,
      is_active: cat.is_active,
    })
    setModalOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSubmitting(true)
    try {
      if (editingItem) {
        await serviceCategoriesApi.update(editingItem.id, {
          name: values.name,
          description: values.description,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
        })
        message.success('已更新')
      } else {
        await serviceCategoriesApi.create({
          name: values.name,
          description: values.description,
          sort_order: values.sort_order ?? 0,
        })
        message.success('已创建')
      }
      setModalOpen(false)
      await fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = (cat: ServiceCategory) => {
    modal.confirm({
      title: `确认删除分类「${cat.name}」？`,
      content: cat.is_system ? '系统分类不可删除' : '删除后不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      okButtonProps: { disabled: cat.is_system },
      onOk: async () => {
        try {
          await serviceCategoriesApi.delete(cat.id)
          message.success('已删除')
          await fetch()
        } catch (e: unknown) {
          const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          message.error(detail ?? '删除失败')
        }
      },
    })
  }

  const columns: TableColumnsType<ServiceCategory> = [
    {
      title: '分类名称',
      dataIndex: 'name',
      width: '25%',
      render: (v: string, row) => (
        <Space>
          <span style={{ fontWeight: 500 }}>{v}</span>
          {row.is_system && <Tag color="blue">系统</Tag>}
        </Space>
      ),
    },
    {
      title: '编码',
      dataIndex: 'code',
      width: '18%',
      render: (v: string) => (
        <Text type="secondary" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: '25%',
      render: (v: string | null) => <span>{v ?? '—'}</span>,
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: '10%',
      sorter: (a, b) => a.sort_order - b.sort_order,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: '10%',
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: '12%',
      render: (_v, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(row)}
          >
            编辑
          </Button>
          {!row.is_system && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(row)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          场景分类管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增分类
        </Button>
      </div>

      <Table<ServiceCategory>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
      />

      <Modal
        open={modalOpen}
        title={editingItem ? '编辑分类' : '新增分类'}
        onCancel={() => setModalOpen(false)}
        onOk={onSubmit}
        confirmLoading={submitting}
        okText={editingItem ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ sort_order: 0, is_active: true }}>
          <Form.Item
            name="name"
            label="分类名称"
            rules={[{ required: true, message: '请输入分类名称' }]}
          >
            <Input placeholder="如：电商场景" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="分类描述（可选）" rows={2} maxLength={200} />
          </Form.Item>
          <Form.Item name="sort_order" label="排序权重">
            <InputNumber min={0} max={999} style={{ width: '100%' }} />
          </Form.Item>
          {editingItem && (
            <Form.Item name="is_active" label="启用状态" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
