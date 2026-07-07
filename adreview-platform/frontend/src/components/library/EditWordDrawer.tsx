import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Grid,
  Input,
  Radio,
  Space,
  Typography,
  Upload,
  type UploadProps,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'

const { Text } = Typography
const { Dragger } = Upload

const MAX_WORDS = 1000
const MAX_FILE_BYTES = 10 * 1024 * 1024

interface Props {
  open: boolean
  library: Library | null
  onCancel: () => void
  onSuccess: () => void
}

export default function EditWordDrawer({ open, library, onCancel, onSuccess }: Props) {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const drawerWidth = screens.md ? 480 : '100%'

  const [mode, setMode] = useState<'batch' | 'file'>('batch')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setMode('batch')
      setText('')
      setFile(null)
    }
  }, [open])

  const uploadProps: UploadProps = {
    multiple: false,
    maxCount: 1,
    accept: '.txt,text/plain',
    showUploadList: false,
    beforeUpload: (f) => {
      if (f.size > MAX_FILE_BYTES) {
        message.warning(`文件大小超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`)
        return Upload.LIST_IGNORE
      }
      setFile(f)
      return false
    },
    onRemove: () => setFile(null),
  }

  const submit = async () => {
    if (!library) return
    setSubmitting(true)
    try {
      if (mode === 'batch') {
        const words = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
        if (words.length === 0) {
          message.warning('请输入至少一个词')
          return
        }
        if (words.length > MAX_WORDS) {
          message.error(`单次最多 ${MAX_WORDS} 个词`)
          return
        }
        const res = await librariesApi.addItems(library.id, words)
        message.success(`已添加 ${res.items.length} 词`)
      } else {
        if (!file) {
          message.warning('请先选择文件')
          return
        }
        const res = await librariesApi.uploadWordsTxt(library.id, file)
        message.success(`已上传,新增 ${res.added} 词,跳过 ${res.skipped} 重复`)
      }
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const okDisabled =
    submitting ||
    (mode === 'batch' && text.trim().length === 0) ||
    (mode === 'file' && !file)

  return (
    <Drawer
      open={open}
      title="添加词"
      onClose={onCancel}
      width={drawerWidth}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" onClick={submit} loading={submitting} disabled={okDisabled}>
            确定
          </Button>
        </Space>
      }
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ marginBottom: 16, width: '100%' }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Radio value="batch" style={{ width: '100%' }}>
            <Text strong>批量添加词</Text>
          </Radio>
          <Radio value="file" style={{ width: '100%' }}>
            <Text strong>上传文件导入</Text>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'batch' ? (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8 }}>
                <li>
                  支持多个关键词通过与或非逻辑组合成一个关键词。如关键词&quot;微信&amp;兼职&quot;
                  表示只有同时出现以上两个词才会命中,&quot;&amp;&quot;表示与关系,&quot;~&quot;
                  表示非（排除）关系,配置关键词时&quot;&amp;&quot;必须在&quot;~&quot;之前。
                </li>
                <li>每个关键词以换行分隔,单个词不超过 50 字。</li>
                <li>最多 1000 行,如需一次增加超过 1000 行,请使用上传文件导入。</li>
                <li>同一个账号下总共支持添加 10 万个词,最多可创建 20 个词库。</li>
              </ol>
            }
          />
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="请输入,每行一个词,最多1000行。"
            rows={10}
            style={{ resize: 'vertical' }}
          />
        </div>
      ) : (
        <div>
          <Dragger {...uploadProps} style={{ padding: '24px 0' }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">拖拽上传 TXT 文件</p>
            <p className="ant-upload-hint">或</p>
            <Button type="primary" size="small">
              查看本地文件
            </Button>
          </Dragger>
          {file && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: '#F1F5F9',
                borderRadius: 4,
                fontSize: 12,
                color: '#475569',
              }}
            >
              <Space size={8} wrap>
                <Text strong>已选择:</Text>
                <Text>{file.name}</Text>
                <Text type="secondary">({(file.size / 1024).toFixed(1)} KB)</Text>
              </Space>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}