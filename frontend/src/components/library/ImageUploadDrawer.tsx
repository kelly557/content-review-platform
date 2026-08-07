import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Grid,
  Space,
  Typography,
  Upload,
  type UploadFile,
  type UploadProps,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'

const { Text } = Typography
const { Dragger } = Upload

const MAX_FILES = 100
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

interface Props {
  open: boolean
  library: Library | null
  onCancel: () => void
  onSuccess: () => void
}

export default function ImageUploadDrawer({ open, library, onCancel, onSuccess }: Props) {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const drawerWidth = screens.md ? 520 : '100%'

  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setFileList([])
    }
  }, [open])

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (fileList.length >= MAX_FILES) {
      message.warning(`单次最多上传 ${MAX_FILES} 张`)
      return Upload.LIST_IGNORE
    }
    if (file.size > MAX_FILE_BYTES) {
      message.warning(`${file.name} 超过 10MB,已跳过`)
      return Upload.LIST_IGNORE
    }
    if (file.type && !ALLOWED_MIME.includes(file.type)) {
      message.warning(`${file.name} 类型不支持,已跳过`)
      return Upload.LIST_IGNORE
    }
    return false
  }

  const handleChange: UploadProps['onChange'] = ({ fileList: list }) => {
    setFileList(list.slice(0, MAX_FILES))
  }

  const submit = async () => {
    if (!library) return
    if (fileList.length === 0) {
      message.warning('请先选择图片')
      return
    }
    setSubmitting(true)
    try {
      const files: File[] = fileList
        .map((f) => f.originFileObj as File | undefined)
        .filter((f): f is File => f != null)
      const res = await librariesApi.uploadImages(library.id, files)
      message.success(`上传成功 ${res.uploaded} 张,跳过 ${res.skipped} 张`)
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open={open}
      title="添加图片"
      onClose={onCancel}
      width={drawerWidth}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={submitting}
            disabled={submitting || fileList.length === 0}
          >
            确定 ({fileList.length})
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            <li>支持 jpg / png / webp / gif 格式</li>
            <li>单次最多 {MAX_FILES} 张,单张 ≤ 10MB</li>
            <li>同一 sha256 图片会被自动跳过</li>
          </ul>
        }
      />

      <Dragger
        multiple
        fileList={fileList}
        beforeUpload={beforeUpload}
        onChange={handleChange}
        onRemove={(file) => {
          setFileList(fileList.filter((f) => f.uid !== file.uid))
          return true
        }}
        accept={ALLOWED_MIME.join(',')}
        style={{ padding: '24px 0' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">拖拽上传图片到此处</p>
        <p className="ant-upload-hint">或</p>
        <Button type="primary" size="small">
          查看本地文件
        </Button>
      </Dragger>

      {fileList.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已选 {fileList.length} 个文件
          </Text>
        </div>
      )}
    </Drawer>
  )
}