import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  Upload,
  type TableColumnsType,
  type UploadFile,
} from 'antd'
import { InboxOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { imagesetsApi } from '@/api/imagesets'
import {
  IMAGE_ACTION_OPTIONS,
  IMAGE_GROUP_OPTIONS,
  type ImageSet,
  type ImageSetAction,
  type ImageSetGroup,
  type ImageSetItem,
  type ImageSetListItem,
} from '@/types/domain'

const { Dragger } = Upload
const { Title, Text } = Typography

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg,.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
}
const ACCEPT = Object.values(ALLOWED_MIME).join(',')
const MAX_PER_UPLOAD = 100
const MAX_FILE_SIZE = 10 * 1024 * 1024
const DEFAULT_CAPACITY = 5000

const ACTION_TABS: { key: ImageSetAction; label: string }[] = [
  { key: '黑名单', label: '黑名单' },
  { key: '白名单', label: '白名单' },
  { key: '需复审', label: '需复审' },
  { key: '标签', label: '标签' },
]

const ACTION_COLOR: Record<ImageSetAction, string> = {
  黑名单: 'red',
  白名单: 'green',
  需复审: 'orange',
  标签: 'blue',
}

interface CreateValues {
  name: string
  group: ImageSetGroup
  action: ImageSetAction
  description?: string
}

export default function CustomImagesPage() {
  const { message } = App.useApp()

  const [action, setAction] = useState<ImageSetAction>('黑名单')
  const [group, setGroup] = useState<ImageSetGroup | undefined>(undefined)
  const [items, setItems] = useState<ImageSetListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editTarget, setEditTarget] = useState<ImageSet | null>(null)
  const [editing, setEditing] = useState(false)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [form] = Form.useForm<CreateValues>()
  const [editForm] = Form.useForm<CreateValues>()

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await imagesetsApi.list({
        action,
        group,
        q: q || undefined,
        size: 50,
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
  }, [action, group])

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ group: '关键词', action })
    setUploadedCount(0)
    setDrawerOpen(true)
  }

  const onCreate = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    if (uploadedCount === 0) {
      message.warning('请先上传至少 1 张图片')
      return
    }
    setCreating(true)
    try {
      await imagesetsApi.create({
        name: v.name.trim(),
        group: v.group,
        action: v.action,
        description: v.description?.trim() || undefined,
      })
      message.success('已创建数据集')
      setDrawerOpen(false)
      form.resetFields()
      setUploadedCount(0)
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = async (row: ImageSetListItem) => {
    const full = await imagesetsApi.get(row.id)
    setEditTarget(full)
    editForm.setFieldsValue({
      name: full.name,
      group: full.group,
      action: full.action,
      description: full.description ?? undefined,
    })
  }

  const onSaveEdit = async () => {
    if (!editTarget) return
    const v = await editForm.validateFields().catch(() => null)
    if (!v) return
    setEditing(true)
    try {
      await imagesetsApi.update(editTarget.id, {
        name: v.name.trim(),
        group: v.group,
        action: v.action,
        description: v.description?.trim() || undefined,
      })
      message.success('已保存')
      setEditTarget(null)
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setEditing(false)
    }
  }

  const onDelete = async (row: ImageSetListItem) => {
    try {
      await imagesetsApi.remove(row.id)
      message.success('已删除')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const columns: TableColumnsType<ImageSetListItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: '8%',
      render: (v: number) => <span style={{ color: '#020617' }}>{v}</span>,
    },
    {
      title: '数据集名称',
      dataIndex: 'name',
      width: '22%',
      render: (v: string, row) => (
        <a onClick={() => openEdit(row)} style={{ color: '#0369A1' }}>
          {v}
        </a>
      ),
    },
    {
      title: '分组',
      dataIndex: 'group',
      width: '12%',
      render: (v: ImageSetGroup) => (
        <span style={{ color: '#020617' }}>{v}</span>
      ),
    },
    {
      title: '处置',
      dataIndex: 'action',
      width: '10%',
      render: (v: ImageSetAction) => (
        <span style={{ color: ACTION_COLOR[v] === 'default' ? '#020617' : undefined }}>
          {v}
        </span>
      ),
    },
    {
      title: '图片数量',
      width: '10%',
      render: (_v, row) => (
        <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>
          {row.item_count} / {row.capacity}
        </span>
      ),
    },
    {
      title: '最近修改',
      width: '18%',
      render: (_v, row) => {
        const t = row.updated_at ?? row.created_at
        return (
          <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(t).format('YYYY.MM.DD HH:mm')}
          </span>
        )
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '12%',
      render: (v: string) => (
        <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>
          {dayjs(v).format('YYYY.MM.DD')}
        </span>
      ),
    },
    {
      title: '操作',
      width: '8%',
      render: (_v, row) => (
        <Space size={12}>
          <a onClick={() => openEdit(row)} style={{ color: '#0369A1' }}>
            编辑
          </a>
          <Popconfirm title="确认删除该数据集?" onConfirm={() => onDelete(row)}>
            <a style={{ color: '#DC2626' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title level={3} style={{ marginTop: 0, marginBottom: 16 }}>
        自定义图片
      </Title>

      <Tabs
        activeKey={action}
        onChange={(k) => {
          setAction(k as ImageSetAction)
          setGroup(undefined)
        }}
        items={ACTION_TABS}
      />

      <Tabs
        type="card"
        size="small"
        activeKey={group ?? '__all'}
        onChange={(k) => setGroup(k === '__all' ? undefined : (k as ImageSetGroup))}
        items={[
          { key: '__all', label: '全部' },
          ...IMAGE_GROUP_OPTIONS.map((g) => ({ key: g.value, label: g.label })),
        ]}
        style={{ marginBottom: 16 }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space size={8} align="center" wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建数据集
          </Button>
          <Text type="secondary">
            您可以在策略配置时选择对应
            <Text strong style={{ margin: '0 4px' }}>{action}</Text>
            图片数据集
            {group && (
              <>
                （<Text strong>{group}</Text>）
              </>
            )}
            ，对命中内容进行处置
          </Text>
        </Space>
        <Input
          allowClear
          placeholder="请输入数据集名称"
          prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
          style={{ width: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={fetch}
        />
      </div>

      <Table<ImageSetListItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty description="当前暂无数据" /> }}
        scroll={{ x: true }}
      />

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        共 {total} 条数据集
      </Text>

      <CreateDrawer
        open={drawerOpen}
        action={action}
        form={form}
        creating={creating}
        uploadedCount={uploadedCount}
        onUploadedChange={setUploadedCount}
        onCancel={() => setDrawerOpen(false)}
        onSubmit={onCreate}
      />

      <Modal
        title="编辑数据集"
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        onOk={onSaveEdit}
        confirmLoading={editing}
        width="clamp(360px, 90vw, 560px)"
        okText="保存"
      >
        {editTarget && (
          <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              label="数据集名称"
              name="name"
              rules={[
                { required: true, message: '请输入数据集名称' },
                { max: 20, message: '不超过 20 个字符' },
              ]}
            >
              <Input showCount maxLength={20} />
            </Form.Item>
            <Form.Item label="业务分组" name="group" rules={[{ required: true }]}>
              <Select options={IMAGE_GROUP_OPTIONS} />
            </Form.Item>
            <Form.Item label="处置行为" name="action" rules={[{ required: true }]}>
              <Select options={IMAGE_ACTION_OPTIONS} />
            </Form.Item>
            <Form.Item label="描述" name="description">
              <Input.TextArea rows={2} maxLength={200} />
            </Form.Item>
            <ItemManager setId={editTarget.id} capacity={editTarget.capacity} />
          </Form>
        )}
      </Modal>
    </div>
  )
}

function CreateDrawer({
  open,
  action,
  form,
  creating,
  uploadedCount,
  onUploadedChange,
  onCancel,
  onSubmit,
}: {
  open: boolean
  action: ImageSetAction
  form: ReturnType<typeof Form.useForm<CreateValues>>[0]
  creating: boolean
  uploadedCount: number
  onUploadedChange: (n: number) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { message } = App.useApp()
  const [fileList, setFileList] = useState<UploadFile[]>([])

  const handleBeforeUpload = (file: File, files: File[]) => {
    const all = files.length ? files : [file]
    if (all.length > MAX_PER_UPLOAD) {
      message.error(`单次最多上传 ${MAX_PER_UPLOAD} 张图片`)
      return Upload.LIST_IGNORE
    }
    for (const f of all) {
      if (f.size > MAX_FILE_SIZE) {
        message.error(`${f.name} 超过单文件 10MB 限制`)
        return Upload.LIST_IGNORE
      }
    }
    onUploadedChange(all.length)
    return false
  }

  return (
    <Drawer
      title={`新增自定义图像 - ${action}`}
      open={open}
      onClose={onCancel}
      width="clamp(360px, 90vw, 520px)"
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>关闭</Button>
          <Button type="primary" loading={creating} onClick={onSubmit}>
            保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="温馨提示：首次使用图像自定义库时，需要5分钟的建库时间，这期间可能导致您上传图像失败。请放心后续使用该情况不会再现"
      />
      <Form form={form} layout="vertical" initialValues={{ group: '关键词', action }}>
        <Form.Item
          label="数据集名称"
          name="name"
          rules={[
            { required: true, message: '请输入数据集名称' },
            { max: 20, message: '不超过 20 个字符' },
          ]}
        >
          <Input placeholder="请输入数据集名称" showCount maxLength={20} />
        </Form.Item>
        <Form.Item label="业务分组" name="group" rules={[{ required: true }]}>
          <Select options={IMAGE_GROUP_OPTIONS} />
        </Form.Item>
        <Form.Item label="处置行为" name="action" rules={[{ required: true }]}>
          <Select options={IMAGE_ACTION_OPTIONS} />
        </Form.Item>
        <Form.Item
          label="图片上传"
          required
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              支持批量上传，单次最大上传数为{MAX_PER_UPLOAD}张，上传格式为jpg, png, webp，默认库容量为{DEFAULT_CAPACITY}张。
            </Text>
          }
        >
          <Dragger
            multiple
            accept={ACCEPT}
            beforeUpload={handleBeforeUpload as never}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl.slice(0, MAX_PER_UPLOAD))}
            showUploadList
            listType="picture"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽图片到此处</p>
            <p className="ant-upload-hint" style={{ fontSize: 12 }}>
              支持单次或批量上传，当前已选 {uploadedCount} 张
            </p>
          </Dragger>
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={2} maxLength={200} placeholder="选填，用途说明" />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

function ItemManager({ setId, capacity }: { setId: number; capacity: number }) {
  const { message } = App.useApp()
  const [items, setItems] = useState<ImageSetItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])

  const fetch = async () => {
    setLoading(true)
    try {
      const d = await imagesetsApi.listItems(setId, 1, 100)
      setItems(d.items)
      setTotal(d.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId])

  const handleUpload = async (file: File, files: File[]) => {
    const all = files.length ? files : [file]
    if (total + all.length > capacity) {
      message.error(`超过库容量 ${capacity}`)
      return Upload.LIST_IGNORE
    }
    setUploading(true)
    try {
      const res = await imagesetsApi.uploadItems(setId, all)
      message.success(`已上传 ${res.uploaded} 张，跳过 ${res.skipped} 张`)
      setFileList([])
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '上传失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  const onRemove = async (itemId: number) => {
    try {
      await imagesetsApi.removeItem(setId, itemId)
      message.success('已删除')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary">
          库内图片 {total} / {capacity}
        </Text>
      </div>
      <Upload.Dragger
        multiple
        accept={ACCEPT}
        beforeUpload={handleUpload as never}
        fileList={fileList}
        onChange={({ fileList: fl }) => setFileList(fl)}
        disabled={uploading}
        showUploadList={false}
        style={{ marginBottom: 12 }}
      >
        <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
          <InboxOutlined />
        </p>
        <p className="ant-upload-text" style={{ fontSize: 13 }}>
          {uploading ? '上传中…' : '点击或拖拽以追加图片'}
        </p>
      </Upload.Dragger>
      <Table<ImageSetItem>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        scroll={{ y: 240 }}
        columns={[
          {
            title: '缩略图',
            width: 64,
            render: (_, row) =>
              row.download_url ? (
                <img
                  src={row.download_url}
                  alt={row.original_filename}
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                />
              ) : (
                <span style={{ color: '#94A3B8' }}>—</span>
              ),
          },
          { title: '文件名', dataIndex: 'original_filename', ellipsis: true },
          {
            title: '大小',
            dataIndex: 'file_size',
            width: 90,
            render: (v: number) => (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(v / 1024).toFixed(1)} KB
              </span>
            ),
          },
          {
            title: '操作',
            width: 60,
            render: (_, row) => (
              <a style={{ color: '#DC2626' }} onClick={() => onRemove(row.id)}>
                删除
              </a>
            ),
          },
        ]}
      />
    </div>
  )
}
