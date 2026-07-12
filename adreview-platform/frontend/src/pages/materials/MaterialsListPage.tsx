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
  Drawer,
  Upload,
  Progress,
  List,
  Typography,
  Alert,
  type TableColumnsType,
  type UploadProps,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { materialsApi, type BatchUploadResponse } from '@/api/materials'
import { useAuthStore } from '@/store'
import { canCreateTask } from '@/lib/permissions'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  type MaterialListItem,
  type MaterialStatus,
  type MaterialType,
} from '@/types/domain'

const { Dragger } = Upload
const { Text } = Typography

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))
const MAX_BATCH_FILES = 20
const ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.pdf,.txt,.md,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,application/pdf,text/plain'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

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

  // Batch upload state
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchFiles, setBatchFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [batchResult, setBatchResult] = useState<BatchUploadResponse | null>(null)

  const isSubmitter = canCreateTask(user)

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

  const draggerProps: UploadProps = {
    multiple: true,
    accept: ACCEPT,
    showUploadList: false,
    beforeUpload: (file, fileList) => {
      const incoming = fileList ?? [file]
      setBatchFiles((prev) => {
        const all = [...prev]
        incoming.forEach((f) => {
          if (all.length >= MAX_BATCH_FILES) return
          if (!all.some((x) => x.name === f.name && x.size === f.size)) {
            all.push(f as File)
          }
        })
        return all.slice(0, MAX_BATCH_FILES)
      })
      return false
    },
  }

  const removeFile = (idx: number) => {
    setBatchFiles((arr) => arr.filter((_, i) => i !== idx))
  }

  const clearAll = () => {
    setBatchFiles([])
    setBatchResult(null)
    setProgress(0)
  }

  const closeBatch = () => {
    if (uploading) return
    setBatchOpen(false)
    setTimeout(clearAll, 200)
  }

  const startBatch = async () => {
    if (batchFiles.length === 0) {
      message.warning('请先添加文件')
      return
    }
    setUploading(true)
    setProgress(0)
    setBatchResult(null)
    try {
      const res = await materialsApi.batchUpload(batchFiles, setProgress)
      setBatchResult(res)
      if (res.succeeded > 0) {
        message.success(`已创建 ${res.succeeded} 个素材${res.failed > 0 ? `，${res.failed} 个失败` : ''}`)
        fetch()
      } else {
        message.error('全部上传失败，请检查文件类型或大小')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败'
      message.error(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card
      title="素材库"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetch}>刷新</Button>
          {isSubmitter && (
            <>
              <Button icon={<CloudUploadOutlined />} onClick={() => setBatchOpen(true)}>
                批量上传
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                新建素材
              </Button>
            </>
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

      <Drawer
        title="批量上传素材"
        width={560}
        open={batchOpen}
        onClose={closeBatch}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={clearAll} disabled={uploading || batchFiles.length === 0}>
              清空
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={startBatch}
              disabled={uploading || batchFiles.length === 0}
            >
              {uploading ? `上传中 ${progress}%` : `开始上传 (${batchFiles.length})`}
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`支持拖入图片/视频/PDF/文本，单批最多 ${MAX_BATCH_FILES} 个文件，单个不超过 512 MB`}
        />

        {!batchResult && (
          <Dragger {...draggerProps} disabled={uploading || batchFiles.length >= MAX_BATCH_FILES}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域</p>
            <p className="ant-upload-hint">
              支持单次选择多个不同类型文件，每个文件将作为独立素材入库
            </p>
          </Dragger>
        )}

        {uploading && (
          <Progress percent={progress} status="active" style={{ marginTop: 16 }} />
        )}

        {batchFiles.length > 0 && !uploading && !batchResult && (
          <List
            size="small"
            style={{ marginTop: 16 }}
            header={<Text type="secondary">待上传 ({batchFiles.length}/{MAX_BATCH_FILES})</Text>}
            dataSource={batchFiles}
            renderItem={(f, idx) => (
              <List.Item
                actions={[
                  <Button
                    key="rm"
                    type="link"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeFile(idx)}
                  >
                    移除
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Text style={{ fontSize: 13 }} ellipsis>
                      {f.name}
                    </Text>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatBytes(f.size)} · {f.type || 'unknown'}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}

        {batchResult && (
          <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="middle">
            <Alert
              type={batchResult.failed === 0 ? 'success' : batchResult.succeeded === 0 ? 'error' : 'warning'}
              showIcon
              message={
                <Text strong>
                  成功 {batchResult.succeeded} / 失败 {batchResult.failed} / 共 {batchResult.total}
                </Text>
              }
              description={
                batchResult.succeeded > 0
                  ? '新素材已自动加入素材库'
                  : '所有文件均未通过校验'
              }
            />

            <List
              size="small"
              header={<Text type="secondary">详细结果</Text>}
              dataSource={batchResult.items}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={
                      item.ok ? (
                        <CheckCircleFilled style={{ color: '#16A34A' }} />
                      ) : (
                        <CloseCircleFilled style={{ color: '#DC2626' }} />
                      )
                    }
                    title={
                      <Text style={{ fontSize: 13 }}>
                        {item.filename || `file-${item.index + 1}`}
                      </Text>
                    }
                    description={
                      item.ok ? (
                        <Space size={4}>
                          <Tag color="blue">{TYPE_LABELS[item.material?.material_type as MaterialType]}</Tag>
                          <a
                            style={{ fontSize: 12 }}
                            onClick={() => {
                              if (item.material) navigate(`/materials/${item.material.id}`)
                            }}
                          >
                            查看
                          </a>
                        </Space>
                      ) : (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {item.error}
                        </Text>
                      )
                    }
                  />
                </List.Item>
              )}
            />

            <Space>
              <Button onClick={clearAll}>再传一批</Button>
              <Button type="primary" onClick={closeBatch}>
                完成
              </Button>
            </Space>
          </Space>
        )}
      </Drawer>
    </Card>
  )
}
