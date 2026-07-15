import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  App,
  Breadcrumb,
  Button,
  Card,
  Collapse,
  Radio,
  Space,
  Steps,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { RocketOutlined, RobotOutlined } from '@ant-design/icons'
import { materialsApi } from '@/api/materials'
import StrategyForm, { type StrategyFormValues } from '@/components/task-create/StrategyForm'
import { TaskDispositionOverridePanel } from '@/components/task-create/TaskDispositionOverridePanel'
import ReferenceFields from '@/components/task-create/ReferenceFields'
import type { ReferenceFormValues } from '@/lib/referenceFields'
import { countFilledReference } from '@/lib/referenceFields'
import UploadArea, { type UploadItem } from '@/components/task-create/UploadArea'
import MaterialPicker from '@/components/task-create/MaterialPicker'
import AnalysisPanel, {
  type ParsedFileItem,
  type ParsedPickedItem,
} from '@/components/task-create/AnalysisPanel'
import { useAuthStore } from '@/store'
import { canManageBackend } from '@/lib/permissions'
import type { MaterialType, StrategyHumanReview } from '@/types/domain'
import { strategiesApi } from '@/api/strategies'
import { colors } from '@/styles/theme'
import { generateTaskName } from '@/lib/taskName'
const { Text } = Typography

type TabKind = MaterialType | 'audio'

// v11: "素材包" tab is hidden from the create-task entry point per product
// decision (postponed to a later iteration). The packages API + components
// are kept untouched for backward compatibility.
const TYPE_TABS: { key: TabKind; label: string; backendType: MaterialType | null }[] = [
  { key: 'text', label: '文本审核', backendType: 'text' },
  { key: 'image', label: '图片审核', backendType: 'image' },
  { key: 'video', label: '视频审核', backendType: 'video' },
  { key: 'pdf', label: '文档审核', backendType: 'pdf' },
  { key: 'audio', label: '语音审核', backendType: 'video' },
]

type SourceMode = 'upload' | 'library'
type CreateMode = 'single' | 'bulk'

const BULK_LIMIT = 50

const createModeOptions = [
  { value: 'single' as const, label: '单件审核', hint: '一次提交一个素材' },
  { value: 'bulk' as const, label: '批量审核', hint: '一次提交多个素材' },
]

const sourceOptions = [
  { value: 'upload' as const, label: '本地上传' },
  { value: 'library' as const, label: '从素材库选择' },
]

export default function CreateTaskPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [params] = useSearchParams()

  const canPickStrategy = canManageBackend(user) || user?.role === 'mlr'

  const initialType = (params.get('type') as TabKind | null) || 'text'
  const initialMaterialId = params.get('material') ? Number(params.get('material')) : null
  const initialSourceMode: SourceMode = initialMaterialId ? 'library' : 'upload'

  const [type, setType] = useState<TabKind>(
    TYPE_TABS.find((t) => t.key === initialType) ? initialType : 'text',
  )
  const [createMode, setCreateMode] = useState<CreateMode>('single')
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialSourceMode)

  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const [pickedIds, setPickedIds] = useState<number[]>(
    initialMaterialId ? [initialMaterialId] : [],
  )
  const [pickedCache, setPickedCache] = useState<Record<number, ParsedPickedItem>>({})
  const [selectedMaterialDetail, setSelectedMaterialDetail] = useState<
    { title: string; status: string; mime?: string } | undefined
  >()

  const [strategyForm, setStrategyForm] = useState<StrategyFormValues>({})
  const [referenceForm, setReferenceForm] = useState<ReferenceFormValues>({})
  const [submitting, setSubmitting] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  // 任务级 step-3 处置覆盖：undefined 或全空对象表示「走策略默认值」
  const [overrideHumanReview, setOverrideHumanReview] = useState<Partial<StrategyHumanReview> | undefined>(undefined)
  // 选中策略的完整定义（用于预览 step-3 默认值）
  const [selectedStrategyDefault, setSelectedStrategyDefault] = useState<Record<string, unknown> | null>(null)

  // 当策略变化时拉取完整定义
  useEffect(() => {
    const sid = strategyForm.strategy_id
    if (!sid) {
      setSelectedStrategyDefault(null)
      return
    }
    strategiesApi
      .get(sid)
      .then((s) => {
        setSelectedStrategyDefault((s.definition as Record<string, unknown>) ?? null)
      })
      .catch(() => setSelectedStrategyDefault(null))
  }, [strategyForm.strategy_id])

  const currentBackendType: MaterialType = useMemo(
    () => TYPE_TABS.find((t) => t.key === type)?.backendType ?? 'text',
    [type],
  )
  const isAudioTab = type === 'audio'

  useEffect(() => {
    if (initialMaterialId && !pickedIds.includes(initialMaterialId)) {
      setPickedIds([initialMaterialId])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (sourceMode !== 'library') {
      setPickedCache({})
      setSelectedMaterialDetail(undefined)
      return
    }
    const missing = pickedIds.filter((id) => !pickedCache[id])
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const entries: [number, ParsedPickedItem][] = []
      for (const id of missing) {
        try {
          const m = await materialsApi.get(id)
          entries.push([
            id,
            {
              id: m.id,
              title: m.title,
              material_type: m.material_type,
              status: m.status,
              updated_at: m.updated_at,
            },
          ])
          if (id === pickedIds[0]) {
            const v = m.versions?.[0]
            setSelectedMaterialDetail({
              title: m.title,
              status: m.status,
              mime: v?.mime_type,
            })
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled) {
        setPickedCache((prev) => {
          const next = { ...prev }
          for (const [k, v] of entries) next[k] = v
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pickedIds, sourceMode, pickedCache])

  const pickedItems: ParsedPickedItem[] = useMemo(
    () => pickedIds.map((id) => pickedCache[id]).filter(Boolean) as ParsedPickedItem[],
    [pickedIds, pickedCache],
  )

  const steps = useMemo(() => {
    return [
      { key: 'mode', label: '创建方式', completed: uploadItems.length > 0 || pickedIds.length > 0 },
      { key: 'material', label: '素材', completed: uploadItems.length > 0 || pickedIds.length > 0 },
      { key: 'config', label: '审核配置', completed: false },
    ]
  }, [uploadItems.length, pickedIds.length])

  const handleStepClick = (index: number) => {
    const ref = stepRefs.current[index]
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentStep(index)
    }
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = stepRefs.current.indexOf(entry.target as HTMLDivElement)
            if (index !== -1) setCurrentStep(index)
          }
        })
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0.1 },
    )

    stepRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [steps.length])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && currentStep < steps.length - 1) {
        handleStepClick(currentStep + 1)
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        handleStepClick(currentStep - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentStep, steps.length])

  const onTypeChange = (next: string) => {
    setType(next as TabKind)
    setUploadItems([])
    setPickedIds([])
    setPickedCache({})
    setSelectedMaterialDetail(undefined)
  }

  const onSourceChange = (next: SourceMode) => {
    if (next === sourceMode) return
    setSourceMode(next)
    if (next === 'upload') setPickedIds([])
    else setUploadItems([])
  }

  const onCreateModeChange = (next: CreateMode) => {
    if (next === createMode) return
    setCreateMode(next)
    if (next === 'single' && (uploadItems.length > 1 || pickedIds.length > 1)) {
      setUploadItems(uploadItems.slice(0, 1))
      setPickedIds(pickedIds.slice(0, 1))
    }
  }

  const effectiveCount = useMemo(
    () => {
      return sourceMode === 'upload' ? uploadItems.length : pickedIds.length
    },
    [sourceMode, uploadItems, pickedIds],
  )

  // v11: task name is auto-generated. We cache the random suffix for the
  // lifetime of the page so siblings in a bulk create share a base.
  const [sharedSuffix] = useState(() =>
    Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, '0'),
  )
  const autoTaskName = useMemo(() => {
    const label = TYPE_TABS.find((t) => t.key === type)?.label ?? '素材审核'
    // 去掉"审核"后缀避免重复（如"图片审核" -> "图片"）
    const shortLabel = label.replace(/审核$/, '')
    return generateTaskName({
      typeLabel: shortLabel,
      count: effectiveCount,
      sharedSuffix,
    })
  }, [type, effectiveCount, sharedSuffix])

  const validateBeforeSubmit = (): { ok: true; count: number } | { ok: false; reason: string } => {
    if (effectiveCount === 0) return { ok: false, reason: '请先选择或上传至少 1 个素材' }
    if (createMode === 'bulk' && effectiveCount > BULK_LIMIT) {
      return { ok: false, reason: `批量最多 ${BULK_LIMIT} 个素材` }
    }
    if (sourceMode === 'upload' && type === 'text') {
      const empty = uploadItems.find((u) => !u.textBody.trim())
      if (empty) return { ok: false, reason: '请填写所有文案正文' }
    }
    return { ok: true, count: effectiveCount }
  }

  const buildTags = (): Record<string, unknown> => {
    const t: Record<string, unknown> = { source: 'create_task_page' }
    if (isAudioTab) t.original_kind = 'audio'
    if (strategyForm.strategy_id) t.strategy_id = strategyForm.strategy_id
    if (referenceForm.channels?.length) t.channels = referenceForm.channels
    if (referenceForm.industry) t.industry = referenceForm.industry
    if (referenceForm.keyword) t.keyword = referenceForm.keyword
    if (referenceForm.product_sku) t.product_sku = referenceForm.product_sku
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
    await materialsApi.submit(created.id, {
      task_name: taskName,
      override_human_review: overrideHumanReview,
    })
    return created.id
  }

  const submitPickedMaterial = async (mid: number, taskName: string): Promise<number> => {
    const cur = await materialsApi.get(mid)
    const mergedTags = { ...(cur.tags || {}), ...buildTags() }
    await materialsApi.update(mid, { tags: mergedTags })
    await materialsApi.submit(mid, {
      task_name: taskName,
      override_human_review: overrideHumanReview,
    })
    return mid
  }

  const onSubmit = async () => {
    const v = validateBeforeSubmit()
    if (!v.ok) {
      message.warning(v.reason)
      return
    }
    setSubmitting(true)
    try {
      // Build per-task names aligned with autoTaskName.items
      const names = autoTaskName.items
      if (sourceMode === 'upload') {
        if (createMode === 'bulk') {
          for (let i = 0; i < uploadItems.length; i++) {
            await createOneFromUpload(uploadItems[i], names[i] ?? names[0])
          }
        } else {
          await createOneFromUpload(uploadItems[0], names[0])
        }
      } else if (createMode === 'bulk') {
        for (let i = 0; i < pickedIds.length; i++) {
          await submitPickedMaterial(pickedIds[i], names[i] ?? names[0])
        }
      } else {
        await submitPickedMaterial(pickedIds[0], names[0])
      }
      message.success(`已创建 ${v.count} 个审核任务`)
      navigate('/tasks')
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      message.error(err.response?.data?.detail || err.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const currentMime = selectedMaterialDetail?.mime
  const rightTabKind =
    isAudioTab && currentMime?.startsWith('audio/') ? 'audio' : currentBackendType
  const parseItems: ParsedFileItem[] = uploadItems

  const referenceFilledCount = countFilledReference(referenceForm)

  const renderReviewConfigCard = (key: string | number) => (
    <Card title="审核配置" key={key}>
      {/* 第 1 层：策略（必选） */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: colors.foreground, marginBottom: 8 }}>
          策略 <span style={{ color: colors.destructive }}>*</span>
        </div>
        {canPickStrategy ? (
          <StrategyForm value={strategyForm} onChange={setStrategyForm} />
        ) : (
          <Typography.Text style={{ color: colors.secondary, fontSize: 13 }}>
            提交者使用默认策略；如需指定审核策略，请联系管理员配置。
          </Typography.Text>
        )}
      </div>

      {/* 第 2 层：reference 折叠面板（默认收起） */}
      <div style={{ marginBottom: 16 }}>
        <Collapse
          ghost
          items={[
            {
              key: 'reference',
              label: (
                <Space>
                  <span style={{ fontSize: 13 }}>更多配置</span>
                  {referenceFilledCount > 0 && (
                    <Tag color="blue" style={{ margin: 0 }}>
                      已填 {referenceFilledCount}
                    </Tag>
                  )}
                </Space>
              ),
              children: (
                <ReferenceFields value={referenceForm} onChange={setReferenceForm} />
              ),
            },
          ]}
        />
      </div>

      {/* 第 3 层：本任务处置覆盖（仅 admin/mlr 可改 step-3 字段；submitter 也能预览） */}
      {canPickStrategy && (
        <div style={{ marginBottom: 16 }}>
          <TaskDispositionOverridePanel
            strategyId={strategyForm.strategy_id}
            strategyDefaultHumanReview={selectedStrategyDefault?.['human_review'] as Record<string, unknown> | undefined ?? null}
            value={overrideHumanReview}
            onChange={setOverrideHumanReview}
          />
        </div>
      )}

    </Card>
  )

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/tasks')}>审核任务</a> },
          { title: '创建审核任务' },
        ]}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          创建审核任务
        </Typography.Title>
      </div>

      {/* 任务名称（自动生成预览） */}
      <Card size="small" style={{ marginBottom: 24 }}>
        <Space size={12} wrap>
          <Text type="secondary">任务名称</Text>
          <Tag color="blue" icon={<RobotOutlined />} style={{ margin: 0 }}>
            自动生成
          </Tag>
          {effectiveCount > 1 ? (
            <Tooltip
              title={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {autoTaskName.items.map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                </div>
              }
            >
              <Space size={4}>
                <Text code style={{ fontSize: 12 }}>{autoTaskName.base}</Text>
                <Tag color="default" style={{ margin: 0 }}>批量 · {effectiveCount} 个</Tag>
              </Space>
            </Tooltip>
          ) : (
            <Text code style={{ fontSize: 13 }}>{autoTaskName.items[0] ?? autoTaskName.base}</Text>
          )}
        </Space>
      </Card>

      <Tabs
        activeKey={type}
        onChange={onTypeChange}
        style={{ marginBottom: 24 }}
        items={TYPE_TABS.map((t) => ({ key: t.key, label: t.label }))}
      />

      <Card style={{ marginBottom: 24 }}>
        <Steps
          current={currentStep}
          onChange={handleStepClick}
          items={steps.map((s) => ({
            title: s.label,
            status: s.completed ? 'finish' : undefined,
          }))}
        />
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card
            title="创建方式与素材来源"
            extra={
              <Text style={{ fontSize: 12, color: colors.secondary }}>
                当前选中 <span style={{ color: colors.foreground, fontWeight: 600 }}>{effectiveCount}</span> 个
              </Text>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.foreground, marginBottom: 8 }}>
                  创建方式
                </div>
                <Radio.Group
                  value={createMode}
                  onChange={(e) => onCreateModeChange(e.target.value)}
                >
                  {createModeOptions.map((opt) => (
                    <Radio.Button key={opt.value} value={opt.value}>
                      {opt.label}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.foreground, marginBottom: 8 }}>
                  素材来源
                </div>
                <Radio.Group
                  value={sourceMode}
                  onChange={(e) => onSourceChange(e.target.value)}
                >
                  {sourceOptions.map((opt) => (
                    <Radio.Button key={opt.value} value={opt.value}>
                      {opt.label}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              </div>
            </div>
          </Card>

          <Card
            title="素材"
            extra={
              <Text style={{ fontSize: 12, color: colors.secondary }}>
                最多 {BULK_LIMIT} 个
              </Text>
            }
          >
            {sourceMode === 'upload' ? (
              <UploadArea
                type={currentBackendType}
                allowAudio={isAudioTab}
                multiple={createMode === 'bulk'}
                value={uploadItems}
                onChange={setUploadItems}
                maxCount={BULK_LIMIT}
              />
            ) : (
              <MaterialPicker
                type={currentBackendType}
                selectedIds={pickedIds}
                onChange={setPickedIds}
                maxCount={BULK_LIMIT}
              />
            )}
          </Card>

          {renderReviewConfigCard('normal-config')}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingTop: 4,
            }}
          >
            <Text style={{ color: colors.secondary, fontSize: 12 }}>
              按下「创建任务」即代表你已确认素材和审核配置无误。
            </Text>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => navigate('/tasks')}>取消</Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={submitting}
                onClick={onSubmit}
              >
                创建任务{effectiveCount > 1 ? `（${effectiveCount} 个）` : ''}
              </Button>
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 80 }}>
          <Card title="解析结果">
            <AnalysisPanel
              mode={sourceMode}
              uploadItems={parseItems}
              pickedItems={pickedItems}
              backendType={rightTabKind === 'audio' ? 'video' : (rightTabKind as MaterialType)}
              selectedMaterialDetail={selectedMaterialDetail}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
