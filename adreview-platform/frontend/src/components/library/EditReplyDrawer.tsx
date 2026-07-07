import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Grid,
  Input,
  Space,
  Tabs,
  Typography,
  Upload,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { librariesApi } from '@/api/libraries'
import type { Library } from '@/types/domain'
import { parseReplyFile } from '@/lib/libraryImport'

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

interface ParsedPair {
  trigger: string
  reply: string
}

export default function EditReplyDrawer({ open, library, onCancel, onSuccess }: Props) {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const drawerWidth = screens.md ? 480 : '100%'

  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) setText('')
  }, [open])

  const parsePairsFromText = (raw: string): ParsedPair[] => {
    const pairs: ParsedPair[] = []
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      let trig = ''
      let rep = ''
      if (t.includes('|||')) {
        const [a, b] = t.split('|||', 2)
        trig = (a ?? '').trim()
        rep = (b ?? '').trim()
      } else if (t.includes('\t')) {
        const [a, b] = t.split('\t', 2)
        trig = (a ?? '').trim()
        rep = (b ?? '').trim()
      } else if (t.includes(',')) {
        const [a, b] = t.split(',', 2)
        trig = (a ?? '').trim()
        rep = (b ?? '').trim()
      }
      if (!trig || !rep) continue
      if (trig.length > MAX_TRIGGER || rep.length > MAX_REPLY) continue
      pairs.push({ trigger: trig, reply: rep })
    }
    return pairs
  }

  const submit = async () => {
    if (!library) return
    const pairs = parsePairsFromText(text)
    if (pairs.length === 0) {
      message.warning('没有可添加的有效条目（检查 trigger|||reply 格式与长度）')
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
        pairs.map((p) => `${p.trigger}|||${p.reply}`),
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
      <Tabs
        defaultActiveKey="paste"
        items={[
          {
            key: 'paste',
            label: '直接粘贴',
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 12,
                        lineHeight: 1.7,
                      }}
                    >
                      <li>每行一条，格式：触发词 ||| 代答内容</li>
                      <li>触发词不超过 {MAX_TRIGGER} 字,代答不超过 {MAX_REPLY} 字</li>
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
                  disabled={importing}
                />
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已输入{' '}
                    {text.split(/\r?\n/).filter((s) => s.trim()).length} 行
                  </Text>
                </div>
              </>
            ),
          },
          {
            key: 'upload',
            label: '上传 .txt / .csv',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message={
                    <span>
                      每行 <code>trigger</code> 与 <code>reply</code> 用 <code>|||</code> / Tab /
                      逗号 分隔。.csv 自动识别为 <code>trigger,reply</code>。
                    </span>
                  }
                />
                <Upload
                  accept=".txt,.csv"
                  beforeUpload={async (file) => {
                    setImporting(true)
                    try {
                      const { pairs, errors } = await parseReplyFile(
                        file as File,
                      )
                      if (errors.length > 0 || pairs.length === 0) {
                        message.error(errors[0] ?? '文件无有效数据')
                        return false
                      }
                      if (pairs.length > MAX_PAIRS) {
                        message.error(
                          `单次最多 ${MAX_PAIRS} 对,检测到 ${pairs.length}`,
                        )
                        return false
                      }
                      const text2 = pairs
                        .map((p) => `${p.trigger}|||${p.reply}`)
                        .join('\n')
                      setText(text2)
                      message.success(
                        `已导入 ${pairs.length} 对,切换到直接粘贴 tab 可继续编辑`,
                      )
                      return false
                    } catch (e) {
                      message.error(
                        '解析失败：' + (e as Error).message,
                      )
                      return false
                    } finally {
                      setImporting(false)
                    }
                  }}
                  showUploadList={false}
                  maxCount={1}
                  disabled={submitting || importing}
                >
                  <Button
                    icon={<InboxOutlined />}
                    loading={importing}
                  >
                    选择 .txt / .csv 上传
                  </Button>
                </Upload>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  文件读取后写入上方粘贴框,可继续手动修改
                </Text>
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  )
}