import { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Switch,
  Select,
  Button,
  Space,
  Typography,
  App,
  Input,
  Modal,
  Popconfirm,
  Alert,
  Drawer,
  Tag,
  Upload,
  type TableColumnsType,
  type UploadProps,
} from 'antd'
import {
  ArrowLeftOutlined,
  SaveOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  InboxOutlined,
} from '@ant-design/icons'
import { useParams, Link, useLocation } from 'react-router-dom'
import { wordsetsApi } from '@/api/wordsets'
import { imagesetsApi } from '@/api/imagesets'
import { librariesApi } from '@/api/libraries'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { parseImportFile, rowsToText } from '@/lib/auditPointBatchImport'
import type {
  AuditItem,
  AuditPoint,
  AuditPointBatchResult,
  AuditPointRisk,
  ImageSetListItem,
  LibraryListItem,
  WordSet,
} from '@/types/domain'

type WordSetOption = WordSet
type ImageSetOption = ImageSetListItem
type ReplyLibraryOption = LibraryListItem
type LibType = 'image' | 'wordset' | 'reply'

const { Title, Text } = Typography

const SERVICE_CODE = 'ad_compliance_detection_pro'

const PACKAGE_BY_MEDIA: Record<string, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const RISK_OPTIONS: AuditPointRisk[] = ['低风险', '中风险', '高风险']
const MAX_BATCH = 100

const SAMPLE_BATCH_TEXT = `# 在此粘贴批量内容（每行：审核点 | 审核内容 | 风险等级）
一号领导 | 画面中出现核心领导人物 | 高风险
毒品 | 针管或白色粉状物 | 中风险
性感擦边 | 大面积裸露 | 低风险`

interface DraftPoint extends AuditPoint {
  _dirty?: boolean
  _libType?: LibType | null
}

interface ParsedBatchRow {
  displayIndex: number
  label_cn: string
  scope_text: string
  risk_level: AuditPointRisk
  is_enabled: boolean
  valid: boolean
  error: string | null
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
  const [replyLibraryOptions, setReplyLibraryOptions] = useState<
    ReplyLibraryOption[]
  >([])
  const [activeItemName, setActiveItemName] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftPoint[] | null>(null)

  // 批量新增审核点 modal 状态
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchResult, setBatchResult] = useState<AuditPointBatchResult | null>(
    null,
  )
  const [batchResultOpen, setBatchResultOpen] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const [allPoints, wss, iss, rls, aItems] = await Promise.all([
        auditPointsApi.list(code),
        wordsetsApi
          .list({ size: 200 })
          .then((p) => p.items)
          .catch(() => [] as WordSetOption[]),
        imagesetsApi
          .list({ size: 200 })
          .then((p) => p.items)
          .catch(() => [] as ImageSetOption[]),
        librariesApi
          .list({ type: 'reply', size: 200 })
          .then((p) => p.items)
          .catch(() => [] as ReplyLibraryOption[]),
        auditItemsApi.list(code).catch(() => [] as AuditItem[]),
      ])
      const wordsetIds = new Set(wss.map((w) => w.id))
      const imageSetIds = new Set(iss.map((i) => i.id))
      const replyIds = new Set(rls.map((r) => r.id))
      const hydrateLibType = (p: AuditPoint): DraftPoint => {
        let _libType: LibType | null = null
        if (p.custom_reply_library_id != null) {
          _libType = replyIds.has(p.custom_reply_library_id) ? 'reply' : null
        } else if (p.custom_wordset_id != null) {
          _libType = wordsetIds.has(p.custom_wordset_id)
            ? 'wordset'
            : imageSetIds.has(p.custom_wordset_id)
              ? 'image'
              : null
        } else if (p.custom_library_id != null) {
          _libType = wordsetIds.has(p.custom_library_id)
            ? 'wordset'
            : imageSetIds.has(p.custom_library_id)
              ? 'image'
              : null
        }
        return { ...p, _dirty: false, _libType }
      }
      setPoints(allPoints.map(hydrateLibType))
      setWordsetOptions(wss)
      setImageSetOptions(iss)
      setReplyLibraryOptions(rls)
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
          custom_reply_library_id: p.custom_reply_library_id ?? undefined,
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

  // 批量新增
  const openBatchModal = () => {
    if (activeItemId == null) {
      message.warning('请先进入一个审核项，再批量新增')
      return
    }
    setBatchText('')
    setBatchResult(null)
    setBatchOpen(true)
  }

  const parsedBatchRows = useMemo<ParsedBatchRow[]>(() => {
    const lines = batchText.split('\n')
    const out: ParsedBatchRow[] = []
    let display = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('#')) continue
      display += 1
      const parts = trimmed.split('|').map((p) => p.trim())
      const [name, scope, riskRaw] = parts
      let error: string | null = null
      if (!name) error = '名称不能为空'
      else if (name.length > 64) error = '名称超过 64 字符'
      else if (scope && scope.length > 255) error = '审核内容超过 255 字符'
      const risk: AuditPointRisk = (RISK_OPTIONS as string[]).includes(
        riskRaw ?? '',
      )
        ? (riskRaw as AuditPointRisk)
        : '中风险'
      out.push({
        displayIndex: display,
        label_cn: name ?? '',
        scope_text: scope ?? '',
        risk_level: risk,
        is_enabled: true,
        valid: error === null,
        error,
      })
    }
    return out
  }, [batchText])

  const validBatchCount = parsedBatchRows.filter((r) => r.valid).length
  const batchOverLimit = validBatchCount > MAX_BATCH

  const onBatchCreate = async () => {
    const valid = parsedBatchRows.filter((r) => r.valid)
    if (valid.length === 0) {
      message.warning('没有可提交的合法行')
      return
    }
    if (valid.length > MAX_BATCH) {
      message.warning(`单次最多提交 ${MAX_BATCH} 条，请精简`)
      return
    }
    setBatchSubmitting(true)
    try {
      const res = await auditPointsApi.createMany(code, {
        item_id: activeItemId!,
        points: valid.map((r) => ({
          item_id: activeItemId!,
          label_cn: r.label_cn,
          scope_text: r.scope_text || undefined,
          risk_level: r.risk_level,
          is_enabled: r.is_enabled,
        })),
      })
      setBatchResult(res)
      setBatchOpen(false)
      if (res.failed > 0) {
        message.warning(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`)
        setBatchResultOpen(true)
      } else {
        message.success(`批量新增 ${res.succeeded} 条成功`)
      }
      setBatchText('')
      void fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      message.error(detail ?? '提交失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const onImportFile: UploadProps['beforeUpload'] = async (file) => {
    setBatchImporting(true)
    try {
      const { rows, errors } = await parseImportFile(file as File)
      if (errors.length > 0 || rows.length === 0) {
        message.error(errors[0] ?? '文件无有效数据')
        return false
      }
      setBatchText(rowsToText(rows))
      message.success(`已导入 ${rows.length} 行，可在下方预览调整`)
      return false
    } catch (e) {
      message.error('解析失败：' + (e as Error).message)
      return false
    } finally {
      setBatchImporting(false)
    }
  }

  const setPointLibrary = (
    row: DraftPoint,
    rawValue: string | number | undefined,
  ) => {
    if (rawValue == null || rawValue === '') {
      updateLocal(row.id, {
        custom_wordset_id: null,
        custom_reply_library_id: null,
        _libType: null,
      })
      return
    }
    const [kind, idStr] = String(rawValue).split(':')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return
    if (kind === 'reply') {
      updateLocal(row.id, {
        custom_wordset_id: null,
        custom_reply_library_id: id,
        _libType: 'reply',
      })
      return
    }
    const libType: LibType = kind === 'image' ? 'image' : 'wordset'
    updateLocal(row.id, {
      custom_wordset_id: id,
      custom_reply_library_id: null,
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
          libType === 'reply' && row.custom_reply_library_id != null
            ? `reply:${row.custom_reply_library_id}`
            : libType != null && row.custom_wordset_id != null
              ? `${libType}:${row.custom_wordset_id}`
              : undefined
        const hasAny =
          imageSetOptions.length > 0 ||
          wordsetOptions.length > 0 ||
          replyLibraryOptions.length > 0
        return (
          <Select
            placeholder={
              hasAny ? '选择关联库（图库 / 词库 / 代答库）' : '暂无可用关联库'
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
              ...replyLibraryOptions.map((r) => ({
                value: `reply:${r.id}`,
                label: `[代答] ${r.name}`,
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
          onClick={openBatchModal}
        >
          批量新增
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
        title="批量新增审核点"
        open={batchOpen}
        onCancel={() => {
          if (batchSubmitting) return
          setBatchOpen(false)
        }}
        onOk={onBatchCreate}
        confirmLoading={batchSubmitting}
        okText={validBatchCount > 0 ? `提交 ${validBatchCount} 条` : '提交'}
        okButtonProps={{
          disabled: validBatchCount === 0 || batchOverLimit,
        }}
        cancelText="取消"
        width={760}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="按行粘贴，每行格式：审核点 | 审核内容 | 风险等级"
            description={
              <span>
                例：<code>一号领导 | 画面中出现核心领导人物 | 高风险</code>
                <br />
                风险等级可选（默认 中风险），可选值：低风险 / 中风险 / 高风险；
                以 <code>#</code> 开头的行作为注释忽略。
                xlsx / csv 首行表头必须包含 列名 <code>审核点</code> / <code>审核内容</code> / <code>风险等级</code>。
              </span>
            }
          />
          <Space size={8} align="center" wrap>
            <Upload
              accept=".txt,.csv,.xlsx,.xls"
              beforeUpload={onImportFile}
              showUploadList={false}
              maxCount={1}
              disabled={batchSubmitting || batchImporting}
            >
              <Button icon={<InboxOutlined />} loading={batchImporting}>
                从文件导入（.txt / .csv / .xlsx）
              </Button>
            </Upload>
            <Button
              size="small"
              onClick={() => setBatchText(SAMPLE_BATCH_TEXT)}
              disabled={batchSubmitting || batchImporting}
            >
              填入示例
            </Button>
            <Button
              size="small"
              onClick={() => setBatchText('')}
              disabled={batchSubmitting || batchImporting}
            >
              清空
            </Button>
          </Space>
          <Input.TextArea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            rows={8}
            placeholder={
              '# 在此粘贴批量内容\n一号领导 | 画面中出现 | 高风险\n毒品 | 针管/白色粉状 | 中风险'
            }
            style={{ fontFamily: 'Menlo, Monaco, monospace' }}
            disabled={batchSubmitting}
          />
          {batchOverLimit && (
            <Alert
              type="warning"
              showIcon
              message={`有效行 ${validBatchCount} 已超过单次最大 ${MAX_BATCH} 条，请精简后再提交`}
            />
          )}
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Text strong>预览（{parsedBatchRows.length} 行）</Text>
              <Tag color={validBatchCount > 0 ? 'green' : 'default'}>
                有效 {validBatchCount}
              </Tag>
              {parsedBatchRows.length - validBatchCount > 0 && (
                <Tag color="red">
                  跳过 {parsedBatchRows.length - validBatchCount}
                </Tag>
              )}
            </Space>
            <Table<ParsedBatchRow>
              size="small"
              rowKey={(r) => `${r.displayIndex}-${r.label_cn}`}
              dataSource={parsedBatchRows}
              pagination={false}
              locale={{
                emptyText: '尚无内容，在上方文本框粘贴后预览自动出现',
              }}
              columns={[
                {
                  title: '#',
                  dataIndex: 'displayIndex',
                  width: 56,
                  render: (n: number) => <Tag color="blue">{n}</Tag>,
                },
                {
                  title: '审核点',
                  dataIndex: 'label_cn',
                  render: (v: string, row) =>
                    row.valid ? (
                      <span>{v}</span>
                    ) : (
                      <span style={{ color: '#94A3B8' }}>
                        （{v || '空'}）
                      </span>
                    ),
                },
                {
                  title: '审核内容',
                  dataIndex: 'scope_text',
                  render: (v: string) =>
                    v || <span style={{ color: '#94A3B8' }}>—</span>,
                },
                {
                  title: '风险等级',
                  dataIndex: 'risk_level',
                  width: 110,
                },
                {
                  title: '状态',
                  width: 200,
                  render: (_v, row) =>
                    row.valid ? (
                      <Tag color="green">有效</Tag>
                    ) : (
                      <Tag color="red">{row.error}</Tag>
                    ),
                },
              ]}
            />
          </div>
        </Space>
      </Modal>

      <Drawer
        title="批量新增失败明细"
        open={batchResultOpen}
        onClose={() => setBatchResultOpen(false)}
        width={640}
        extra={
          <Button onClick={() => setBatchResultOpen(false)}>关闭</Button>
        }
      >
        {batchResult && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space>
              <Tag color="green">成功 {batchResult.succeeded}</Tag>
              <Tag color="red">失败 {batchResult.failed}</Tag>
            </Space>
            <Table
              size="small"
              rowKey={(r) => `${r.index}-${r.label_cn}`}
              dataSource={batchResult.items.filter(
                (it) => it.status === 'error',
              )}
              pagination={false}
              locale={{ emptyText: '没有失败行' }}
              columns={[
                {
                  title: '#',
                  dataIndex: 'index',
                  width: 56,
                  render: (n: number) => <Tag color="red">{n + 1}</Tag>,
                },
                {
                  title: '审核点',
                  dataIndex: 'label_cn',
                  render: (v: string) =>
                    v || (
                      <span style={{ color: '#94A3B8' }}>（空）</span>
                    ),
                },
                {
                  title: '失败原因',
                  dataIndex: 'error',
                  render: (v?: string) =>
                    v ? <Tag color="red">{v}</Tag> : '—',
                },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </div>
  )
}