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
  Spin,
  Tabs,
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
import { codeStyle, draftToGuide, findGuide, guideToDraft, type GuideSection, type GuideTab, type PageGuide } from '@/lib/pageGuides'
import { pageGuidesApi, type PageGuideOverride } from '@/api/pageGuides'

const { Text, Paragraph } = Typography

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

  const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
  if (imgMatch) {
    return (
      <img
        key={idx}
        src={imgMatch[2]}
        alt={imgMatch[1]}
        style={{
          maxWidth: '100%',
          display: 'block',
          margin: '8px 0 12px',
          borderRadius: 4,
          border: '1px solid #E5E7EB',
          background: '#fff',
        }}
      />
    )
  }

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
  if (lines.every((l) => /^(\s*)\d+\.\s+/.test(l))) {
    return (
      <ol key={idx} style={{ margin: '0 0 12px', paddingLeft: 24 }}>
        {lines.map((l, j) => {
          const text = l.replace(/^\s*\d+\.\s+/, '')
          return <li key={j}>{inlineMd(text, idx * 100 + j)}</li>
        })}
      </ol>
    )
  }
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
  return md.split(/\n\n+/).map((b, i) => renderBlock(b, i))
}

function SectionsView({ sections }: { sections: GuideSection[] }) {
  return (
    <div>
      {sections.map((s, idx) => (
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
            <div style={{ color: 'rgba(0,0,0,0.85)' }}>{renderMarkdown(s.markdown)}</div>
          ) : (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              （空段落）
            </Paragraph>
          )}
        </div>
      ))}
    </div>
  )
}

function TabsView({
  tabs,
  fallbackSections,
}: {
  tabs?: GuideTab[]
  fallbackSections?: GuideSection[]
}) {
  if (tabs && tabs.length > 0) {
    return (
      <Tabs
        items={tabs.map((t) => ({
          key: t.key,
          label: t.label,
          children:
            t.sections.length === 0 ? (
              <Paragraph type="secondary" style={{ margin: '12px 0' }}>
                （暂无内容）
              </Paragraph>
            ) : (
              <SectionsView sections={t.sections} />
            ),
        }))}
      />
    )
  }
  return <SectionsView sections={fallbackSections ?? []} />
}

function sectionsToDraft(g: PageGuide): string {
  return guideToDraft(g)
}

export function PageGuideButton() {
  const location = useLocation()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [activeTab, setActiveTab] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [overrides, setOverrides] = useState<
    Record<string, PageGuideOverride>
  >({})
  const [loaded, setLoaded] = useState(false)

  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  const guide = useMemo(() => findGuide(location.pathname), [location.pathname])

  useEffect(() => {
    let cancelled = false
    pageGuidesApi
      .list()
      .then((res) => {
        if (cancelled) return
        const map: Record<string, PageGuideOverride> = {}
        for (const g of res.data.guides) map[g.path] = g
        setOverrides(map)
      })
      .catch(() => {
        // 静默失败 — 后端不可达就退到前端常量
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const override = overrides[location.pathname]
  const effective = useMemo<PageGuide | null>(() => {
    if (!guide) return null
    if (!override) return guide
    const parsed = draftToGuide(override.markdown_md)
    return {
      title: override.title,
      sections: parsed.sections,
      tabs: parsed.tabs,
    }
  }, [guide, override])

  const isCustomized = !!override

  useEffect(() => {
    if (open && effective) {
      setEditing(false)
      setDraft(sectionsToDraft(effective))
      setDraftTitle(effective.title)
      const firstTab = effective.tabs?.[0]?.key
      if (firstTab) setActiveTab(firstTab)
    }
  }, [open, effective])

  const onEdit = () => {
    setDraft(sectionsToDraft(effective ?? guide!))
    setDraftTitle((effective ?? guide!).title)
    setEditing(true)
  }

  const onCancel = () => {
    setEditing(false)
    setDraft(sectionsToDraft(effective ?? guide!))
    setDraftTitle((effective ?? guide!).title)
  }

  const onSave = async () => {
    if (!draft.trim()) {
      message.warning('内容不能为空')
      return
    }
    if (new Blob([draft]).size > 100 * 1024) {
      message.error('内容超过 100KB 上限')
      return
    }
    setSaving(true)
    try {
      const res = await pageGuidesApi.upsert(location.pathname, {
        title: draftTitle.trim() || (guide?.title ?? '原型说明'),
        markdown_md: draft,
      })
      setOverrides((prev) => ({ ...prev, [location.pathname]: res.data }))
      setEditing(false)
      message.success('已保存到数据库')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onReset = async () => {
    setSaving(true)
    try {
      await pageGuidesApi.remove(location.pathname)
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[location.pathname]
        return next
      })
      setEditing(false)
      message.success('已恢复默认')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err.response?.data?.detail ?? '恢复失败')
    } finally {
      setSaving(false)
    }
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
              <Button size="small" icon={<EditOutlined />} onClick={onEdit}>
                编辑
              </Button>
              {isCustomized && (
                <Popconfirm
                  title="恢复默认?"
                  description="将清除当前页面的数据库修改,恢复到 pageGuides.tsx 的默认文案。"
                  okText="恢复"
                  cancelText="取消"
                  onConfirm={onReset}
                >
                  <Button size="small" icon={<ReloadOutlined />} loading={saving}>
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
              <Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
              >
                使用 <code style={codeStyle}>## 标题</code> 分段,段落之间用{' '}
                <code style={codeStyle}>{'\n\n---\n\n'}</code> 分隔;需要 Tab
                时在块首写{' '}
                <code style={codeStyle}># Tab: 标签名</code>。支持{' '}
                <code style={codeStyle}>`代码`</code> 与{' '}
                <code style={codeStyle}>**加粗**</code>,以及{' '}
                <code style={codeStyle}>![alt](url)</code> 图片。
              </Text>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="标题"
                style={{ marginBottom: 8 }}
                maxLength={255}
              />
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  background: '#F8FAFC',
                  border: '1px dashed #CBD5E1',
                  borderRadius: 6,
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
                >
                  预览
                </Text>
                <TabsView {...draftToGuide(draft)} />
              </div>
              <Input.TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 18, maxRows: 40 }}
                style={{
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  fontSize: 13,
                }}
              />
              <Space style={{ marginTop: 12 }}>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={onSave}
                  loading={saving}
                >
                  保存
                </Button>
                <Button icon={<CloseOutlined />} onClick={onCancel} disabled={saving}>
                  取消
                </Button>
                {isCustomized && (
                  <Popconfirm
                    title="恢复默认?"
                    okText="恢复"
                    cancelText="取消"
                    onConfirm={onReset}
                  >
                    <Button danger icon={<ReloadOutlined />} disabled={saving}>
                      恢复默认
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </div>
          ) : !loaded ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin />
            </div>
          ) : effective.tabs && effective.tabs.length > 0 ? (
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={effective.tabs.map((t) => ({
                key: t.key,
                label: t.label,
                children: t.sections.length === 0 ? (
                  <Paragraph type="secondary" style={{ margin: '12px 0' }}>
                    （暂无内容 — 点击右上角「编辑」录入）
                  </Paragraph>
                ) : (
                  <SectionsView sections={t.sections} />
                ),
              }))}
            />
          ) : (
            <TabsView fallbackSections={effective.sections} />
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