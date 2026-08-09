// 标签管理（系统管理 → 标签管理）
// 设计要点（v5，真实 API 版）：
//   - 数据源：tagsApi.tree() 一次拉取三级树，前端扁平化为行
//   - 三级标签带「适用模态」（每条三级记录一个模态，图文双模态即两行）
//   - 标签页面只做标签 CRUD + 模型绑定展示，不提供绑定 / 解绑模型的操作
//     （绑定关系由模型模块维护；此处只展示已绑定模型与「未绑定 → 无阈值」状态）
//   - 停用 / 删除前先调 tagsApi.getReferences 查引用清单：
//     · 停用被 active 策略引用 → 阻止
//     · 删除任何引用 → 阻止
//     阻止时弹出顶层 TagReferenceConfirmModal 展示引用详情；接口 409 兜底
//   - 列表行：一级 / 二级没有下挂子标签时单独成行；三级每条记录一行
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  AutoComplete,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag as AntdTag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  TagsOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { tagsApi } from '@/api/tags'
import type {
  TagModality,
  TagStatus,
  TagTreeNode,
} from '@/types/domain'
import { TagReferenceConfirmModal } from '@/components/TagReferenceConfirmModal'

const { Text, Title } = Typography

type Level = 1 | 2 | 3

const MODALITY_LABELS: Record<TagModality, string> = {
  text: '文本',
  image: '图像',
  audio: '音频',
  video: '视频',
}

const MODALITY_OPTIONS: { value: TagModality; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图像' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
]

/** 页面内部行用标签结构（由 tree 扁平化得来） */
interface TagRow {
  id: string
  code: string
  level: Level
  name: string
  status: TagStatus
  parentId: string | null
  domain: string
  modality?: TagModality | null
  boundModelId?: number | null
  boundModelLabel?: string | null
}

interface FlatRow {
  key: string
  rowTag: TagRow
  l1: TagRow | null
  l2: TagRow | null
  l3: TagRow | null
}

interface DrawerState {
  open: boolean
  editing: TagRow | null
}

function flattenTree(nodes: TagTreeNode[]): TagRow[] {
  const out: TagRow[] = []
  const walk = (list: TagTreeNode[], parentId: string | null) => {
    for (const n of list) {
      out.push({
        id: n.id,
        code: n.code,
        level: n.level as Level,
        name: n.name,
        status: n.status,
        parentId,
        domain: n.domain,
        modality: n.modality ?? null,
        boundModelId: n.bound_model_id ?? null,
        boundModelLabel: n.bound_model_label ?? null,
      })
      if (n.children?.length) walk(n.children, n.id)
    }
  }
  walk(nodes, null)
  return out
}

function findById(list: TagRow[], id: string | null | undefined): TagRow | null {
  if (!id) return null
  return list.find((t) => t.id === id) ?? null
}

/** 后端 code 正则：^[A-Za-z][A-Za-z0-9_\-]{1,95}$ */
function genTagCode(): string {
  return `tag_u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function TagsAdminPage() {
  const { message } = App.useApp()

  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TagStatus>('all')
  const [level1Filter, setLevel1Filter] = useState<string>('')
  const [level2Filter, setLevel2Filter] = useState<string>('')
  const [level3Filter, setLevel3Filter] = useState<string>('')
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, editing: null })
  // 父级标签(combobox): id 存在 = 选了已有;仅 name = 用户输入新值
  const [parentL1Input, setParentL1Input] = useState<{ id?: string; name: string } | null>(null)
  const [parentL2Input, setParentL2Input] = useState<{ id?: string; name: string } | null>(null)
  // 待应用的表单初始值(Drawer 打开后才 apply,避免 form 未连接导致 setFieldsValue 丢失)
  const [pendingInit, setPendingInit] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkingRefs, setCheckingRefs] = useState(false)
  const [form] = Form.useForm()

  // ── 数据加载 ──
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const tree = await tagsApi.tree()
      setTags(flattenTree(tree))
    } catch {
      message.error('标签树加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void reload()
  }, [reload])

  // ── 派生：扁平行 ──
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []
    const l1Tags = tags.filter((t) => t.level === 1)
    for (const l1 of l1Tags) {
      const l2Children = tags
        .filter((t) => t.level === 2 && t.parentId === l1.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (l2Children.length === 0) {
        rows.push({ key: `row-${l1.id}`, rowTag: l1, l1, l2: null, l3: null })
        continue
      }
      for (const l2 of l2Children) {
        const l3Children = tags
          .filter((t) => t.level === 3 && t.parentId === l2.id)
          .sort((a, b) => a.name.localeCompare(b.name))
        if (l3Children.length === 0) {
          rows.push({ key: `row-${l2.id}`, rowTag: l2, l1, l2, l3: null })
          continue
        }
        for (const l3 of l3Children) {
          rows.push({ key: `row-${l3.id}`, rowTag: l3, l1, l2, l3 })
        }
      }
    }
    return rows
  }, [tags])

  const level1Options = useMemo(
    () => tags.filter((t) => t.level === 1).map((t) => ({ id: t.id, value: t.name, label: t.name })),
    [tags],
  )
  const level2Options = useMemo(
    () => tags.filter((t) => t.level === 2).map((t) => ({ id: t.id, value: t.name, label: t.name })),
    [tags],
  )
  // 二级标签按一级标签过滤: 一级空 → 空;一级已选 → 仅该一级下;一级输入新值 → 空
  const filteredLevel2Options = useMemo(() => {
    if (!parentL1Input?.id) return []
    return level2Options.filter((o) => {
      const t = tags.find((tt) => tt.id === o.id)
      return t?.parentId === parentL1Input.id
    })
  }, [level2Options, tags, parentL1Input?.id])

  const l1FilterOptions = useMemo(
    () => tags.filter((t) => t.level === 1).map((t) => ({ value: t.id, label: t.name })),
    [tags],
  )
  const l2FilterOptions = useMemo(
    () =>
      (level1Filter
        ? tags.filter((t) => t.level === 2 && t.parentId === level1Filter)
        : tags.filter((t) => t.level === 2)
      ).map((t) => ({ value: t.id, label: t.name })),
    [tags, level1Filter],
  )
  const l3FilterOptions = useMemo(
    () =>
      (level2Filter
        ? tags.filter((t) => t.level === 3 && t.parentId === level2Filter)
        : tags.filter((t) => t.level === 3)
      ).map((t) => ({ value: t.id, label: t.name })),
    [tags, level2Filter],
  )

  const filteredRows = useMemo(() => {
    const trimmed = q.trim().toLowerCase()
    return flatRows.filter((row) => {
      const { l1, l2, l3, rowTag } = row
      if (statusFilter !== 'all' && rowTag.status !== statusFilter) return false
      if (level1Filter && l1?.id !== level1Filter) return false
      if (level2Filter && l2?.id !== level2Filter) return false
      if (level3Filter && l3?.id !== level3Filter) return false
      if (!trimmed) return true
      const haystack = [
        l1?.name ?? '',
        l2?.name ?? '',
        l3?.name ?? '',
        l3?.boundModelLabel ?? '',
        l3?.modality ? MODALITY_LABELS[l3.modality] : '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(trimmed)
    })
  }, [flatRows, q, statusFilter, level1Filter, level2Filter, level3Filter])

  // ── 确保父级存在：有 id 直接用；仅 name 先创建再返回 id ──
  const ensureParentTag = async (
    input: { id?: string; name: string } | null,
    level: 1 | 2,
    parentId: string | null,
    domain: string,
  ): Promise<string | null> => {
    const name = input?.name.trim() ?? ''
    if (!name) return null
    if (input?.id) return input.id
    const created = await tagsApi.create({
      code: genTagCode(),
      name,
      domain: domain as TagTreeNode['domain'],
      category: 'custom',
      status: 'active',
      level,
      parent_id: parentId,
    })
    return created.id
  }

  // ── Drawer 操作 ──
  const openCreate = () => {
    form.resetFields()
    setParentL1Input(null)
    setParentL2Input(null)
    setPendingInit({})
    setDrawer({ open: true, editing: null })
  }

  const openEdit = (row: TagRow) => {
    form.resetFields()
    let p_l1: { id?: string; name: string } | null = null
    let p_l2: { id?: string; name: string } | null = null
    if (row.parentId) {
      const p = findById(tags, row.parentId)
      if (p) {
        if (p.level === 1) p_l1 = { id: p.id, name: p.name }
        if (p.level === 2) {
          p_l2 = { id: p.id, name: p.name }
          if (p.parentId) {
            const pp = findById(tags, p.parentId)
            if (pp) p_l1 = { id: pp.id, name: pp.name }
          }
        }
      }
    }
    setParentL1Input(p_l1)
    setParentL2Input(p_l2)
    setPendingInit({
      name: row.name,
      modalities: row.modality ? [row.modality] : [],
    })
    setDrawer({ open: true, editing: row })
  }

  const closeDrawer = () => {
    setDrawer({ open: false, editing: null })
    setParentL1Input(null)
    setParentL2Input(null)
    setPendingInit(null)
    form.resetFields()
  }

  // Drawer 打开后,form 已连接,此时 apply pendingInit
  useEffect(() => {
    if (!drawer.open || !pendingInit) return
    form.setFieldsValue(pendingInit)
    setPendingInit(null)
  }, [drawer.open, pendingInit, form])

  const handleSave = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      const editing = drawer.editing

      // ── 编辑场景:只改当前三级记录（名称 + 模态；层级后端不允许改） ──
      if (editing) {
        const mods = (v.modalities as TagModality[] | undefined) ?? []
        await tagsApi.update(editing.id, {
          name: (v.name as string).trim(),
          modality: mods[0] ?? null,
        })
        message.success('已保存')
        closeDrawer()
        await reload()
        return
      }

      // ── 新增场景:Drawer 永远是三级表单 ──
      const l1Name = parentL1Input?.name.trim() ?? ''
      const l2Name = parentL2Input?.name.trim() ?? ''
      const l3Name = (v.name as string | undefined)?.trim() ?? ''
      const mods = (v.modalities as TagModality[] | undefined) ?? []
      if (!l1Name || !l2Name || !l3Name || mods.length === 0) {
        message.error('一级、二级、三级标签和适用模态都必须填写')
        return
      }

      // 新建一级时 domain 落 custom；已有/新建二级继承一级 domain
      const l1Existing = parentL1Input?.id ? findById(tags, parentL1Input.id) : null
      const domain = l1Existing?.domain ?? 'custom'
      const l1Id = await ensureParentTag(parentL1Input, 1, null, 'custom')
      if (!l1Id) return
      const l2Id = await ensureParentTag(parentL2Input, 2, l1Id, domain)
      if (!l2Id) return

      // 按 modalities 展开为 N 条三级记录
      for (const mod of mods) {
        await tagsApi.create({
          code: genTagCode(),
          name: l3Name,
          domain: domain as TagTreeNode['domain'],
          category: 'custom',
          status: 'active',
          level: 3,
          parent_id: l2Id,
          modality: mod,
        })
      }
      message.success(`已新增 1 个三级标签 × ${mods.length} 个模态`)
      closeDrawer()
      await reload()
    } catch (err) {
      if (err && typeof err === 'object' && 'response' in err) {
        const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        message.error(detail ?? '保存失败')
      }
      // 表单校验失败静默
    } finally {
      setSaving(false)
    }
  }

  // ── 引用检查 + 停用/启用 ──
  const handleToggleStatus = async (row: TagRow) => {
    setCheckingRefs(true)
    try {
      if (row.status === 'active') {
        const refs = await tagsApi.getReferences(row.id)
        if (!refs.can_deactivate) {
          await TagReferenceConfirmModal.open({ refs, scope: 'strategy' })
          return
        }
        await tagsApi.deprecate(row.id)
        message.success('已停用')
      } else {
        await tagsApi.activate(row.id)
        message.success('已启用')
      }
      await reload()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : '操作失败')
    } finally {
      setCheckingRefs(false)
    }
  }

  // ── 引用检查 + 删除(后端级联软删后代) ──
  const handleDelete = async (row: TagRow) => {
    setCheckingRefs(true)
    try {
      const refs = await tagsApi.getReferences(row.id)
      if (!refs.can_delete) {
        await TagReferenceConfirmModal.open({ refs, scope: 'all' })
        return
      }
      await tagsApi.remove(row.id)
      message.success('已删除（含全部子标签）')
      await reload()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : '删除失败')
    } finally {
      setCheckingRefs(false)
    }
  }

  // 父级联动:一级变更时清空二级
  const watchL1 = Form.useWatch('parent_l1', form)
  useEffect(() => {
    const currentL2 = form.getFieldValue('parent_l2') as string | undefined
    if (watchL1 && currentL2) {
      const stillValid = tags.some(
        (t) => t.id === currentL2 && t.level === 2 && t.parentId === watchL1,
      )
      if (!stillValid) form.setFieldValue('parent_l2', undefined)
    }
  }, [watchL1, tags, form])

  // ── 列定义 ──
  const columns: ColumnsType<FlatRow> = [
    {
      title: '标签',
      minWidth: 280,
      render: (_, row) => {
        const segments: { name: string; isSubject: boolean }[] = []
        if (row.l1) segments.push({ name: row.l1.name, isSubject: row.rowTag.id === row.l1.id })
        if (row.l2) segments.push({ name: row.l2.name, isSubject: row.rowTag.id === row.l2.id })
        if (row.l3) segments.push({ name: row.l3.name, isSubject: row.rowTag.id === row.l3.id })
        if (segments.length === 0) return <Text type="secondary">—</Text>

        const subjectL3 = row.rowTag.level === 3 ? row.rowTag : null

        return (
          <Space direction="vertical" size={0}>
            <Text>
              {segments.map((s, i) => (
                <span key={i}>
                  {i > 0 && <Text type="secondary"> / </Text>}
                  <Text strong={s.isSubject}>{s.name}</Text>
                </span>
              ))}
            </Text>
            {subjectL3 && !subjectL3.boundModelId && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                未绑定模型 · 无阈值
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '模态',
      minWidth: 100,
      render: (_, row) => {
        const m = row.l3?.modality
        if (!m) return <Text type="secondary">—</Text>
        return <AntdTag color="cyan">{MODALITY_LABELS[m]}</AntdTag>
      },
    },
    {
      title: '模型',
      minWidth: 140,
      render: (_, row) => {
        if (!row.l3) return <Text type="secondary">—</Text>
        if (!row.l3.boundModelId) return <Text type="danger">未绑定</Text>
        return <Text>{row.l3.boundModelLabel ?? `#${row.l3.boundModelId}`}</Text>
      },
    },
    {
      title: '状态',
      minWidth: 140,
      render: (_, row) => {
        const t = row.rowTag
        const label =
          t.status === 'active' ? (
            <AntdTag color="green">已启用</AntdTag>
          ) : t.status === 'draft' ? (
            <AntdTag color="default">草稿</AntdTag>
          ) : (
            <AntdTag>已停用</AntdTag>
          )
        return (
          <a
            onClick={() => handleToggleStatus(t)}
            style={{ cursor: checkingRefs ? 'wait' : 'pointer' }}
          >
            {label}
          </a>
        )
      },
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.rowTag.level === 3 && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(row.rowTag)}
            >
              编辑
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={checkingRefs}
            onClick={() => handleDelete(row.rowTag)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const watchEditing = drawer.editing

  // ── Drawer body ──
  const drawerBody = (
    <Form form={form} layout="vertical" requiredMark={false}>
      <Form.Item
        label="一级标签"
        required
        tooltip={watchEditing ? '编辑三级标签时,一级标签不可改' : '可选择已有,或输入新一级标签名称'}
      >
        <AutoComplete
          placeholder="请选择或输入新标签"
          options={level1Options}
          disabled={!!watchEditing}
          value={parentL1Input?.name ?? ''}
          onChange={(value, option) => {
            const opt = option as { id?: string } | undefined
            const newL1 = { id: opt?.id, name: value }
            setParentL1Input(newL1)
            // 切换一级时,如果已选的二级不在新一级下,清空二级
            setParentL2Input((prev) => {
              if (!prev?.id) return prev
              const stillValid = tags.some(
                (t) => t.id === prev.id && t.parentId === newL1.id,
              )
              return stillValid ? prev : null
            })
          }}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
          }
        />
      </Form.Item>

      <Form.Item
        label="二级标签"
        required
        tooltip={watchEditing ? '编辑三级标签时,二级标签不可改' : '从一级标签下属二级标签中选择,或输入新二级标签'}
      >
        <AutoComplete
          placeholder={parentL1Input?.id ? '请选择或输入新二级标签' : parentL1Input?.name ? '一级标签为新建值,二级标签请直接输入' : '请先选择一级标签'}
          options={filteredLevel2Options}
          disabled={!!watchEditing}
          value={parentL2Input?.name ?? ''}
          onChange={(value, option) => {
            const opt = option as { id?: string } | undefined
            setParentL2Input({ id: opt?.id, name: value })
          }}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
          }
        />
      </Form.Item>

      <Form.Item
        label="三级标签名称"
        name="name"
        rules={[
          { required: true, message: '请输入三级标签名称' },
          { max: 32, message: '标签名称最多 32 字' },
        ]}
      >
        <Input
          placeholder="请输入三级标签名称"
          maxLength={32}
          showCount
        />
      </Form.Item>

      <Form.Item
        label="适用模态"
        name="modalities"
        rules={[
          { required: true, message: '请选择适用模态' },
          {
            validator: async (_rule, value) => {
              if (!Array.isArray(value) || value.length === 0) {
                throw new Error('至少选择 1 个模态')
              }
            },
          },
        ]}
        tooltip="该标签适用的输入模态(可多选);每个模态生成一行独立记录,模型绑定由模型模块维护"
      >
        <Select
          mode="multiple"
          placeholder="请选择模态(可多选)"
          options={MODALITY_OPTIONS}
          showSearch
          optionFilterProp="label"
          allowClear
          maxTagCount="responsive"
        />
      </Form.Item>
    </Form>
  )

  // ── Drawer footer ──
  const drawerFooter = (
    <div style={{ textAlign: 'right' }}>
      <Space>
        <Button icon={<CloseOutlined />} onClick={closeDrawer}>
          取消
        </Button>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          保存
        </Button>
      </Space>
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <TagsOutlined style={{ marginRight: 8 }} />
            标签管理
          </Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增标签
          </Button>
        </Space>
      </div>

      {/* 过滤栏 */}
      <div
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索标签 / 模型 / 模态"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 240 }}
        />
        <Select
          placeholder="全部一级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level1Filter || undefined}
          onChange={(v) => {
            setLevel1Filter(v ?? '')
            setLevel2Filter('')
            setLevel3Filter('')
          }}
          options={l1FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          placeholder="全部二级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level2Filter || undefined}
          disabled={l2FilterOptions.length === 0}
          onChange={(v) => {
            setLevel2Filter(v ?? '')
            setLevel3Filter('')
          }}
          options={l2FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          placeholder="全部三级"
          allowClear
          showSearch
          optionFilterProp="label"
          value={level3Filter || undefined}
          disabled={l3FilterOptions.length === 0}
          onChange={(v) => setLevel3Filter(v ?? '')}
          options={l3FilterOptions}
          style={{ width: 160 }}
        />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '已启用' },
            { value: 'draft', label: '草稿' },
            { value: 'deprecated', label: '已停用' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <Text type="secondary">
          命中 {filteredRows.length} / {flatRows.length} 行
        </Text>
      </div>

      <Spin spinning={loading && tags.length === 0}>
        <Table<FlatRow>
          rowKey="key"
          columns={columns}
          dataSource={filteredRows}
          tableLayout="auto"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 行` }}
          scroll={{ x: '100%' }}
          locale={{
            emptyText: <Empty description="暂无标签" />,
          }}
        />
      </Spin>

      <Drawer
        title={watchEditing ? `编辑标签 · ${watchEditing.name}` : '新增标签'}
        placement="right"
        width={560}
        open={drawer.open}
        onClose={closeDrawer}
        destroyOnClose
        footer={drawerFooter}
      >
        {drawerBody}
      </Drawer>
    </div>
  )
}
