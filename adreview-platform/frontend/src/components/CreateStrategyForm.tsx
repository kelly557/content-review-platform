import { useEffect, useState } from 'react'
import {
  Form,
  Input,
  Segmented,
  DatePicker,
  Button,
  Space,
  Steps,
  Typography,
  App,
  Modal,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, Link } from 'react-router-dom'
import { strategiesApi } from '@/api/strategies'
import {
  type CategoryKey,
} from './strategy/constants'
import StrategyTypeTabs from './strategy/StrategyTypeTabs'
import {
  DEFAULT_AUDIO_FEATURES,
  DEFAULT_DOC_COMPOSE_MODES,
  DEFAULT_VIDEO_COMPOSE_MODES,
  DEFAULT_VIDEO_FRAME_INTERVAL_SEC,
  extractAudioFeatures,
  extractDocComposeModes,
  extractVideoComposeModes,
  extractVideoFrameInterval,
  extractVoiceRuleMode,
  type AudioFeatures,
  type DocComposeModes,
  type LibraryType,
  type LlmReviewConfig,
  type StrategyPointRef,
  type VideoComposeModes,
  type VoiceRuleMode,
} from '@/types/domain'
import type { Strategy } from '@/types/domain'
import type { AuditItem } from '@/types/domain'
import { ItemLibrariesEditor } from '@/components/packages/ItemLibrariesEditor'
import {
  buildPointMapFromStrategy,
  countEnabledPoints,
  countExplicitOverrides,
  EMPTY_MEDIA_OVERRIDES,
  flattenEnabledPointsWithOverride,
  hasAnyOverride,
  type MediaPointMap,
  type MediaPointOverrideMap,
  type PointOverride,
} from './strategy/pointLevel'
import { LlmReviewCard } from './strategy/LlmReviewCard'

const { Text } = Typography

type DurationMode = 'always' | 'range'

interface BasicFormValues {
  name: string
  durationMode: DurationMode
  range?: [Dayjs, Dayjs]
}

interface Props {
  mode?: 'create' | 'edit'
  strategyId?: number
  initial?: Strategy
  initialStep?: 0 | 1
  onCancel?: () => void
}

const MEDIA_TYPE_LABEL_MAP: Record<CategoryKey, string> = {
  image: '图片',
  text: '文本',
  audio: '语音',
  doc: '文档',
  video: '视频',
}

const EMPTY_ENABLED: Record<CategoryKey, number[]> = {
  image: [],
  text: [],
  audio: [],
  doc: [],
  video: [],
}

const CATEGORY_TO_PACKAGE: Record<CategoryKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const ALLOWED_LIB_TYPES_BY_CATEGORY: Record<CategoryKey, LibraryType[]> = {
  image: ['image', 'word', 'reply'],
  text: ['word', 'reply'],
  audio: ['word', 'reply'],
  doc: ['image', 'word', 'reply'],
  video: ['image', 'word', 'reply'],
}

const EMPTY_POINTS: MediaPointMap = {
  image: {},
  text: {},
  audio: {},
  doc: {},
  video: {},
}

function countEnabled(map: Record<CategoryKey, number[]>): number {
  return Object.values(map).reduce((s, arr) => s + arr.length, 0)
}

function flattenEnabledItems(
  map: Record<CategoryKey, number[]>,
): Array<{ media_type: CategoryKey; item_id: number; is_enabled: boolean }> {
  const out: Array<{ media_type: CategoryKey; item_id: number; is_enabled: boolean }> = []
  for (const [media_type, ids] of Object.entries(map) as [CategoryKey, number[]][]) {
    for (const item_id of ids) {
      out.push({ media_type, item_id, is_enabled: true })
    }
  }
  return out
}

/** 根据 item.package_code 找到对应的 media/CategoryKey。 */
function categoryOfPackage(packageCode: string): CategoryKey | null {
  for (const [cat, pkg] of Object.entries(CATEGORY_TO_PACKAGE)) {
    if (pkg === packageCode) return cat as CategoryKey
  }
  return null
}

export default function CreateStrategyForm({
  mode = 'create',
  strategyId,
  initial,
  initialStep,
  onCancel,
}: Props) {
  const { message } = App.useApp()

  const navigate = useNavigate()
  const [form] = Form.useForm<BasicFormValues>()
  const [durationMode, setDurationMode] = useState<DurationMode>('always')
  const [step, setStep] = useState<0 | 1>(
    initialStep ?? (mode === 'edit' ? 1 : 0),
  )
  const [submitting, setSubmitting] = useState(false)
  const [enabledItems, setEnabledItems] = useState<Record<CategoryKey, number[]>>(
    EMPTY_ENABLED,
  )
  const [pointMap, setPointMap] = useState<MediaPointMap>(EMPTY_POINTS)
  const [pointOverrides, setPointOverrides] = useState<MediaPointOverrideMap>(
    EMPTY_MEDIA_OVERRIDES,
  )
  const [voiceRuleMode, setVoiceRuleMode] = useState<VoiceRuleMode>('reuse_text')
  const [audioFeatures, setAudioFeatures] = useState<AudioFeatures>(DEFAULT_AUDIO_FEATURES)
  const [docComposeModes, setDocComposeModes] = useState<DocComposeModes>(DEFAULT_DOC_COMPOSE_MODES)
  const [videoComposeModes, setVideoComposeModes] = useState<VideoComposeModes>(DEFAULT_VIDEO_COMPOSE_MODES)
  const [videoFrameInterval, setVideoFrameInterval] = useState<number>(DEFAULT_VIDEO_FRAME_INTERVAL_SEC)
  const [llmReview, setLlmReview] = useState<LlmReviewConfig>({
    is_enabled: false,
    model_id: null,
    needs_multimodal_hint: false,
  })
  const [hydrated, setHydrated] = useState(mode === 'create')
  /** 关联库编辑 modal 当前编辑的 item；null=关闭 */
  const [linkLibraryItem, setLinkLibraryItem] = useState<AuditItem | null>(null)
  /**
   * 库关联保存/取消成功的次数, 用作 RulesTreeView 的 remount key,
   * 强制各 RulesTreeView 重新拉 items 以更新左栏 badge。
   */
  const [libraryRefreshTick, setLibraryRefreshTick] = useState(0)
  const [saveResult, setSaveResult] = useState<{
    open: boolean
    strategyId?: number
    fromCreate: boolean
    name?: string
  }>({ open: false, fromCreate: mode === 'create' })

  useEffect(() => {
    if (mode !== 'edit' || !initial) return
    const map: Record<CategoryKey, number[]> = { ...EMPTY_ENABLED }
    const items = Array.isArray(initial.enabled_items) ? initial.enabled_items : []
    for (const it of items) {
      if (!it || !it.is_enabled) continue
      const mt = it.media_type as CategoryKey
      if (mt in map) {
        map[mt] = Array.from(new Set([...map[mt], it.item_id]))
      }
    }
    setEnabledItems(map)
    const points = buildPointMapFromStrategy(
      Array.isArray(initial.enabled_points) ? initial.enabled_points : [],
    )
    setPointMap(points)
    // 从 initial.enabled_points 还原 override（中/高风险分 + 关联库）
    const overridesFromBackend: MediaPointOverrideMap = {
      image: {},
      text: {},
      audio: {},
      doc: {},
      video: {},
    }
    const rawPoints = Array.isArray(initial.enabled_points)
      ? initial.enabled_points
      : []
    for (const p of rawPoints) {
      if (!p) continue
      const mt = p.media_type as CategoryKey
      if (!(mt in overridesFromBackend)) continue
      const patch: PointOverride = {}
      if (p.medium_threshold !== undefined)
        patch.medium_threshold = p.medium_threshold
      if (p.high_threshold !== undefined)
        patch.high_threshold = p.high_threshold
      if (p.medium_threshold_min !== undefined)
        patch.medium_threshold_min = p.medium_threshold_min
      if (p.medium_threshold_max !== undefined)
        patch.medium_threshold_max = p.medium_threshold_max
      if (p.high_threshold_min !== undefined)
        patch.high_threshold_min = p.high_threshold_min
      if (p.high_threshold_max !== undefined)
        patch.high_threshold_max = p.high_threshold_max
      if (Object.keys(patch).length > 0) {
        if (!overridesFromBackend[mt][p.item_id])
          overridesFromBackend[mt][p.item_id] = {}
        overridesFromBackend[mt][p.item_id][p.point_id] = patch
      }
    }
    setPointOverrides(overridesFromBackend)
    setLlmReview(
      initial.llm_review ?? {
        is_enabled: false,
        model_id: null,
        needs_multimodal_hint: false,
      },
    )
    setVoiceRuleMode(extractVoiceRuleMode(initial.definition))
    setAudioFeatures(extractAudioFeatures(initial.definition))
    setDocComposeModes(extractDocComposeModes(initial.definition))
    setVideoComposeModes(extractVideoComposeModes(initial.definition))
    setVideoFrameInterval(extractVideoFrameInterval(initial.definition))
    const from = initial.effective_from ? dayjs(initial.effective_from) : null
    const until = initial.effective_until ? dayjs(initial.effective_until) : null
    const useRange = !!(from && until)
    setDurationMode(useRange ? 'range' : 'always')
    form.setFieldsValue({
      name: initial.name,
      durationMode: useRange ? 'range' : 'always',
      range: useRange ? ([from, until] as [Dayjs, Dayjs]) : undefined,
    })
    setHydrated(true)
  }, [mode, initial, form])

  const goNext = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setStep(1)
  }

  const goBackOne = () => setStep((s) => Math.max(0, s - 1) as 0 | 1)

  /** 点击 item 行 ◫ 入口 → 打开 modal，让 ItemLibrariesEditor 处理保存+即时 PATCH */
  const onItemLibraryLink = (it: AuditItem) => {
    setLinkLibraryItem(it)
  }

  /** PATCH 成功后递增 libraryRefreshTick，强制 RulesTreeView 重新加载以同步左栏 badge */
  const onLibrarySaved = (_next: AuditItem) => {
    setLibraryRefreshTick((n) => n + 1)
  }

  /** modal 取消/关闭 */
  const onLibraryCancel = () => setLinkLibraryItem(null)

  const buildDefinitionPayload = (): Record<string, unknown> | undefined => {
    const out: Record<string, unknown> = {}
    // 始终写入 compose 字段，保证后端 schema 校验通过。
    out.voice_rule_mode = voiceRuleMode
    out.audio_features = audioFeatures
    out.doc_text_mode = docComposeModes.text_mode
    out.doc_image_mode = docComposeModes.image_mode
    out.video_frame_mode = videoComposeModes.frame_mode
    out.video_audio_mode = videoComposeModes.audio_mode
    out.video_frame_interval_sec = videoFrameInterval

    return Object.keys(out).length > 0 ? out : undefined
  }

  const onSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) {
      setStep(0)
      return
    }
    const name = values.name?.trim()
    if (!name) {
      message.error('策略名称不能为空')
      setStep(0)
      return
    }
    if (mode === 'create' && countEnabledPoints(pointMap) === 0) {
      message.warning('请在第二步选择至少一个审核点')
      setStep(1)
      return
    }
    const definition = buildDefinitionPayload()
    const enabledPointsPayload: StrategyPointRef[] =
      flattenEnabledPointsWithOverride(pointMap, pointOverrides)
    // 策略级大模型审核：未开启或未选模型时，把开关一并清空；
    // needs_multimodal_hint 为后端回填字段，提交前丢弃以避免 stale 提示。
    const cleanedLlmReview: LlmReviewConfig = {
      is_enabled: !!llmReview.is_enabled && llmReview.model_id != null,
      model_id:
        llmReview.is_enabled && llmReview.model_id != null
          ? llmReview.model_id
          : null,
      needs_multimodal_hint: false,
    }
    setSubmitting(true)
    try {
      if (mode === 'edit' && strategyId) {
        const savedStrategy = await strategiesApi.update(strategyId, {
          name,
          enabled_items: flattenEnabledItems(enabledItems),
          enabled_points: enabledPointsPayload,
          effective_from:
            values.durationMode === 'range' && values.range?.[0]
              ? values.range[0].toISOString()
              : null,
          effective_until:
            values.durationMode === 'range' && values.range?.[1]
              ? values.range[1].toISOString()
              : null,
          definition,
          llm_review: cleanedLlmReview,
        })
        message.success('已保存策略')
        setSaveResult({
          open: true,
          strategyId: savedStrategy.id,
          fromCreate: false,
          name: savedStrategy.name,
        })
        return
      }
      const savedStrategy = await strategiesApi.create({
        name,
        enabled_items: flattenEnabledItems(enabledItems),
        enabled_points: enabledPointsPayload,
        effective_from:
          values.durationMode === 'range' && values.range?.[0]
            ? values.range[0].toISOString()
            : null,
          effective_until:
            values.durationMode === 'range' && values.range?.[1]
              ? values.range[1].toISOString()
              : null,
          definition,
          llm_review: cleanedLlmReview,
      })
      message.success('已创建策略')
      setSaveResult({
        open: true,
        strategyId: savedStrategy.id,
        fromCreate: true,
        name: savedStrategy.name,
      })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: unknown } } }
      const detail = err?.response?.data?.detail
      if (typeof detail === 'string') {
        message.error(detail)
      } else if (Array.isArray(detail)) {
        message.error(detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; '))
      } else {
        message.error('保存失败，请检查输入')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onContinueEdit = () => {
    const idVal = saveResult.strategyId
    const fromCreate = saveResult.fromCreate
    setSaveResult({
      open: false,
      strategyId: idVal,
      fromCreate,
      name: saveResult.name,
    })

    if (fromCreate && idVal) {
      navigate(`/strategies/${idVal}/edit`, { state: { step: 1 }, replace: true })
      return
    }
    setStep(1)
  }

  const onFinishSave = () => {
    setSaveResult((prev) => ({
      open: false,
      strategyId: prev.strategyId,
      fromCreate: prev.fromCreate,
      name: prev.name,
    }))
    navigate('/strategies', { state: { refresh: true } })
  }

  if (!hydrated) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        width: '100%',
      }}
    >
      <Form
        form={form}
        layout="vertical"
        component={false}
        requiredMark={(label) => (
          <span>
            <span style={{ color: '#DC2626', marginRight: 4 }}>*</span>
            {label}
          </span>
        )}
        scrollToFirstError
        validateTrigger={['onBlur', 'onSubmit']}
      >
        <Steps
          current={step}
          size="small"
          responsive
          items={[
            { title: '基本信息' },
            { title: '策略审核规则' },
          ]}
        />

        <div hidden={step !== 0}>
          <Form.Item
            label="策略名称"
            name="name"
            htmlFor=""
            initialValue=""
            rules={[
              { required: true, message: '请输入策略名称' },
              { max: 20, message: '不超过 20 个字符' },
            ]}
          >
            <Input
              placeholder="请输入策略名称"
              maxLength={20}
              showCount
              style={{ maxWidth: 'min(560px, 100%)' }}
              aria-label="策略名称"
            />
          </Form.Item>

          <Form.Item
            name="durationMode"
            label="策略生效时间"
            htmlFor=""
            initialValue="always"
            rules={[{ required: true, message: '请选择生效时间' }]}
          >
            <Segmented
              options={[
                { label: '长期有效', value: 'always' },
                { label: '指定时间', value: 'range' },
              ]}
              value={durationMode}
              onChange={(v) => {
                const next = v as DurationMode
                setDurationMode(next)
                form.setFieldValue('durationMode', next)
              }}
              aria-label="策略生效时间模式"
            />
          </Form.Item>

          <Form.Item
            name="range"
            label="生效时间范围"
            htmlFor=""
            dependencies={['durationMode']}
            hidden={durationMode !== 'range'}
            rules={[
              {
                validator: (_, value: [Dayjs, Dayjs] | undefined) => {
                  if (durationMode !== 'range') return Promise.resolve()
                  if (!value || value.length !== 2) {
                    return Promise.reject(new Error('请选择起止日期'))
                  }
                  if (!value[0].isBefore(value[1])) {
                    return Promise.reject(new Error('起始时间必须早于结束时间'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <DatePicker.RangePicker
              showTime={{
                format: 'HH:mm',
                defaultValue: [dayjs('00:00', 'HH:mm'), dayjs('23:59', 'HH:mm')],
              }}
              format="YYYY.MM.DD HH:mm"
              placeholder={['开始日期', '结束日期']}
            />
          </Form.Item>
        </div>

        {step === 1 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              width: '100%',
            }}
          >
            {/* 大模型审核能力：单一开关，置于通用规则上方。needs_multimodal_hint 由后端按 enabled_items 回填 */}
            <LlmReviewCard value={llmReview} onChange={setLlmReview} />
            <StrategyTypeTabs
              enabledItemIds={enabledItems}
              pointMap={pointMap}
              pointOverrides={pointOverrides}
              onItemLibraryLink={onItemLibraryLink}
              libraryRefreshTick={libraryRefreshTick}
              onPointMapChange={setPointMap}
              onPointOverrideChange={(media, itemId, pointId, override) =>
                setPointOverrides((prev) => {
                  const next: MediaPointOverrideMap = { ...prev, [media]: { ...prev[media] } }
                  const itemBucket = { ...(next[media][itemId] ?? {}) }
                  const cur = itemBucket[pointId] ?? {}
                  const merged = { ...cur, ...override }
                  // 清理 null / empty
                  if (merged.medium_threshold === null) delete merged.medium_threshold
                  if (merged.high_threshold === null) delete merged.high_threshold
                  if (merged.medium_threshold_min === null) delete merged.medium_threshold_min
                  if (merged.medium_threshold_max === null) delete merged.medium_threshold_max
                  if (merged.high_threshold_min === null) delete merged.high_threshold_min
                  if (merged.high_threshold_max === null) delete merged.high_threshold_max
                  if (Object.keys(merged).length === 0) {
                    delete itemBucket[pointId]
                  } else {
                    itemBucket[pointId] = merged as PointOverride
                  }
                  if (Object.keys(itemBucket).length === 0) {
                    delete next[media][itemId]
                  } else {
                    next[media][itemId] = itemBucket
                  }
                  if (Object.keys(next[media]).length === 0) {
                    delete next[media]
                  }
                  return next
                })
              }
              onPointToggle={(media, itemId, pointId, checked) => {
                // 同步 enabledItems 集合：point 勾选 → item 加入；point 取消 → 若 item 下无勾选 point 则移除
                setEnabledItems((prev) => {
                  const current = prev[media] ?? []
                  const set = new Set(current)
                  if (checked) {
                    set.add(itemId)
                  } else {
                    // 检查 pointMap 该 item 下是否还有勾选
                    const itemMap = pointMap[media]?.[itemId] ?? {}
                    const hasOther = Object.entries(itemMap).some(
                      ([pid, v]) => Number(pid) !== pointId && v === true,
                    )
                    if (!hasOther) set.delete(itemId)
                  }
                  return { ...prev, [media]: Array.from(set) }
                })
              }}
              voiceRuleMode={voiceRuleMode}
              onVoiceRuleModeChange={setVoiceRuleMode}
              audioFeatures={audioFeatures}
              onAudioFeaturesChange={setAudioFeatures}
              docComposeModes={docComposeModes}
              onDocComposeModesChange={setDocComposeModes}
              videoComposeModes={videoComposeModes}
              onVideoComposeModesChange={setVideoComposeModes}
              videoFrameInterval={videoFrameInterval}
              onVideoFrameIntervalChange={setVideoFrameInterval}
            />

            {/* 「策略下启用审核项时为其绑词库」入口。即时 PATCH 写 audit_item_libraries。 */}
            {linkLibraryItem && (() => {
              const cat = categoryOfPackage(linkLibraryItem.package_code)
              const allowedTypes = cat
                ? ALLOWED_LIB_TYPES_BY_CATEGORY[cat]
                : (['image', 'word', 'reply'] as LibraryType[])
              const strategyName =
                form.getFieldValue('name') || (initial?.name ?? undefined)
              return (
                <ItemLibrariesEditor
                  open
                  code={linkLibraryItem.package_code}
                  item={linkLibraryItem}
                  strategyName={strategyName}
                  allowedTypes={allowedTypes}
                  onCancel={onLibraryCancel}
                  onSaved={onLibrarySaved}
                />
              )
            })()}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
              }}
            >
              <Text type="secondary">本步合计已选：</Text>
              <Text strong style={{ color: '#0369A1' }}>
                {countEnabled(enabledItems)} 条规则
              </Text>
              <Text type="secondary">/</Text>
              <Text strong style={{ color: '#0369A1' }}>
                {countEnabledPoints(pointMap)} 个审核点
              </Text>
              {hasAnyOverride(pointMap) && (
                <>
                  <Text type="secondary">（</Text>
                  <Text strong style={{ color: '#F59E0B' }}>
                    {countExplicitOverrides(pointMap)} 个已细化
                  </Text>
                  <Text type="secondary">）</Text>
                </>
              )}
            </div>
          </div>
        )}
    </Form>

    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
        <Space wrap>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => (onCancel ? onCancel() : navigate('/strategies'))}
          >
            返回
          </Button>
        </Space>
        <Space wrap>
          {step === 0 ? (
            <Button disabled>上一步</Button>
          ) : (
            <Button onClick={goBackOne}>上一步</Button>
          )}
          {step === 0 && (
            <Button type="primary" onClick={goNext}>
              下一步
            </Button>
          )}
          {step === 1 && (
            <Button type="primary" loading={submitting} onClick={onSubmit}>
              保存策略
            </Button>
          )}
        </Space>
      </div>

      <Modal
        open={saveResult.open}
        title="策略已保存"
        onCancel={onContinueEdit}
        okText="完成"
        cancelText="继续编辑"
        onOk={onFinishSave}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space wrap>
            {saveResult.strategyId && (
              <>
                {(['image', 'text', 'audio', 'doc', 'video'] as CategoryKey[]).map((k) => (
                  <Link
                    key={k}
                    to={`/rules/personal/${k}?strategy=${saveResult.strategyId}`}
                  >
                    <Button>
                      按类型管理：{MEDIA_TYPE_LABEL_MAP[k]}
                    </Button>
                  </Link>
                ))}
              </>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <p>
          策略「{saveResult.name ?? ''}」已保存成功。你可以继续编辑策略内容，或点击完成返回策略列表。
        </p>
        <p>
          <Text type="secondary">
            可点击对应按钮前往该策略的检测规则配置，或按审核类型管理已选规则。
          </Text>
        </p>
      </Modal>
    </div>
  )
}
