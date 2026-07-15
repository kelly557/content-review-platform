import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
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
  LockOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
  UnlockOutlined,
} from '@ant-design/icons'
import { Link, useLocation, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import { parseImportFile, rowsToText } from '@/lib/auditPointBatchImport'
import type {
  AuditItem,
  AuditPoint,
  AuditPointBatchResult,
} from '@/types/domain'
import { useAuthStore } from '@/store'

const { Title, Text } = Typography

const PACKAGE_BY_MEDIA: Record<string, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const MAX_BATCH = 100

const SAMPLE_BATCH_TEXT = `# 在此粘贴批量内容（每行：审核点 | 审核内容）
一号领导 | 画面中出现核心领导人物
毒品 | 针管或白色粉状物
性感擦边 | 大面积裸露`

interface DraftPoint extends AuditPoint {
  _dirty?: boolean
}

interface ParsedBatchRow {
  displayIndex: number
  label_cn: string
  scope_text: string
  is_enabled: boolean
  valid: boolean
  error: string | null
}

export default function ServiceRuleConfigPage() {
  const { message } = App.useApp()
  const { mediaType, serviceCode, itemId } = useParams<{
    mediaType?: string
    serviceCode?: string
    itemId?: string
  }>()
  const location = useLocation()

  const nestedPackage =
    mediaType && PACKAGE_BY_MEDIA[mediaType] ? PACKAGE_BY_MEDIA[mediaType] : null
  const code = serviceCode ?? nestedPackage ?? null
  const activeItemId =
    itemId != null && !Number.isNaN(Number(itemId)) ? Number(itemId) : null

  const backState = (location.state ?? {}) as { from?: string; fromStep?: 0 | 1 }
  const backTarget = backState.from ?? `/strategies/rules-by-type/${mediaType ?? 'image'}`
  const backStepState =
    backState.fromStep != null ? { step: backState.fromStep } : undefined
  const backLabel = backState.from ? '返回策略审核规则' : '返回规则列表'

  const [points, setPoints] = useState<DraftPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [activeItemName, setActiveItemName] = useState<string | null>(null)
  const [activeItemBuiltin, setActiveItemBuiltin] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftPoint[] | null>(null)

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchResult, setBatchResult] = useState<AuditPointBatchResult | null>(
    null,
  )
  const [batchResultOpen, setBatchResultOpen] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)

  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'root_admin'
  // 通用规则 (is_builtin=true) 编辑权限:admin 与 superadmin 都可;删除权限:仅 superadmin。
  const canEditBuiltin = isSuperadmin || user?.role === 'admin' || user?.role === 'mlr'
  const canDeleteBuiltin = isSuperadmin

  const fetch = useCallback(async () => {
    if (!code || activeItemId == null) return
    setLoading(true)
    try {
      const [ps, items] = await Promise.all([
        auditPointsApi.list(code, { item_id: activeItemId }).catch(() => [] as AuditPoint[]),
        auditItemsApi.list(code).catch(() => [] as AuditItem[]),
      ])
      setPoints(ps.map((p) => ({ ...p })))
      const found = items.find((it) => it.id === activeItemId)
      setActiveItemName(found?.name_cn ?? null)
      setActiveItemBuiltin(found?.is_builtin ?? false)
    } finally {
      setLoading(false)
    }
  }, [code, activeItemId])

  useEffect(() => {
    void fetch()
  }, [fetch])

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

  const onSave = async () => {
    if (!code) return
    const dirty = points.filter((p) => p._dirty)
    if (dirty.length === 0) {
      message.info('没有改动')
      setEditing(false)
      setPendingReset(null)
      return
    }
    setSaving(true)
    try {
      for (const p of dirty) {
        const payload: { label_cn?: string; scope_text?: string } = {}
        if (p.label_cn !== undefined) payload.label_cn = p.label_cn
        if (p.scope_text !== undefined) payload.scope_text = p.scope_text ?? ''
        await auditPointsApi.update(code, p.id, payload)
      }
      message.success('已保存')
      // 重新拉取
      const fresh = await auditPointsApi
        .list(code, { item_id: activeItemId! })
        .catch(() => [] as AuditPoint[])
      setPoints(fresh.map((p) => ({ ...p })))
      setPendingReset(null)
      setEditing(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDeletePoint = async (row: DraftPoint) => {
    if (!code) return
    try {
      await auditPointsApi.remove(code, row.id)
      message.success(`已删除「${row.label_cn || row.code}」`)
      setPoints((prev) => prev.filter((p) => p.id !== row.id))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      message.error(detail ?? '删除失败')
    }
  }

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
      const [name, scope] = parts
      let error: string | null = null
      if (!name) error = '名称不能为空'
      else if (name.length > 64) error = '名称超过 64 字符'
      else if (scope && scope.length > 255) error = '审核内容超过 255 字符'
      out.push({
        displayIndex: display,
        label_cn: name ?? '',
        scope_text: scope ?? '',
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
    if (!code || activeItemId == null) return
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

  const dirty = points.some((p) => p._dirty)
  const dirtyCount = points.filter((p) => p._dirty).length

  const columns: ColumnsType<DraftPoint> = [
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: '32%',
      render: (v: string | null, row) => {
        if (editing) {
          return (
            <Space size={6} align="center">
              <Input
                size="small"
                value={v ?? ''}
                onChange={(e) =>
                  updateLocal(row.id, { label_cn: e.target.value })
                }
                style={{ maxWidth: 320 }}
                placeholder="审核点名称"
              />
            </Space>
          )
        }
        return (
          <Space size={6} align="center">
            <Text strong>{v || row.label || row.code}</Text>
          </Space>
        )
      },
    },
    {
      title: '审核内容',
      dataIndex: 'scope_text',
      render: (v: string | null, row) => {
        if (editing) {
          return (
            <Input.TextArea
              size="small"
              value={v ?? ''}
              onChange={(e) =>
                updateLocal(row.id, { scope_text: e.target.value })
              }
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="审核内容"
            />
          )
        }
        return (
          <div>
            <Text>{v ?? '—'}</Text>
            {row.description && (
              <div style={{ marginTop: 4, color: '#64748B', fontSize: 12 }}>
                {row.description}
              </div>
            )}
          </div>
        )
      },
    },
    {
      title: '操作',
      width: 100,
      render: (_v, row) => {
        const deleteDisabled = row.is_builtin && !canDeleteBuiltin
        return (
          <Popconfirm
            title={`确认删除「${row.label_cn || row.code}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDeletePoint(row)}
          >
            {deleteDisabled ? (
              <Tooltip title="通用审核点:仅超级管理员可删除">
                <Text type="secondary" style={{ cursor: 'not-allowed' }}>
                  <Space size={4}>
                    <DeleteOutlined />
                    删除
                  </Space>
                </Text>
              </Tooltip>
            ) : (
              <a
                style={{ color: '#DC2626' }}
                aria-label={`删除 ${row.label_cn || row.code}`}
              >
                <Space size={4}>
                  <DeleteOutlined />
                  删除
                </Space>
              </a>
            )}
          </Popconfirm>
        )
      },
    },
  ]

  if (!code) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该审核类型暂无规则包"
        style={{ padding: '40px 0' }}
      />
    )
  }

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

      <Space
        size={12}
        align="center"
        wrap
        style={{ marginBottom: 16 }}
      >
        <Title level={3} style={{ margin: 0 }}>
          审核范围配置
        </Title>
        {activeItemName && (
          <Text type="secondary" style={{ fontSize: 14 }}>
            · {activeItemName}
          </Text>
        )}
        {activeItemBuiltin ? (
          <Tooltip
            title={
              isSuperadmin
                ? '通用规则:超级管理员可编辑全部字段'
                : '通用规则:管理员/超级管理员可编辑,仅超级管理员可删除'
            }
          >
            <Space size={6}>
              <Tag color="gold" icon={<LockOutlined />} style={{ margin: 0 }}>
                通用规则
              </Tag>
              {isSuperadmin ? (
                <Tag color="purple" style={{ margin: 0 }}>
                  超级管理员可编辑
                </Tag>
              ) : (
                <Tag style={{ margin: 0, color: '#64748B' }}>
                  仅启用 / 中高分 / 关联词库
                </Tag>
              )}
            </Space>
          </Tooltip>
        ) : (
          <Tooltip title="个性化规则可在下方点击「编辑」修改审核点名称与审核内容">
            <Tag color="blue" icon={<UnlockOutlined />} style={{ margin: 0 }}>
              个性化规则
            </Tag>
          </Tooltip>
        )}
      </Space>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text strong>审核点列表</Text>
        <Space wrap size={12} align="center">
          <Tooltip
            title={
              activeItemBuiltin && !isSuperadmin
                ? '通用审核项下仅超级管理员可新增审核点'
                : '批量新增审核点（最多 100 条）'
            }
          >
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={openBatchModal}
              disabled={
                loading ||
                activeItemId == null ||
                (activeItemBuiltin && !isSuperadmin)
              }
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
            <>
              {!activeItemBuiltin && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  个性化规则可编辑审核点名称与审核内容
                </Text>
              )}
              <Tooltip
                title={
                  activeItemBuiltin
                    ? (canEditBuiltin
                        ? '通用规则:可编辑 (字段受白名单限制)'
                        : '通用规则:您无编辑权限')
                    : '编辑审核点名称与审核内容'
                }
              >
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={enterEdit}
                  disabled={
                    loading ||
                    points.length === 0 ||
                    (activeItemBuiltin && !canEditBuiltin)
                  }
                  aria-label={
                    activeItemBuiltin
                      ? (canEditBuiltin ? '通用规则可编辑' : '通用规则不可编辑')
                      : '编辑审核点名称与审核内容'
                  }
                >
                  编辑
                </Button>
              </Tooltip>
            </>
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
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
<Alert
            type="info"
            showIcon
            message="按行粘贴，每行格式：审核点 | 审核内容"
            description={
              <span>
                例：<code>一号领导 | 画面中出现核心领导人物</code>
                <br />
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
              '# 在此粘贴批量内容\n一号领导 | 画面中出现\n毒品 | 针管/白色粉状'
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