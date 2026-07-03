import { useEffect, useState } from 'react'
import {
  Tabs,
  Table,
  Input,
  Space,
  Typography,
  Button,
  Drawer,
  Form,
  Modal,
  App,
  Popconfirm,
  Select,
  Upload,
  type TableColumnsType,
  type UploadFile,
  type UploadProps,
} from 'antd'
import { PlusOutlined, SearchOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { wordsetsApi } from '@/api/wordsets'
import {
  WORD_ACTION_OPTIONS,
  WORD_GROUP_OPTIONS,
  type WordSet,
  type WordSetAction,
  type WordSetGroup,
} from '@/types/domain'

const { Title, Text } = Typography
const { Dragger } = Upload

const MAX_WORDS = 1000
const MAX_TXT_FILES = 5
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

const readTxtFile = (file: File): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      resolve(
        text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })

interface CreateValues {
  name: string
  group: WordSetGroup
  action: WordSetAction
  description?: string
  wordsText?: string
}

const ACTION_TABS: { key: WordSetAction; label: string }[] = [
  { key: '黑名单', label: '黑名单' },
  { key: '白名单', label: '白名单' },
  { key: '需复审', label: '需复审' },
  { key: '标签', label: '标签' },
]

const ACTION_COLOR: Record<WordSetAction, string> = {
  黑名单: 'red',
  白名单: 'green',
  需复审: 'orange',
  标签: 'blue',
}

export default function CustomTextsPage() {
  const { message } = App.useApp()

  const [action, setAction] = useState<WordSetAction>('黑名单')
  const [group, setGroup] = useState<WordSetGroup | undefined>(undefined)
  const [items, setItems] = useState<WordSet[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editTarget, setEditTarget] = useState<WordSet | null>(null)
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm<CreateValues>()
  const [editForm] = Form.useForm<CreateValues>()
  const [txtFiles, setTxtFiles] = useState<UploadFile[]>([])
  const [editTxtFiles, setEditTxtFiles] = useState<UploadFile[]>([])

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await wordsetsApi.list({
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

  const onCreate = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    const textWords = (v.wordsText ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const fileWords: string[] = []
    for (const f of txtFiles) {
      if (f.originFileObj) {
        const words = await readTxtFile(f.originFileObj)
        fileWords.push(...words)
      }
    }
    const words = [...new Set([...textWords, ...fileWords])]
    if (words.length === 0) {
      message.warning('请至少输入或上传一个词')
      return
    }
    if (words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    setCreating(true)
    try {
      await wordsetsApi.create({
        name: v.name.trim(),
        group: v.group,
        action: v.action,
        words,
        description: v.description?.trim() || undefined,
      })
      message.success('已创建数据集')
      setDrawerOpen(false)
      form.resetFields()
      setTxtFiles([])
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = async (ws: WordSet) => {
    setEditTarget(ws)
    const data = await wordsetsApi.getWords(ws.id)
    editForm.setFieldsValue({
      name: ws.name,
      group: ws.group,
      action: ws.action,
      description: ws.description ?? undefined,
      wordsText: data.items.join('\n'),
    })
  }

  const onSaveEdit = async () => {
    if (!editTarget) return
    const v = await editForm.validateFields().catch(() => null)
    if (!v) return
    const textWords = (v.wordsText ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const fileWords: string[] = []
    for (const f of editTxtFiles) {
      if (f.originFileObj) {
        const words = await readTxtFile(f.originFileObj)
        fileWords.push(...words)
      }
    }
    const words = [...new Set([...textWords, ...fileWords])]
    if (words.length > MAX_WORDS) {
      message.error(`单次最多 ${MAX_WORDS} 个词`)
      return
    }
    setEditing(true)
    try {
      await wordsetsApi.update(editTarget.id, {
        name: v.name.trim(),
        group: v.group,
        action: v.action,
        description: v.description?.trim() || undefined,
        words,
      })
      message.success('已保存')
      setEditTarget(null)
      setEditTxtFiles([])
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setEditing(false)
    }
  }

  const onDelete = async (ws: WordSet) => {
    try {
      await wordsetsApi.remove(ws.id)
      message.success('已删除')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const uploadProps: UploadProps = {
    accept: '.txt',
    multiple: true,
    maxCount: MAX_TXT_FILES,
    fileList: txtFiles,
    beforeUpload: (file) => {
      if (!file.name.toLowerCase().endsWith('.txt')) {
        message.error('仅支持 .txt 文件')
        return Upload.LIST_IGNORE
      }
      if (file.size > MAX_FILE_SIZE) {
        message.error('文件大小不能超过 2MB')
        return Upload.LIST_IGNORE
      }
      return false
    },
    onChange: ({ fileList: fl }) => setTxtFiles(fl),
    onRemove: (file) => {
      setTxtFiles((prev) => prev.filter((f) => f.uid !== file.uid))
    },
  }

  const editUploadProps: UploadProps = {
    accept: '.txt',
    multiple: true,
    maxCount: MAX_TXT_FILES,
    fileList: editTxtFiles,
    beforeUpload: (file) => {
      if (!file.name.toLowerCase().endsWith('.txt')) {
        message.error('仅支持 .txt 文件')
        return Upload.LIST_IGNORE
      }
      if (file.size > MAX_FILE_SIZE) {
        message.error('文件大小不能超过 2MB')
        return Upload.LIST_IGNORE
      }
      return false
    },
    onChange: ({ fileList: fl }) => setEditTxtFiles(fl),
    onRemove: (file) => {
      setEditTxtFiles((prev) => prev.filter((f) => f.uid !== file.uid))
    },
  }

  const columns: TableColumnsType<WordSet> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: '8%',
      render: (v: number) => <span style={{ color: '#020617' }}>{v}</span>,
    },
    {
      title: '数据集名称',
      dataIndex: 'name',
      width: '24%',
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
      render: (v: WordSetGroup) => <Tag2 group={v} />,
    },
    {
      title: '处置',
      dataIndex: 'action',
      width: '10%',
      render: (v: WordSetAction) => (
        <Tag2 group={v} color={ACTION_COLOR[v]} />
      ),
    },
    {
      title: '词数',
      dataIndex: 'word_count',
      width: '8%',
      render: (v: number) => (
        <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
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
        自定义文本
      </Title>

      <Tabs
        activeKey={action}
        onChange={(k) => {
          setAction(k as WordSetAction)
          setGroup(undefined) // 切 action 时清空 group 子 tab
        }}
        items={ACTION_TABS}
      />

      <Tabs
        type="card"
        size="small"
        activeKey={group ?? '__all'}
        onChange={(k) => setGroup(k === '__all' ? undefined : (k as WordSetGroup))}
        items={[
          { key: '__all', label: '全部' },
          ...WORD_GROUP_OPTIONS.map((g) => ({ key: g.value, label: g.label })),
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
            创建数据集
          </Button>
          <Text type="secondary">
            您可以在策略配置时选择对应
            <Text strong style={{ margin: '0 4px' }}>{action}</Text>
            数据集
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

      <Table<WordSet>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        scroll={{ x: true }}
      />

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        共 {total} 条数据集
      </Text>

      <Drawer
        title={`新增自定义文本 - ${action}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width="clamp(320px, 90vw, 520px)"
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={creating} onClick={onCreate}>
              确定
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ group: '关键词', action }}
          requiredMark
        >
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
            <Select options={WORD_GROUP_OPTIONS} />
          </Form.Item>
          <Form.Item label="处置行为" name="action" rules={[{ required: true }]}>
            <Select options={WORD_ACTION_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="词条"
            name="wordsText"
            extra={`手动输入或上传 .txt 文件，一行一词，总计不超过 ${MAX_WORDS} 个词`}
          >
            <Input.TextArea
              placeholder="请输入词条，可使用回车连续输入"
              rows={6}
            />
          </Form.Item>
          <Form.Item label="批量上传">
            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽 .txt 文件到此处</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                支持最多 {MAX_TXT_FILES} 个文件，单文件不超过 2MB
              </p>
            </Dragger>
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea placeholder="选填，用途说明" rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title="编辑数据集"
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        onOk={onSaveEdit}
        confirmLoading={editing}
        width="clamp(320px, 90vw, 560px)"
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
              <Select options={WORD_GROUP_OPTIONS} />
            </Form.Item>
            <Form.Item label="处置行为" name="action" rules={[{ required: true }]}>
              <Select options={WORD_ACTION_OPTIONS} />
            </Form.Item>
            <Form.Item label="描述" name="description">
              <Input.TextArea rows={2} maxLength={200} />
            </Form.Item>
            <Form.Item label="词条" name="wordsText">
              <Input.TextArea rows={10} placeholder="一行一词" />
            </Form.Item>
            <Form.Item label="批量上传">
              <Dragger {...editUploadProps}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽 .txt 文件到此处</p>
                <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                  支持最多 {MAX_TXT_FILES} 个文件，单文件不超过 2MB
                </p>
              </Dragger>
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}

function Tag2({ group }: { group: string; color?: string }) {
  return <span style={{ color: '#020617' }}>{group}</span>
}
