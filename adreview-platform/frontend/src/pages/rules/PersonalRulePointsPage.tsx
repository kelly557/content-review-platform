/**
 * 个性化图片/文本审核规则 — 「审核点和审核内容」编辑页
 *
 * 进入路径：列表点编辑
 * 行为：表格内可逐行新增 / 编辑 / 删除审核点；顶部支持批量新增
 *        （文本粘贴 / csv / xlsx 导入，单次最多 100 条）。
 * 本页不展示「中风险阈值 / 高风险阈值」列（按产品要求）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  type UploadProps,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { parseImportFile, rowsToText } from '@/lib/auditPointBatchImport'
import type {
  AuditItem,
  AuditPoint,
  AuditPointBatchResult,
  MediaTypeKey,
} from '@/types/domain'

const { Title, Text } = Typography

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

const MAX_BATCH = 100

const SAMPLE_BATCH_TEXT = `# 每行格式：审核点 | 审核内容
药品超适应症宣传 | 出现"包治百病"等绝对化用语
违法宣称疗效 | 出现"根治"、"断根"等医疗术语
处方药违规广告 | 出现"凭医师处方销售"等违规字样`

interface DraftPoint extends AuditPoint {
  _dirty?: boolean
  _isNew?: boolean
}

export default function PersonalRulePointsPage() {
  const { mediaType = 'image', itemId } = useParams<{
    mediaType: MediaTypeKey
    itemId: string
  }>()
  const { message } = App.useApp()

  const [item, setItem] = useState<AuditItem | null>(null)
  const [points, setPoints] = useState<DraftPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftPoint[] | null>(null)

  // 批量 Modal state
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchResult, setBatchResult] = useState<AuditPointBatchResult | null>(
    null,
  )
  const [batchResultOpen, setBatchResultOpen] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)

  const numericId = itemId != null && !Number.isNaN(Number(itemId)) ? Number(itemId) : null

  const fetchAll = useCallback(async () => {
    if (numericId == null) return
    setLoading(true)
    try {
      const [byMedia, pts] = await Promise.all([
        auditItemsApi.listByMediaType(mediaType).catch(() => [] as AuditItem[]),
        auditPointsApi.list(
          mediaType === 'doc' ? 'document_audit_pro' :
          mediaType === 'image' ? 'image_audit_pro' :
          mediaType === 'text' ? 'text_audit_pro' :
          mediaType === 'audio' ? 'audio_audit_pro' :
          'video_audit_pro',
          { item_id: numericId },
        ).catch(() => [] as AuditPoint[]),
      ])
      const found = byMedia.find((it) => it.id === numericId) ?? null
      setItem(found)
      setPoints(pts.map((p) => ({ ...p })))
    } finally {
      setLoading(false)
    }
  }, [mediaType, numericId])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const back = `/rules/personal/${mediaType}`

  const enterEdit = () => {
    setPendingReset(points.map((p) => ({ ...p })))
    setEditing(true)
  }

  const cancelEdit = () => {
    if (pendingReset) setPoints(pendingReset.map((p) => ({ ...p })))
    setPendingReset(null)
    setEditing(false)
  }

  const updateLocal = (id: number, patch: Partial<DraftPoint>) => {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch, _dirty: true } : p)),
    )
  }

  const addBlankRow = () => {
    const tempId = -Date.now()
    const next: DraftPoint = {
      id: tempId,
      package_code:
        mediaType === 'doc' ? 'document_audit_pro' :
        mediaType === 'image' ? 'image_audit_pro' :
        mediaType === 'text' ? 'text_audit_pro' :
        mediaType === 'audio' ? 'audio_audit_pro' :
        'video_audit_pro',
      item_id: numericId ?? 0,
      code: '',
      label: '',
      label_cn: '',
      description: null,
      medium_threshold: 0,
      high_threshold: 0,
      scope_text: '',
      risk_level: '中风险',
      is_enabled: true,
      is_builtin: false,
      custom_wordset_id: null,
      sort_order: 0,
      source_document_id: null,
      source_quote: null,
      source_line_no: null,
      created_at: '',
      updated_at: null,
      _isNew: true,
      _dirty: true,
    }
    setPoints((prev) => [...prev, next])
    setEditing(true)
  }

  const onSave = async () => {
    if (!item) return
    const dirty = points.filter((p) => p._dirty)
    const newOnes = dirty.filter((p) => p._isNew)
    const changed = dirty.filter((p) => !p._isNew)
    if (dirty.length === 0) {
      message.info('没有改动')
      setEditing(false)
      setPendingReset(null)
      return
    }
    setSaving(true)
    try {
      // 创建新增
      for (const p of newOnes) {
        if (!p.label_cn.trim()) {
          message.error('新增审核点必须填写名称')
          return
        }
        await auditPointsApi.create(item.package_code, {
          item_id: item.id,
          label_cn: p.label_cn,
          scope_text: p.scope_text ?? undefined,
        })
      }
      // 更新修改
      for (const p of changed) {
        await auditPointsApi.update(item.package_code, p.id, {
          label_cn: p.label_cn,
          scope_text: p.scope_text ?? undefined,
        })
      }
      message.success('已保存')
      await fetchAll()
      setEditing(false)
      setPendingReset(null)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDeletePoint = async (row: DraftPoint) => {
    if (!item) return
    if (row._isNew) {
      setPoints((prev) => prev.filter((p) => p.id !== row.id))
      return
    }
    try {
      await auditPointsApi.remove(item.package_code, row.id)
      message.success(`已删除「${row.label_cn || row.code}」`)
      setPoints((prev) => prev.filter((p) => p.id !== row.id))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const openBatchModal = () => {
    setBatchText('')
    setBatchResult(null)
    setBatchOpen(true)
  }

  interface ParsedBatchRow {
    displayIndex: number
    label_cn: string
    scope_text: string
    valid: boolean
    error: string | null
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
      const [name, scope] = parts
      let error: string | null = null
      if (!name) error = '名称不能为空'
      else if (name.length > 64) error = '名称超过 64 字符'
      else if (scope && scope.length > 255) error = '审核内容超过 255 字符'
      out.push({
        displayIndex: display,
        label_cn: name ?? '',
        scope_text: scope ?? '',
        valid: error === null,
        error,
      })
    }
    return out
  }, [batchText])

  const validBatchCount = parsedBatchRows.filter((r) => r.valid).length
  const batchOverLimit = validBatchCount > MAX_BATCH

  const onBatchCreate = async () => {
    if (!item) return
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
      const res = await auditPointsApi.createMany(item.package_code, {
        item_id: item.id,
        points: valid.map((r) => ({
          item_id: item.id,
          label_cn: r.label_cn,
          scope_text: r.scope_text || undefined,
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
      await fetchAll()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
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

  const dirty = points.some((p) => p._dirty)
  const dirtyCount = points.filter((p) => p._dirty).length

  const columns: ColumnsType<DraftPoint> = [
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: '26%',
      render: (v: string | null, row) => {
        if (editing) {
          return (
            <Input
              size="small"
              value={v ?? ''}
              onChange={(e) => updateLocal(row.id, { label_cn: e.target.value })}
              placeholder="审核点名称"
              maxLength={64}
            />
          )
        }
        return <Text strong>{v || row.label || row.code}</Text>
      },
    },
    {
      title: '审核内容',
      dataIndex: 'scope_text',
      width: '36%',
      render: (v: string | null, row) => {
        if (editing) {
          return (
            <Input.TextArea
              size="small"
              value={v ?? ''}
              onChange={(e) => updateLocal(row.id, { scope_text: e.target.value })}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="审核内容"
              maxLength={255}
            />
          )
        }
        return <Text>{v ?? '—'}</Text>
      },
    },
    {
      title: '操作',
      width: 110,
      render: (_v, row) => (
        <Popconfirm
          title={`确认删除「${row.label_cn || row.code || '未命名'}」？`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDeletePoint(row)}
        >
          <a style={{ color: '#DC2626' }}>
            <Space size={4}>
              <DeleteOutlined />
              删除
            </Space>
          </a>
        </Popconfirm>
      ),
    },
  ]

  if (numericId == null) {
    return (
      <Empty description="缺少 itemId" />
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 12 }} align="center">
        <Link to={back} style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            返回个性化{MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}规则列表
          </Space>
        </Link>
      </Space>

      <Breadcrumb
        style={{ marginBottom: 8 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          { title: `${MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则` },
          { title: <Link to={back}>个性化</Link> },
          { title: '审核点和审核内容' },
        ]}
      />

      <Space size={12} align="center" wrap style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {item?.name_cn ?? '加载中…'}
        </Title>
        <Tag color="green">个性化</Tag>
      </Space>

      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        在此可批量新增、编辑或删除本规则下的审核点。所有修改点击「保存」后生效。
      </Text>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text strong>审核点列表（{points.length}）</Text>
        <Space wrap size={12} align="center">
          <Tooltip title="新增一行空白审核点">
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={addBlankRow}
              disabled={editing && false}
            >
              新增审核点
            </Button>
          </Tooltip>
          <Tooltip title={`批量新增审核点（最多 ${MAX_BATCH} 条）`}>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={openBatchModal}
            >
              批量新增
            </Button>
          </Tooltip>
          {editing ? (
            <>
              <Button
                icon={<RollbackOutlined />}
                onClick={cancelEdit}
                disabled={saving}
              >
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={onSave}
                loading={saving}
                disabled={!dirty}
              >
                {dirtyCount > 0 ? `保存 ${dirtyCount} 处修改` : '保存'}
              </Button>
            </>
          ) : (
            <Tooltip title="启用后可逐行编辑审核点名称、审核内容、风险等级、启停">
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={enterEdit}
                disabled={loading}
              >
                编辑
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>

      <Table<DraftPoint>
        rowKey="id"
        loading={loading}
        dataSource={points}
        columns={columns}
        pagination={false}
        locale={{
          emptyText: editing
            ? '点击「新增审核点」或「批量新增」开始'
            : '该审核项下暂无审核点',
        }}
      />

      {/* ──────────────── 批量新增 Modal ──────────────── */}
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
        width={780}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="每行格式：审核点 | 审核内容"
            description={
              <span>
                例：<code>药品超适应症宣传 | 出现"包治百病"等绝对化用语</code>
                <br />
                以 <code>#</code> 开头的行作为注释忽略。
                支持 <code>.txt / .csv / .xlsx</code> 导入（xlsx 首行表头必须包含「审核点」、「审核内容」）。
              </span>
            }
          />
          <Space size={8} align="center" wrap>
            <Upload
              accept=".txt,.csv,.xlsx,.xls"
              showUploadList={false}
              beforeUpload={onImportFile}
            >
              <Button icon={<InboxOutlined />} loading={batchImporting}>
                从 csv / xlsx 导入
              </Button>
            </Upload>
            <Button onClick={() => setBatchText(SAMPLE_BATCH_TEXT)}>填入示例</Button>
            <Button onClick={() => setBatchText('')}>清空</Button>
            <Text type="secondary">
              已识别 {parsedBatchRows.length} 行 / 合法 {validBatchCount} 条
              {batchOverLimit && (
                <Tag color="red" style={{ marginInlineStart: 8 }}>
                  超过 {MAX_BATCH} 上限
                </Tag>
              )}
            </Text>
          </Space>
          <Input.TextArea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            placeholder={SAMPLE_BATCH_TEXT}
            autoSize={{ minRows: 10, maxRows: 18 }}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
          />
          {parsedBatchRows.some((r) => !r.valid) && (
            <Alert
              type="warning"
              showIcon
              message="存在不合法行"
              description={
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {parsedBatchRows
                    .filter((r) => !r.valid)
                    .map((r) => (
                      <li key={r.displayIndex}>
                        第 {r.displayIndex} 行：{r.error}
                      </li>
                    ))}
                </ul>
              }
            />
          )}
        </Space>
      </Modal>

      <Modal
        title="批量新增结果"
        open={batchResultOpen}
        onCancel={() => setBatchResultOpen(false)}
        footer={[
          <Button
            key="ok"
            type="primary"
            onClick={() => setBatchResultOpen(false)}
          >
            知道了
          </Button>,
        ]}
        width={640}
      >
        {batchResult && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text>
              成功 <b style={{ color: '#16A34A' }}>{batchResult.succeeded}</b> 条 · 失败 <b style={{ color: '#DC2626' }}>{batchResult.failed}</b> 条
            </Text>
            {batchResult.items.filter((it) => it.status === 'error').length > 0 && (
              <Table
                size="small"
                rowKey={(r) => `${r.index}-${r.label_cn}`}
                dataSource={batchResult.items.filter((it) => it.status === 'error')}
                pagination={false}
                columns={[
                  { title: '序号', dataIndex: 'index', width: 80 },
                  { title: '审核点', dataIndex: 'label_cn' },
                  { title: '错误', dataIndex: 'error' },
                ]}
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  )
}