import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload,
  type UploadFile,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { knowledgeApi } from '@/api/knowledge'
import { tagsApi } from '@/api/tags'
import {
  KNOWLEDGE_SCOPE_OPTIONS,
  TAG_DOMAIN_OPTIONS,
  type KnowledgeDocumentDetail,
  type KnowledgeScope,
  type TagDomain,
  type TagSummary,
} from '@/types/domain'

const { Dragger } = Upload
const { Text } = Typography

const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  '.pdf',
  '.txt',
  '.md',
]

interface Props {
  open: boolean
  onClose: () => void
  onUploaded: (doc: KnowledgeDocumentDetail) => void
}

interface DraftValues {
  title: string
  domain?: TagDomain
  scope?: KnowledgeScope
  tagIds: string[]
  targetServiceCode?: string
}

export default function DocumentUploadDrawer({ open, onClose, onUploaded }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<DraftValues>()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [availableTags, setAvailableTags] = useState<TagSummary[]>([])
  const [domainFilter, setDomainFilter] = useState<TagDomain | undefined>()

  useEffect(() => {
    if (!open) {
      form.resetFields()
      setFile(null)
      setProgress(0)
      setUploading(false)
    }
  }, [open, form])

  useEffect(() => {
    if (!open) return
    tagsApi
      .list({ size: 100, domain: domainFilter })
      .then((res) => setAvailableTags(res.items))
      .catch(() => setAvailableTags([]))
  }, [open, domainFilter])

  const handleSubmit = async () => {
    if (!file) {
      message.warning('请选择文件')
      return
    }
    try {
      const values = await form.validateFields()
      setUploading(true)
      setProgress(15)
      const ticker = setInterval(() => setProgress((p) => Math.min(p + 12, 85)), 220)
      const doc = await knowledgeApi.upload({
        title: values.title.trim() || file.name,
        domain: values.domain!,
        scope: values.scope!,
        tagIds: values.tagIds ?? [],
        targetServiceCode: values.targetServiceCode?.trim() || undefined,
        file,
      })
      clearInterval(ticker)
      setProgress(100)
      message.success('上传成功，正在后台抽取（若已配置 MaaS）')
      onUploaded(doc)
    } catch (e: any) {
      if (e?.errorFields) {
        message.error('请检查表单')
      } else if (e?.response?.data?.detail) {
        message.error(e.response.data.detail)
      } else if (e?.message) {
        message.error(e.message)
      }
    } finally {
      setUploading(false)
      setTimeout(() => setProgress(0), 600)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="上传知识库文档"
      width={520}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={uploading} onClick={handleSubmit}>
            上传
          </Button>
        </Space>
      }
    >
      <Form<DraftValues> form={form} layout="vertical" colon={false}>
        <Form.Item
          label="标题"
          name="title"
          rules={[{ required: true, message: '请输入文档标题' }]}
        >
          <Input placeholder="例如：广告法（节选）" />
        </Form.Item>

        <Form.Item
          label="知识领域"
          name="domain"
          rules={[{ required: true, message: '请选择领域' }]}
        >
          <Select
            placeholder="选择标签所属领域"
            options={TAG_DOMAIN_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
            onChange={(v: TagDomain) => {
              setDomainFilter(v)
              form.setFieldValue('tagIds', [])
            }}
          />
        </Form.Item>

        <Form.Item
          label="文档类型"
          name="scope"
          rules={[{ required: true, message: '请选择文档类型' }]}
        >
          <Select
            placeholder="选择文档类型"
            options={KNOWLEDGE_SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Form.Item>

        <Form.Item label="关联标签" name="tagIds">
          <Select
            mode="multiple"
            placeholder="选择已存在的标签（可选）"
            options={availableTags.map((t) => ({ value: t.id, label: t.name }))}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item label="归属 Service 编码" name="targetServiceCode" tooltip="留空则生成 knowledge_<domain>_<scope>">
          <Input placeholder="可选，例如 knowledge_ads_law_v1" />
        </Form.Item>

        <Form.Item label="文档" required>
          <Dragger
            multiple={false}
            beforeUpload={(f) => {
              setFile(f as unknown as File)
              return false
            }}
            fileList={
              file
                ? ([{ uid: '1', name: file.name, status: 'done' }] as UploadFile[])
                : []
            }
            onRemove={() => setFile(null)}
            accept={ACCEPTED_MIME.join(',')}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 PDF / TXT / Markdown 文件至此</p>
            <p className="ant-upload-hint">支持 .pdf / .txt / .md，单文件最大 512MB</p>
          </Dragger>
          {file && (
            <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
              已选择：{file.name}（{(file.size / 1024).toFixed(1)} KB）
            </Text>
          )}
        </Form.Item>

        {uploading && progress > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">上传中…</Text>
            <div
              style={{
                height: 4,
                background: '#e5e7eb',
                borderRadius: 2,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#0F172A',
                  borderRadius: 2,
                  transition: 'width 200ms',
                }}
              />
            </div>
          </div>
        )}
      </Form>
    </Drawer>
  )
}