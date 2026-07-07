import { useEffect, useState } from 'react'
import { Alert, App, Button, Drawer, Grid, Input, Space, Typography } from 'antd'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'

const { Text } = Typography

const MAX_PAIRS = 1000
const MAX_TRIGGER = 50
const MAX_REPLY = 500

interface Props {
  open: boolean
  library: Library | null
  onCancel: () => void
  onSuccess: () => void
}

export default function EditReplyDrawer({ open, library, onCancel, onSuccess }: Props) {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const drawerWidth = screens.md ? 480 : '100%'

  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) setText('')
  }, [open])

  const submit = async () => {
    if (!library) return
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      message.warning('请输入至少一条代答')
      return
    }
    const pairs: { trigger: string; reply: string }[] = []
    for (const line of lines) {
      const idx = line.indexOf('|||')
      if (idx < 0) {
        message.warning(`「${line}」缺少分隔符 |||，已跳过`)
        continue
      }
      const trigger = line.slice(0, idx).trim()
      const reply = line.slice(idx + 3).trim()
      if (!trigger || !reply) {
        message.warning(`「${line}」触发词或代答为空，已跳过`)
        continue
      }
      if (trigger.length > MAX_TRIGGER) {
        message.warning(`触发词「${trigger}」超过 ${MAX_TRIGGER} 字，已跳过`)
        continue
      }
      if (reply.length > MAX_REPLY) {
        message.warning(`代答内容超过 ${MAX_REPLY} 字，已跳过：${trigger}`)
        continue
      }
      pairs.push({ trigger, reply })
    }
    if (pairs.length === 0) {
      message.warning('没有可添加的有效条目')
      return
    }
    if (pairs.length > MAX_PAIRS) {
      message.error(`单次最多 ${MAX_PAIRS} 条代答`)
      return
    }

    setSubmitting(true)
    try {
      const res = await librariesApi.addItems(
        library.id,
        pairs.map((p) => p.trigger),
      )
      message.success(`已添加 ${res.items.length} 条`)
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open={open}
      title="添加代答"
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
            disabled={submitting || text.trim().length === 0}
          >
            确定
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            <li>每行一条，格式：触发词 ||| 代答内容</li>
            <li>触发词不超过 {MAX_TRIGGER} 字，代答不超过 {MAX_REPLY} 字</li>
            <li>单次最多 {MAX_PAIRS} 条</li>
            <li>同一触发词 + 代答 在库内自动去重</li>
          </ul>
        }
      />
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'在吗 ||| 亲，在的呢~\n怎么联系 ||| 请拨打 400-xxx'}
        rows={14}
        style={{ resize: 'vertical', fontFamily: 'monospace' }}
      />
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          已输入 {text.split(/\r?\n/).filter((s) => s.trim()).length} 行
        </Text>
      </div>
    </Drawer>
  )
}