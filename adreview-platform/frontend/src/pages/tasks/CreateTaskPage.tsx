import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Select,
  Space,
  Tabs,
  Typography,
} from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import { materialsApi } from '@/api/materials'
import { strategiesApi } from '@/api/strategies'
import UploadArea, { type UploadItem } from '@/components/task-create/UploadArea'
import AnalysisPanel, {
  type ParsedFileItem,
} from '@/components/task-create/AnalysisPanel'
import type { MaterialType, Strategy } from '@/types/domain'
import { colors } from '@/styles/theme'

type TabKind = MaterialType | 'audio'
type DetectionMode = 'single' | 'bulk'

const TYPE_TABS: { key: TabKind; label: string; backendType: MaterialType | null }[] = [
  { key: 'text', label: '文本审核', backendType: 'text' },
  { key: 'image', label: '图片审核', backendType: 'image' },
  { key: 'video', label: '视频审核', backendType: 'video' },
  { key: 'pdf', label: '文档审核', backendType: 'pdf' },
  { key: 'audio', label: '语音审核', backendType: 'video' },
]

const MODE_TABS: { key: DetectionMode; label: string }[] = [
  { key: 'single', label: '单条检测' },
  { key: 'bulk', label: '批量检测' },
]

const BULK_LIMIT = 50

export default function CreateTaskPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const initialType = (params.get('type') as TabKind | null) || 'text'

  const [detectionMode, setDetectionMode] = useState<DetectionMode>('single')
  const [type, setType] = useState<TabKind>(
    TYPE_TABS.find((t) => t.key === initialType) ? initialType : 'text',
  )
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const [strategyId, setStrategyId] = useState<number | undefined>(undefined)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    strategiesApi
      .list({ size: 100 })
      .then((s) => {
        const enabled = s.items.filter((x) => x.is_active)
        setStrategies(enabled)
        if (enabled.length > 0 && strategyId == null) {
          setStrategyId(enabled[0].id)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentBackendType: MaterialType =
    TYPE_TABS.find((t) => t.key === type)?.backendType ?? 'text'
  const isAudioTab = type === 'audio'
  const isBulkMode = detectionMode === 'bulk'
  const maxCount = isBulkMode ? BULK_LIMIT : 1

  const onTypeChange = (next: string) => {
    setType(next as TabKind)
    setUploadItems([])
  }

  const onModeChange = (next: string) => {
    const m = next as DetectionMode
    setDetectionMode(m)
    if (m === 'single' && uploadItems.length > 1) {
      setUploadItems(uploadItems.slice(0, 1))
    }
  }

  const effectiveCount = uploadItems.length

  const validateBeforeSubmit = (): { ok: true; count: number } | { ok: false; reason: string } => {
    if (effectiveCount === 0) return { ok: false, reason: '请先选择或上传至少 1 个素材' }
    if (effectiveCount > BULK_LIMIT) {
      return { ok: false, reason: `单次最多 ${BULK_LIMIT} 个素材` }
    }
    if (type === 'text') {
      const empty = uploadItems.find((u) => !u.textBody.trim())
      if (empty) return { ok: false, reason: '请填写所有文案正文' }
    }
    return { ok: true, count: effectiveCount }
  }

  const buildTags = (): Record<string, unknown> => {
    const t: Record<string, unknown> = { source: 'create_task_page' }
    if (isAudioTab) t.original_kind = 'audio'
    if (strategyId) t.strategy_id = strategyId
    return t
  }

  const createOneFromUpload = async (item: UploadItem, taskName: string): Promise<number> => {
    const title = item.file ? item.file.name.replace(/\.[^.]+$/, '') : '未命名文案'
    const created = await materialsApi.create({
      title,
      material_type: currentBackendType,
      tags: buildTags(),
    })
    if (item.file) {
      await materialsApi.uploadVersion(created.id, item.file, item.textBody || undefined)
    } else if (type === 'text' && item.textBody) {
      const blob = new Blob([item.textBody], { type: 'text/plain' })
      const file = new File([blob], 'text.txt', { type: 'text/plain' })
      await materialsApi.uploadVersion(created.id, file, item.textBody)
    }
    await materialsApi.submit(created.id, { task_name: taskName })
    return created.id
  }

  const onSubmit = async () => {
    const v = validateBeforeSubmit()
    if (!v.ok) {
      message.warning(v.reason)
      return
    }
    setSubmitting(true)
    try {
      for (let i = 0; i < uploadItems.length; i++) {
        await createOneFromUpload(uploadItems[i], `在线审核-${Date.now()}-${i + 1}`)
      }
      message.success(`已提交 ${v.count} 个审核任务`)
      navigate('/overview')
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      message.error(err.response?.data?.detail || err.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const parseItems: ParsedFileItem[] = uploadItems

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          在线审核
        </Typography.Title>
      </div>

      <Tabs
        activeKey={detectionMode}
        onChange={onModeChange}
        style={{ marginBottom: 16 }}
        items={MODE_TABS.map((t) => ({ key: t.key, label: t.label }))}
      />

      <Tabs
        activeKey={type}
        onChange={onTypeChange}
        style={{ marginBottom: 24 }}
        items={TYPE_TABS.map((t) => ({ key: t.key, label: t.label }))}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: colors.foreground, marginBottom: 8 }}>
                审核策略
              </div>
              <Select
                value={strategyId}
                onChange={(v) => setStrategyId(v)}
                placeholder="请选择在审核策略列表中可用的审核策略"
                options={strategies.map((s) => ({ value: s.id, label: s.name }))}
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
              />
            </div>
          </Card>

          <Card>
            <UploadArea
              type={currentBackendType}
              allowAudio={isAudioTab}
              multiple={isBulkMode}
              value={uploadItems}
              onChange={setUploadItems}
              maxCount={maxCount}
            />
          </Card>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              paddingTop: 4,
            }}
          >
            <Space>
              <Button onClick={() => navigate('/overview')}>取消</Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={submitting}
                onClick={onSubmit}
              >
                提交审核{effectiveCount > 1 ? `（${effectiveCount} 个）` : ''}
              </Button>
            </Space>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 80 }}>
          <Card title="在线审核结果">
            <AnalysisPanel
              mode="upload"
              uploadItems={parseItems}
              pickedItems={[]}
              backendType={currentBackendType}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}