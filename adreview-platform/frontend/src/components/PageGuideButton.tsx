import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  App,
  Button,
  Drawer,
  Empty,
  Grid,
  Input,
  Popconfirm,
  Space,
  Typography,
} from 'antd'
import {
  EditOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { codeStyle, findGuide, type PageGuide } from '@/lib/pageGuides'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'

const { Text, Paragraph } = Typography

const STORAGE_KEY = 'adreview.pageGuide.overrides'
const MAX_BYTES = 100 * 1024

function inlineMd(s: string, keyBase: number): ReactNode {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      parts.push(
        <code key={`${keyBase}-${parts.length}`} style={codeStyle}>
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      parts.push(
        <strong key={`${keyBase}-${parts.length}`}>{tok.slice(2, -2)}</strong>,
      )
    }
    last = re.lastIndex
  }
  if (last < s.length) parts.push(s.slice(last))
  return <>{parts}</>
}

function renderBlock(block: string, idx: number): ReactNode {
  const trimmed = block.trimEnd()
  if (!trimmed) return null
  if (trimmed.startsWith('## ')) {
    return (
      <Text
        key={idx}
        strong
        style={{ display: 'block', margin: '16px 0 8px', fontSize: 15 }}
      >
        {trimmed.slice(3)}
      </Text>
    )
  }
  const lines = trimmed.split('\n')
  if (lines.every((l) => /^(\s*)- /.test(l))) {
    return (
      <ul key={idx} style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        {lines.map((l, j) => {
          const indent = l.match(/^(\s*)- /)?.[1].length ?? 0
          const text = l.replace(/^\s*- /, '')
          return (
            <li key={j} style={{ marginLeft: indent > 0 ? 16 : 0 }}>
              {inlineMd(text, idx * 100 + j)}
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <p key={idx} style={{ margin: '0 0 12px' }}>
      {inlineMd(trimmed, idx * 100)}
    </p>
  )
}

function renderMarkdown(md: string): ReactNode {
  return md
    .split(/\n\n+/)
    .map((b, i) => renderBlock(b, i))
}

function sectionsToDraft(g: PageGuide): string {
  return g.sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.markdown}` : s.markdown))
    .join('\n\n---\n\n')
}

function draftToSections(raw: string): PageGuide['sections'] {
  const blocks = raw.split(/\n\n---\n\n/)
  return blocks.map((b) => {
    const lines = b.split('\n')
    if (lines[0]?.startsWith('## ')) {
      return {
        heading: lines[0].slice(3).trim(),
        markdown: lines.slice(1).join('\n').trim(),
      }
    }
    return { markdown: b.trim() }
  })
}

export function PageGuideButton() {
  const location = useLocation()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [overrides, setOverrides] = useLocalStorageState<
    Record<string, string>
  >(STORAGE_KEY, {})

  const guide = useMemo(() => findGuide(location.pathname), [location.pathname])
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  const effective = useMemo<PageGuide | null>(() => {
    if (!guide) return null
    const ov = overrides[location.pathname]
    if (!ov) return guide
    return { title: guide.title, sections: draftToSections(ov) }
  }, [guide, overrides, location.pathname])

  const isCustomized = !!overrides[location.pathname]

  useEffect(() => {
    if (open && guide) {
      setEditing(false)
      setDraft(sectionsToDraft(guide))
    }
  }, [open, guide])

  const onEdit = () => {
    setDraft(sectionsToDraft(effective ?? guide!))
    setEditing(true)
  }

  const onCancel = () => {
    setEditing(false)
    setDraft(sectionsToDraft(effective ?? guide!))
  }

  const onSave = () => {
    if (!draft.trim()) {
      message.warning('内容不能为空')
      return
    }
    if (new Blob([draft]).size > MAX_BYTES) {
      message.error(`内容超过 ${MAX_BYTES / 1024}KB 上限`)
      return
    }
    setOverrides({ ...overrides, [location.pathname]: draft })
    setEditing(false)
    message.success('已保存到本地')
  }

  const onReset = () => {
    const next = { ...overrides }
    delete next[location.pathname]
    setOverrides(next)
    setEditing(false)
    message.success('已恢复默认')
  }

  const canEdit = !!effective

  return (
    <>
      <Button
        type="text"
        icon={<QuestionCircleOutlined />}
        onClick={() => setOpen(true)}
        style={{ color: '#fff' }}
      >
        原型说明
      </Button>
      <Drawer
        title={effective?.title ?? '原型说明'}
        placement="right"
        width={isMobile ? '100%' : '50vw'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        extra={
          canEdit && !editing ? (
            <Space>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={onEdit}
              >
                编辑
              </Button>
              {isCustomized && (
                <Popconfirm
                  title="恢复默认?"
                  description="将清除当前页面的本地修改,恢复到 pageGuides.tsx 的默认文案。"
                  okText="恢复"
                  cancelText="取消"
                  onConfirm={onReset}
                >
                  <Button size="small" icon={<ReloadOutlined />}>
                    恢复默认
                  </Button>
                </Popconfirm>
              )}
            </Space>
          ) : null
        }
      >
        {effective ? (
          editing ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                使用 <code style={codeStyle}>## 标题</code> 分段,段落之间用 <code style={codeStyle}>{'\n\n---\n\n'}</code> 分隔。支持 <code style={codeStyle}>`代码`</code> 与 <code style={codeStyle}>**加粗**</code>。
              </Text>
              <Input.TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 18, maxRows: 40 }}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 13 }}
              />
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>
                  保存
                </Button>
                <Button icon={<CloseOutlined />} onClick={onCancel}>
                  取消
                </Button>
                {isCustomized && (
                  <Popconfirm
                    title="恢复默认?"
                    okText="恢复"
                    cancelText="取消"
                    onConfirm={onReset}
                  >
                    <Button danger icon={<ReloadOutlined />}>
                      恢复默认
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </div>
          ) : (
            <div>
              {effective.sections.map((s, idx) => (
                <div key={idx} style={{ marginBottom: 12 }}>
                  {s.heading && (
                    <Text
                      strong
                      style={{ display: 'block', margin: '8px 0', fontSize: 15 }}
                    >
                      {s.heading}
                    </Text>
                  )}
                  {s.markdown.trim() ? (
                    <div style={{ color: 'rgba(0,0,0,0.85)' }}>
                      {renderMarkdown(s.markdown)}
                    </div>
                  ) : (
                    <Paragraph type="secondary" style={{ margin: 0 }}>
                      （空段落）
                    </Paragraph>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <Empty
            description={
              <span>
                该页面暂未配置说明
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  可在 src/lib/pageGuides.tsx 中按路由补充
                </Text>
              </span>
            }
          />
        )}
      </Drawer>
    </>
  )
}