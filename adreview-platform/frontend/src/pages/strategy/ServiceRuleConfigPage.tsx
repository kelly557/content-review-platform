import { useEffect, useMemo, useState } from 'react'
import {
  Table,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Typography,
  App,
  type TableColumnsType,
} from 'antd'
import {
  ArrowLeftOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { useParams, Link, useLocation } from 'react-router-dom'
import { wordsetsApi } from '@/api/wordsets'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint, WordSet } from '@/types/domain'

type WordSetOption = WordSet

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
  const [activeItemName, setActiveItemName] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [pendingReset, setPendingReset] = useState<DraftPoint[] | null>(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const [allPoints, wss, aItems] = await Promise.all([
        auditPointsApi.list(code),
        wordsetsApi.list({ size: 200 }).then((p) => p.items).catch(() => [] as WordSetOption[]),
        auditItemsApi.list(code).catch(() => [] as AuditItem[]),
      ])
      setPoints(allPoints.map((p) => ({ ...p, _dirty: false })))
      setWordsetOptions(wss)
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

  const validateAll = (): string | null => {
    for (const p of filteredPoints) {
      if (p.medium_threshold >= p.high_threshold) {
        return `「${p.label_cn || p.code}」中风险分必须 < 高风险分`
      }
      if (p.medium_threshold < 0 || p.medium_threshold > 100) {
        return `「${p.label_cn || p.code}」中风险分需在 0-100 范围内`
      }
      if (p.high_threshold < 0 || p.high_threshold > 100) {
        return `「${p.label_cn || p.code}」高风险分需在 0-100 范围内`
      }
    }
    return null
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
    const err = validateAll()
    if (err) {
      message.error(err)
      return
    }
    const dirtyItems = points.filter((p) => p._dirty)
    if (dirtyItems.length === 0) {
      message.info('没有改动')
      return
    }
    setSaving(true)
    try {
      for (const p of dirtyItems) {
        await auditPointsApi.update(code, p.id, {
          medium_threshold: p.medium_threshold,
          high_threshold: p.high_threshold,
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
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onReset = async () => {
    if (window.confirm('确认恢复默认分值？将覆盖当前激活项的所有审核点的中/高风险分。')) {
      try {
        await auditPointsApi.reset(code)
        message.success('已恢复默认分值')
        void fetch()
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        message.error(detail ?? '恢复失败')
      }
    }
  }

  // Split by whether the point is a "lib" (custom library/wordset entry).
  const mainPoints = useMemo(
    () => filteredPoints.filter((p) => !p.code.endsWith('_lib')),
    [filteredPoints],
  )
  const libPoints = useMemo(
    () => filteredPoints.filter((p) => p.code.endsWith('_lib')),
    [filteredPoints],
  )

  const mainColumns: TableColumnsType<DraftPoint> = [
    {
      title: '标签值',
      dataIndex: 'label',
      width: '18%',
      render: (_v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#020617', fontWeight: 500 }}>
            {row.label_cn || row.label}
          </span>
          <Text
            type="secondary"
            style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
          >
            {row.code}
          </Text>
        </div>
      ),
    },
    {
      title: '含义',
      dataIndex: 'description',
      width: '24%',
      render: (v: string | null) => (
        <span style={{ color: '#020617' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: (
        <Space size={4}>
          中风险分
          <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
        </Space>
      ),
      dataIndex: 'medium_threshold',
      width: '16%',
      render: (_v, row) => (
        <Space size={4}>
          <InputNumber
            min={0}
            max={100}
            step={0.01}
            value={row.medium_threshold}
            onChange={(v) =>
              updateLocal(row.id, { medium_threshold: Number(v ?? 0) })
            }
            style={{ width: 90 }}
            size="small"
            aria-label={`${row.label_cn || row.code} 中风险分`}
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            ~ {(row.high_threshold - 0.01).toFixed(2)}
          </Text>
        </Space>
      ),
    },
    {
      title: (
        <Space size={4}>
          高风险分
          <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
        </Space>
      ),
      dataIndex: 'high_threshold',
      width: '16%',
      render: (_v, row) => (
        <Space size={4}>
          <InputNumber
            min={0}
            max={100}
            step={0.01}
            value={row.high_threshold}
            onChange={(v) =>
              updateLocal(row.id, { high_threshold: Number(v ?? 0) })
            }
            style={{ width: 90 }}
            size="small"
            aria-label={`${row.label_cn || row.code} 高风险分`}
            disabled={!editing}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            ~ 100.00
          </Text>
        </Space>
      ),
    },
    {
      title: '细分检测范围',
      dataIndex: 'scope_text',
      width: '16%',
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
  ]

  const libColumns: TableColumnsType<DraftPoint> = [
    {
      title: '标签值',
      dataIndex: 'label',
      width: '20%',
      render: (_v, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#020617', fontWeight: 500 }}>
            {row.label_cn || row.label}
          </span>
          <Text
            type="secondary"
            style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
          >
            {row.code}_lib
          </Text>
        </div>
      ),
    },
    {
      title: '含义',
      dataIndex: 'description',
      width: '32%',
      render: (v: string | null) => (
        <span style={{ color: '#020617' }}>{v ?? '—'}</span>
      ),
    },
    {
      title: '图库/词库选配',
      dataIndex: 'custom_wordset_id',
      width: '48%',
      render: (_v, row) => (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12, minWidth: 40 }}>
              图库：
            </Text>
            <Select
              disabled
              placeholder="自定义图库 - 即将上线"
              style={{ minWidth: 280 }}
              size="small"
            />
          </Space>
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 12, minWidth: 40 }}>
              词库：
            </Text>
            <Select
              placeholder="选择词库用于命中返回该行标签"
              value={row.custom_wordset_id ?? undefined}
              onChange={(v) =>
                updateLocal(row.id, { custom_wordset_id: v ?? null })
              }
              allowClear
              style={{ minWidth: 280 }}
              size="small"
              disabled={!editing}
              options={[
                ...(wordsetByAction.get('黑名单') ?? []).map((w) => ({
                  value: w.id,
                  label: `[黑名单] ${w.name}`,
                })),
                ...(wordsetByAction.get('白名单') ?? []).map((w) => ({
                  value: w.id,
                  label: `[白名单] ${w.name}`,
                })),
                ...(wordsetByAction.get('需复审') ?? []).map((w) => ({
                  value: w.id,
                  label: `[需复审] ${w.name}`,
                })),
                ...(wordsetByAction.get('标签') ?? []).map((w) => ({
                  value: w.id,
                  label: `[标签] ${w.name}`,
                })),
              ]}
            />
          </Space>
        </Space>
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
        <Text strong>细分场景配置</Text>
        <Button size="small" onClick={onReset}>
          恢复默认分值
        </Button>
      </div>

      <Table<DraftPoint>
        rowKey="id"
        loading={loading}
        dataSource={mainPoints}
        columns={mainColumns}
        pagination={false}
        size="middle"
        scroll={{ x: true }}
        locale={{
          emptyText:
            activeItemId != null ? '该审核项下暂无细分场景' : '暂无规则',
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 24,
          marginBottom: 12,
        }}
      >
        <Text strong>自定义配置图库/词库</Text>
      </div>

      <Table<DraftPoint>
        rowKey="id"
        loading={loading}
        dataSource={libPoints}
        columns={libColumns}
        pagination={false}
        size="middle"
        scroll={{ x: true }}
        locale={{
          emptyText:
            activeItemId != null ? '该审核项下暂无自定义配置' : '暂无规则',
        }}
      />
    </div>
  )
}
