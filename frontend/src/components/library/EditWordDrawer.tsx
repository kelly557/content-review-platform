import { useEffect, useState } from 'react'
import { App, Button, Drawer, Grid, Space } from 'antd'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'
import WordsInputPanel, { MAX_WORDS, type WordsMode } from './WordsInputPanel'

const { useBreakpoint } = Grid

interface Props {
  open: boolean
  library: Library | null
  onCancel: () => void
  onSuccess: () => void
}

export default function EditWordDrawer({ open, library, onCancel, onSuccess }: Props) {
  const { message } = App.useApp()
  const screens = useBreakpoint()
  const drawerWidth = screens.md ? 480 : '100%'

  const [mode, setMode] = useState<WordsMode>('batch')
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
      <WordsInputPanel
        text={text}
        file={file}
        mode={mode}
        onModeChange={setMode}
        onTextChange={setText}
        onFileChange={setFile}
        disabled={submitting}
      />
    </Drawer>
  )
}