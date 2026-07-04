import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Input, Typography } from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import { materialsApi } from '@/api/materials'
import { packagesApi } from '@/api/materialPackages'
import StrategyForm, { type StrategyFormValues } from '@/components/task-create/StrategyForm'
import UploadArea, { type UploadItem } from '@/components/task-create/UploadArea'
import MaterialPicker from '@/components/task-create/MaterialPicker'
import PackageCreator from '@/components/task-create/PackageCreator'
import AnalysisPanel, {
  type ParsedFileItem,
  type ParsedPickedItem,
} from '@/components/task-create/AnalysisPanel'
import PageHero from '@/components/task-create/PageHero'
import SectionCard from '@/components/task-create/SectionCard'
import { StepIndicator } from '@/components/task-create/StepIndicator'
import StepProgress from '@/components/task-create/StepProgress'
import { useAuthStore } from '@/store'
import type { MaterialType } from '@/types/domain'
import { palette, font } from '@/lib/theme'

const { Text } = Typography

type TabKind = MaterialType | 'audio' | 'package'

const TYPE_TABS: { key: TabKind; label: string; backendType: MaterialType | null }[] = [
  { key: 'text', label: '文本审核', backendType: 'text' },
  { key: 'image', label: '图片审核', backendType: 'image' },
  { key: 'video', label: '视频审核', backendType: 'video' },
  { key: 'pdf', label: '文档审核', backendType: 'pdf' },
  { key: 'audio', label: '语音审核', backendType: 'video' },
  { key: 'package', label: '素材包', backendType: null },
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

  const canPickStrategy = user?.role === 'admin' || user?.role === 'mlr'

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
  const [submitting, setSubmitting] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  const [taskName, setTaskName] = useState('')
  const [packageName, setPackageName] = useState('')
  const [packageDescription, setPackageDescription] = useState('')
  const [packageType, setPackageType] = useState<MaterialType>('image')
  const [packageMaterialIds, setPackageMaterialIds] = useState<number[]>([])

  const isPackageTab = type === 'package'
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
    if (isPackageTab) {
      return [
        { key: 'package', label: '创建素材包', completed: packageName.trim() !== '' && packageMaterialIds.length > 0 },
        { key: 'config', label: '审核配置', completed: false },
      ]
    }
    return [
      { key: 'mode', label: '创建方式', completed: uploadItems.length > 0 || pickedIds.length > 0 },
      { key: 'material', label: '素材', completed: uploadItems.length > 0 || pickedIds.length > 0 },
      { key: 'config', label: '审核配置', completed: false },
    ]
  }, [isPackageTab, uploadItems.length, pickedIds.length, packageName, packageMaterialIds.length])

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
    setPackageName('')
    setPackageDescription('')
    setPackageType('image')
    setPackageMaterialIds([])
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
      if (isPackageTab) return packageMaterialIds.length > 0 ? 1 : 0
      return sourceMode === 'upload' ? uploadItems.length : pickedIds.length
    },
    [isPackageTab, sourceMode, uploadItems, pickedIds, packageMaterialIds],
  )

  const validateBeforeSubmit = (): { ok: true; count: number } | { ok: false; reason: string } => {
    if (!taskName.trim()) return { ok: false, reason: '请输入任务名称' }
    if (isPackageTab) {
      if (!packageName.trim()) return { ok: false, reason: '请输入素材包名称' }
      if (packageMaterialIds.length === 0) return { ok: false, reason: '请至少选择一个素材' }
      return { ok: true, count: 1 }
    }
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
    if (strategyForm.channels?.length) t.channels = strategyForm.channels
    if (strategyForm.industry) t.industry = strategyForm.industry
    if (strategyForm.keyword) t.keyword = strategyForm.keyword
    return t
  }

  const createOneFromUpload = async (item: UploadItem): Promise<number> => {
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

  const submitPickedMaterial = async (mid: number): Promise<number> => {
    const cur = await materialsApi.get(mid)
    const mergedTags = { ...(cur.tags || {}), ...buildTags() }
    await materialsApi.update(mid, { tags: mergedTags })
    await materialsApi.submit(mid, { task_name: taskName })
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
      if (isPackageTab) {
        const createdPackage = await packagesApi.create({
          name: packageName,
          description: packageDescription || undefined,
          material_type: packageType,
          material_ids: packageMaterialIds,
        })
        await packagesApi.submit(createdPackage.id, { task_name: taskName })
        message.success('已提交素材包审核任务')
        navigate('/tasks')
        return
      }
      if (sourceMode === 'upload') {
        if (createMode === 'bulk') {
          for (const item of uploadItems) await createOneFromUpload(item)
        } else {
          await createOneFromUpload(uploadItems[0])
        }
      } else if (createMode === 'bulk') {
        for (const id of pickedIds) await submitPickedMaterial(id)
      } else {
        await submitPickedMaterial(pickedIds[0])
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

  return (
    <div
      style={{
        width: '100%',
        background: palette.bg,
        margin: '-20px',
        padding: 20,
        minHeight: 'calc(100vh - 64px)',
      }}
    >
      <PageHero
        eyebrow="Section · Content Review"
        title="创建审核任务"
        subtitle="选择素材类型、设置审核策略，让 AI 与人工协作把关每一条投放内容。"
        onBack={() => navigate('/tasks')}
      />

      <div
        style={{
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 13,
            fontWeight: 500,
            color: palette.ink,
            marginBottom: 8,
          }}
        >
          任务名称 <span style={{ color: palette.danger }}>*</span>
        </div>
        <Input
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="请输入任务名称"
          maxLength={255}
          style={{
            borderRadius: 6,
            borderColor: palette.border,
            fontSize: 14,
          }}
        />
      </div>

      {/* 类型选择（编辑风 tabs） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
          padding: '4px 0',
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: palette.inkSubtle,
            marginRight: 8,
          }}
        >
          媒介
        </span>
        {TYPE_TABS.map((t) => {
          const active = t.key === type
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTypeChange(t.key)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                padding: '12px 4px',
                marginBottom: -1,
                borderBottom: active
                  ? `2px solid ${palette.accent}`
                  : '2px solid transparent',
                color: active ? palette.ink : palette.inkMuted,
                fontFamily: font.serif,
                fontSize: 16,
                fontWeight: active ? 600 : 400,
                transition: 'color 120ms ease',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <StepProgress
        steps={steps}
        currentStep={currentStep}
        onStepClick={handleStepClick}
        style={{ marginBottom: 24 }}
      />

      {/* 主体：左右对齐两栏 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* 左栏 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {isPackageTab ? (
            <>
              {/* 素材包模式：Step 01 = 创建素材包 */}
              <SectionCard
                eyebrow="Step 01"
                title="创建素材包"
                description="填写素材包信息并选择要包含的素材。"
                accentBar
                extra={
                  <Text style={{ fontSize: 12, color: palette.inkSubtle }}>
                    已选 {packageMaterialIds.length} 个素材
                  </Text>
                }
                stepRef={(el) => { stepRefs.current[0] = el }}
                isActive={currentStep === 0}
              >
                <PackageCreator
                  packageName={packageName}
                  onPackageNameChange={setPackageName}
                  packageDescription={packageDescription}
                  onPackageDescriptionChange={setPackageDescription}
                  packageType={packageType}
                  onPackageTypeChange={setPackageType}
                  selectedMaterialIds={packageMaterialIds}
                  onSelectedMaterialIdsChange={setPackageMaterialIds}
                  maxCount={BULK_LIMIT}
                />
              </SectionCard>

              {/* 素材包模式：Step 02 = 审核配置 */}
              <SectionCard
                eyebrow="Step 02"
                title="审核配置"
                description="为本次任务选择策略、流程与投放场景。"
                stepRef={(el) => { stepRefs.current[1] = el }}
                isActive={currentStep === 1}
              >
                {canPickStrategy ? (
                  <StrategyForm value={strategyForm} onChange={setStrategyForm} />
                ) : (
                  <Typography.Text style={{ color: palette.inkMuted, fontSize: 13 }}>
                    提交者使用默认策略；如需指定审核策略，请联系管理员配置。
                  </Typography.Text>
                )}
              </SectionCard>
            </>
          ) : (
            <>
              {/* 普通模式：Step 01 = 创建方式与素材来源 */}
              <SectionCard
                eyebrow="Step 01"
                title="创建方式与素材来源"
                description="先选择单件或批量，再决定素材从哪里来。"
                accentBar
                extra={
                  <Text style={{ fontSize: 12, color: palette.inkSubtle }}>
                    当前选中 <span style={{ color: palette.ink, fontWeight: 600 }}>{effectiveCount}</span> 个
                  </Text>
                }
                stepRef={(el) => { stepRefs.current[0] = el }}
                isActive={currentStep === 0}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <StepIndicator
                    label="创建方式"
                    step={1}
                    value={createMode}
                    options={createModeOptions}
                    onChange={(v) => onCreateModeChange(v as CreateMode)}
                  />
                  <StepIndicator
                    label="素材来源"
                    step={2}
                    value={sourceMode}
                    options={sourceOptions}
                    onChange={(v) => onSourceChange(v as SourceMode)}
                  />
                </div>
              </SectionCard>

              {/* 普通模式：Step 02 = 素材 */}
              <SectionCard
                eyebrow="Step 02"
                title="素材"
                description={
                  sourceMode === 'upload'
                    ? '点击或拖拽文件到此处上传。'
                    : '从素材库挑选已存在的草稿或已驳回素材。'
                }
                extra={
                  <Text style={{ fontSize: 12, color: palette.inkMuted }}>
                    最多 {BULK_LIMIT} 个
                  </Text>
                }
                stepRef={(el) => { stepRefs.current[1] = el }}
                isActive={currentStep === 1}
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
              </SectionCard>

              {/* 普通模式：Step 03 = 审核配置 */}
              <SectionCard
                eyebrow="Step 03"
                title="审核配置"
                description="为本次任务选择策略、流程与投放场景。"
                stepRef={(el) => { stepRefs.current[2] = el }}
                isActive={currentStep === 2}
              >
                {canPickStrategy ? (
                  <StrategyForm value={strategyForm} onChange={setStrategyForm} />
                ) : (
                  <Typography.Text style={{ color: palette.inkMuted, fontSize: 13 }}>
                    提交者使用默认策略；如需指定审核策略，请联系管理员配置。
                  </Typography.Text>
                )}
              </SectionCard>
            </>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingTop: 4,
            }}
          >
            <Text style={{ color: palette.inkMuted, fontSize: 12 }}>
              按下「创建任务」即代表你已确认素材和审核配置无误。
            </Text>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                onClick={() => navigate('/tasks')}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                }}
              >
                取消
              </Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={submitting}
                onClick={onSubmit}
                style={{
                  borderRadius: 999,
                  background: palette.accent,
                  borderColor: palette.accent,
                  paddingLeft: 22,
                  paddingRight: 22,
                  fontWeight: 500,
                }}
              >
                创建任务{effectiveCount > 1 ? `（${effectiveCount} 个）` : ''}
              </Button>
            </div>
          </div>
        </div>

        {/* 右栏：解析结果（与左栏 section 等高 sticky） */}
        <div style={{ position: 'sticky', top: 80 }}>
          <SectionCard
            eyebrow="Live · Preview"
            title="解析结果"
            description="本地面板：仅展示元信息；深度解析将在任务提交后由后端生成。"
            accentBar
          >
            <AnalysisPanel
              mode={sourceMode}
              uploadItems={parseItems}
              pickedItems={pickedItems}
              backendType={rightTabKind === 'audio' ? 'video' : (rightTabKind as MaterialType)}
              selectedMaterialDetail={selectedMaterialDetail}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
