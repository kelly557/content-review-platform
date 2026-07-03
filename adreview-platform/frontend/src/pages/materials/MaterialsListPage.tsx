import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Card,
  Form,
  Modal,
  App,
  type TableColumnsType,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { materialsApi } from '@/api/materials'
import { useAuthStore } from '@/store'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  type MaterialListItem,
  type MaterialStatus,
  type MaterialType,
} from '@/types/domain'

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))

export default function MaterialsListPage() {
  const { message } = App.useApp()

  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [items, setItems] = useState<MaterialListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [filters, setFilters] = useState<{ q?: string; status?: MaterialStatus; type?: MaterialType }>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm<{ title: string; material_type: MaterialType; description?: string }>()

  const isSubmitter = user?.role === 'submitter' || user?.role === 'admin'

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await materialsApi.list({
        page,
        size,
        q: filters.q,
        status: filters.status,
        ...(filters.type ? { material_type: filters.type } : {}),
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size])

  const columns: TableColumnsType<MaterialListItem> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    {
      title: '标题',
      dataIndex: 'title',
      render: (text: string, record) => (
        <a onClick={() => navigate(`/materials/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '类型',
      dataIndex: 'material_type',
      width: 100,
      render: (v: MaterialType) => <Tag>{TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: MaterialStatus) => <Tag color={STATUS_COLORS[v]}>{STATUS_LABELS[v]}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/materials/${record.id}`)}>
            查看
          </Button>
          {isSubmitter && (
            <Button
              type="link"
              size="small"
              disabled={!['draft', 'rejected'].includes(record.status)}
              onClick={() => navigate(`/tasks/new?material=${record.id}&type=${record.material_type}`)}
            >
              提交
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="素材库"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetch}>刷新</Button>
          {isSubmitter && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建素材
            </Button>
          )}
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          allowClear
          placeholder="搜索标题或描述"
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          onPressEnter={(e) => {
            setFilters((f) => ({ ...f, q: (e.target as HTMLInputElement).value }))
            setPage(1)
            setTimeout(fetch, 0)
          }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={STATUS_OPTIONS}
          onChange={(v) => {
            setFilters((f) => ({ ...f, status: v }))
            setPage(1)
            setTimeout(fetch, 0)
          }}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          options={TYPE_OPTIONS}
          onChange={(v) => {
            setFilters((f) => ({ ...f, type: v }))
            setPage(1)
            setTimeout(fetch, 0)
          }}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          onChange: (p, s) => { setPage(p); setSize(s) },
        }}
      />

      <Modal
        title="新建素材"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          const values = await createForm.validateFields()
          const created = await materialsApi.create({
            title: values.title,
            material_type: values.material_type,
            description: values.description,
          })
          message.success('已创建')
          setCreateOpen(false)
          createForm.resetFields()
          navigate(`/materials/${created.id}`)
        }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：618 大促主视觉海报" />
          </Form.Item>
          <Form.Item label="类型" name="material_type" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
