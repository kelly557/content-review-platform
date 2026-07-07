import { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Switch,
  Select,
  Button,
  Space,
  Typography,
  App,
  Form,
  Input,
  Modal,
  Popconfirm,
  type TableColumnsType,
} from 'antd'
import {
  ArrowLeftOutlined,
  SaveOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useParams, Link, useLocation } from 'react-router-dom'
import { wordsetsApi } from '@/api/wordsets'
import { imagesetsApi } from '@/api/imagesets'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type {
  AuditItem,
  AuditPoint,
  AuditPointCreate,
  ImageSetListItem,
  WordSet,
} from '@/types/domain'

type WordSetOption = WordSet
type ImageSetOption = ImageSetListItem
type LibType = 'image' | 'wordset'

const { Title, Text } = Typography

const SERVICE_CODE = 'ad_compliance_detection_pro'

const PACKAGE_BY_MEDIA: Record<string, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

interface DraftPoint extends AuditPoint {
  _dirty?: boolean
  _libType?: LibType | null
}

interface CreateFormValues {
  label_cn: string
  description?: string
  scope_text?: string
  is_enabled: boolean
}

const DEFAULT_CREATE_FORM: CreateFormValues = {
  label_cn: '',
  description: '',
  scope_text: '',
  is_enabled: true,
}

export default function ServiceRuleConfigPage() {
  const { serviceCode, itemId, mediaType } = useParams<{
    serviceCode?: string
    itemId?: string
    mediaType?: string
  }>()
  const location = useLocation()
  const { message } = App.useApp()

  const nestedPackage =
    mediaType && PACKAGE_BY_MEDIA[mediaType] ? PACKAGE_BY_MEDIA[mediaType] : null
  const code = serviceCode ?? nestedPackage ?? SERVICE_CODE
  const activeItemId =
    itemId != null && !Number.isNaN(Number(itemId)) ? Number(itemId) : null

  const backState = (location.state ?? {}) as { from?: string; fromStep?: 0 | 1 }
  const nestedBack =
    mediaType && PACKAGE_BY_MEDIA[mediaType]
      ? `/strategies/rules-by-type/${mediaType}`
      : null
  const backTarget = backState.from ?? nestedBack ?? '/strategies'
  const backStepState =
    backState.fromStep != null ? { step: backState.fromStep } : undefined
  const backLabel = backState.from
    ? '返回策略审核规则'
    : nestedBack
      ? '返回规则列表'
      : '返回策略管理列表'

  const [points, setPoints] = useState<DraftPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wordsetOptions, setWordsetOptions] = useState<WordSetOption[]>([])
  const [imageSetOptions, setImageSetOptions] = useState<ImageSetOption[]>([])
  const [activeItemName, setActiveItemName] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftPoint[] | null>(null)

  // 新增审核点 modal 状态
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()

  const fetch = async () => {
    setLoading(true)
    try {
      const [allPoints, wss, iss, aItems] = await Promise.all([
        auditPointsApi.list(code),
        wordsetsApi
          .list({ size: 200 })
          .then((p) => p.items)
          .catch(() => [] as WordSetOption[]),
        imagesetsApi
          .list({ size: 200 })
          .then((p) => p.items)
          .catch(() => [] as ImageSetOption[]),
        auditItemsApi.list(code).catch(() => [] as AuditItem[]),
      ])
      const wordsetIds = new Set(wss.map((w) => w.id))
      const imageSetIds = new Set(iss.map((i) => i.id))
      const hydrateLibType = (p: AuditPoint): DraftPoint => {
        let _libType: LibType | null = null
        if (p.custom_wordset_id != null) {
          _libType = wordsetIds.has(p.custom_wordset_id)
            ? 'wordset'
            : imageSetIds.has(p.custom_wordset_id)
              ? 'image'
              : null
        }
        return { ...p, _dirty: false, _libType }
      }
      setPoints(allPoints.map(hydrateLibType))
      setWordsetOptions(wss)
      setImageSetOptions(iss)
      if (activeItemId != null) {
        const found = aItems.find((i) => i.id === activeItemId)
        setActiveItemName(found?.name_cn ?? null)
      } else {
        setActiveItemName(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!code) return
    void fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const filteredPoints = useMemo(() => {
    if (activeItemId == null) return points
    return points.filter((p) => p.item_id === activeItemId)
  }, [points, activeItemId])

  useEffect(() => {
    if (activeItemId == null) {
      setActiveItemName(null)
      return
    }
    auditItemsApi
      .list(code)
      .then((list) => {
        const found = list.find((i) => i.id === activeItemId)
        setActiveItemName(found?.name_cn ?? null)
      })
      .catch(() => setActiveItemName(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItemId, code])

  const dirty = points.some((p) => p._dirty)

  const wordsetByAction = useMemo(() => {
    const map = new Map<string, WordSetOption[]>()
    for (const w of wordsetOptions) {
      const a = w.action ?? w.kind ?? '黑名单'
      if (!map.has(a)) map.set(a, [])
      map.get(a)!.push(w)
    }
    return map
  }, [wordsetOptions])

  const updateLocal = (id: number, patch: Partial<DraftPoint>) => {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch, _dirty: true } : p)),
    )
  }

  const enterEdit = () => {
    setPendingReset(points.map((p) => ({ ...p })))
    setEditing(true)
  }

  const cancelEdit = () => {
    if (pendingReset) setPoints(pendingReset)
    setPendingReset(null)
    setEditing(false)
  }

  const onSave = async () => {
    const dirtyItems = points.filter((p) => p._dirty)
    if (dirtyItems.length === 0) {
      message.info('没有改动')
      return
    }
    setSaving(true)
    try {
      for (const p of dirtyItems) {
        await auditPointsApi.update(code, p.id, {
          description: p.description ?? '',
          scope_text: p.scope_text ?? '',
          is_enabled: p.is_enabled,
          custom_wordset_id: p.custom_wordset_id ?? undefined,
        })
      }
      message.success('已保存')
      await fetch()
      setEditing(false)
      setPendingReset(null)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDeletePoint = async (row: DraftPoint) => {
    try {
      await auditPointsApi.remove(code, row.id)
      message.success(`已删除「${row.label_cn || row.code}」`)
      void fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const openCreateModal = () => {
    if (activeItemId == null) {
      message.warning('请先进入一个审核项，再新增审核点')
      return
    }
    createForm.setFieldsValue(DEFAULT_CREATE_FORM)
    setCreateOpen(true)
  }

  const onCreatePoint = async () => {
    const values = await createForm.validateFields().catch(() => null)
    if (!values) return
    setCreating(true)
    try {
      const payload: AuditPointCreate = {
        item_id: activeItemId!,
        label_cn: values.label_cn,
        description: values.description,
        scope_text: values.scope_text,
        is_enabled: values.is_enabled,
      }
      await auditPointsApi.create(code, payload)
      message.success('已新增')
      setCreateOpen(false)
      void fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      message.error(detail ?? '新增失败')
    } finally {
      setCreating(false)
    }
  }

  const setPointLibrary = (
    row: DraftPoint,
    rawValue: string | number | undefined,
  ) => {
    if (rawValue == null || rawValue === '') {
      updateLocal(row.id, {
        custom_wordset_id: null,
        _libType: null,
      })
      return
    }
    const [kind, idStr] = String(rawValue).split(':')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return
    const libType: LibType = kind === 'image' ? 'image' : 'wordset'
    updateLocal(row.id, {
      custom_wordset_id: id,
      _libType: libType,
    })
  }

  const mergedColumns: TableColumnsType<DraftPoint> = [
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: '14%',
      render: (v: string | null, row) => (
        <span style={{ color: '#020617', fontWeight: 500 }}>
          {v || row.label || row.code}
        </span>
      ),
    },
    {
      title: '审核内容',
      dataIndex: 'scope_text',
      width: '20%',
      render: (v: string | null) => (
        <span style={{ color: '#020617' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: '风险等级定义',
      dataIndex: 'description',
      width: '22%',
      render: (v: string | null) => (
        <span style={{ color: '#020617' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: '检测状态',
      dataIndex: 'is_enabled',
      width: '10%',
      render: (active: boolean, row) => (
        <Space size={6}>
          <Switch
            checked={active}
            onChange={(v) => updateLocal(row.id, { is_enabled: v })}
            aria-label={`${row.label_cn || row.code} 检测状态`}
            size="small"
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {active ? '开' : '关'}
          </Text>
        </Space>
      ),
    },
    {
      title: '关联库',
      dataIndex: 'custom_wordset_id',
      width: '22%',
      render: (_v, row) => {
        const libType = row._libType
        const selectedRaw =
          libType != null && row.custom_wordset_id != null
            ? `${libType}:${row.custom_wordset_id}`
            : undefined
        const hasAny = imageSetOptions.length > 0 || wordsetOptions.length > 0
        return (
          <Select
            placeholder={
              hasAny ? '选择关联库（图库 / 词库）' : '暂无可用关联库'
            }
            value={selectedRaw}
            onChange={(v) => setPointLibrary(row, v)}
            allowClear
            style={{ width: '100%', minWidth: 220 }}
            size="small"
            disabled={!editing || !hasAny}
            showSearch
            optionFilterProp="label"
            options={[
              ...imageSetOptions.map((i) => ({
                value: `image:${i.id}`,
                label: `[图] [${i.action ?? i.kind ?? '图库'}] ${i.name}`,
              })),
              ...(wordsetByAction.get('黑名单') ?? []).map((w) => ({
                value: `wordset:${w.id}`,
                label: `[词] [黑名单] ${w.name}`,
              })),
              ...(wordsetByAction.get('白名单') ?? []).map((w) => ({
                value: `wordset:${w.id}`,
                label: `[词] [白名单] ${w.name}`,
              })),
              ...(wordsetByAction.get('需复审') ?? []).map((w) => ({
                value: `wordset:${w.id}`,
                label: `[词] [需复审] ${w.name}`,
              })),
              ...(wordsetByAction.get('标签') ?? []).map((w) => ({
                value: `wordset:${w.id}`,
                label: `[词] [标签] ${w.name}`,
              })),
            ]}
          />
        )
      },
    },
    {
      title: '操作',
      width: '8%',
      render: (_v, row) => (
        <Popconfirm
          title="确认删除该审核点？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDeletePoint(row)}
        >
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label={`删除 ${row.label_cn || row.code}`}
          >
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div className="service-rule-page">
      <Space style={{ marginBottom: 12 }} align="center">
        <Link to={backTarget} state={backStepState} style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            {backLabel}
          </Space>
        </Link>
      </Space>

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
          <Title level={3} style={{ margin: 0 }}>
            审核范围配置
          </Title>
          {activeItemName && (
            <Text type="secondary" style={{ fontSize: 14 }}>
              · {activeItemName}
            </Text>
          )}
        </Space>
        <Space wrap>
          {editing ? (
            <>
              <Button onClick={cancelEdit} disabled={saving}>
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={onSave}
                loading={saving}
                disabled={!dirty}
              >
                保存
              </Button>
            </>
          ) : (
            <Button type="primary" icon={<EditOutlined />} onClick={enterEdit}>
              编辑
            </Button>
          )}
        </Space>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Text strong>审核点列表</Text>
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
        >
          新增审核点
        </Button>
      </div>

      <Table<DraftPoint>
        rowKey="id"
        loading={loading}
        dataSource={filteredPoints}
        columns={mergedColumns}
        pagination={false}
        size="middle"
        scroll={{ x: true }}
        locale={{
          emptyText:
            activeItemId != null ? '该审核项下暂无审核点' : '暂无规则',
        }}
      />

      <Modal
        title="新增审核点"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreatePoint}
        confirmLoading={creating}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form<CreateFormValues>
          form={createForm}
          layout="vertical"
          initialValues={DEFAULT_CREATE_FORM}
        >
          <Form.Item
            name="label_cn"
            label="审核点（中文名）"
            rules={[
              { required: true, message: '请输入审核点名称' },
              { max: 64, message: '不超过 64 个字符' },
            ]}
          >
            <Input placeholder="例如 一号领导" maxLength={64} />
          </Form.Item>
          <Form.Item name="scope_text" label="审核内容">
            <Input
              placeholder="画面中疑似毒品、针管、白色粉状"
              maxLength={255}
            />
          </Form.Item>
          <Form.Item name="description" label="风险等级定义">
            <Input.TextArea
              placeholder="用自然语言描述各风险等级的判定标准，例如：低风险=轻微擦边；中风险=明确违规但非核心；高风险=严重违规或核心人物关联"
              rows={2}
              maxLength={255}
            />
          </Form.Item>

          <Form.Item name="is_enabled" label="启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}