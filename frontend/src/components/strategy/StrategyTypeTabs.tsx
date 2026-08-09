import { useState, type ReactNode } from 'react'
import { Alert, Space, Tabs, type TabsProps } from 'antd'
import { CATEGORIES, type CategoryKey } from './constants'
import RulesTreeView from './RulesTreeView'
import AudioRuleCard from './AudioRuleCard'
import ComposeRuleCard, { type ComposeSegment } from './ComposeRuleCard'
import VideoFrameIntervalInput from './VideoFrameIntervalInput'
import TextLibraryQuickBar from './TextLibraryQuickBar'
import type {
  AudioFeatures,
  AuditItem,
  DocComposeModes,
  DocImageMode,
  DocTextMode,
  ImageTextMode,
  VideoAudioMode,
  VideoComposeModes,
  VideoFrameMode,
  VoiceRuleMode,
} from '@/types/domain'
import {
  DEFAULT_VIDEO_FRAME_INTERVAL_SEC,
} from '@/types/domain'
import {
  type ItemPointMap,
  type MediaPointMap,
  type MediaPointOverrideMap,
  type PointMap,
} from './pointLevel'
import type { Intensity } from '@/lib/threshold'

const PACKAGE_BY_MEDIA: Record<CategoryKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

interface Props {
  /** 已选 item id 集合（由父级根据 point 勾选反推） */
  enabledItemIds: Record<CategoryKey, number[]>
  pointMap: MediaPointMap
  pointOverrides: MediaPointOverrideMap
  onPointMapChange: (next: MediaPointMap) => void
  onPointOverrideChange: (
    media: CategoryKey,
    itemId: number,
    pointId: number,
    override: {
      medium_threshold?: number | null
      high_threshold?: number | null
      low_threshold_min?: number | null
      low_threshold_max?: number | null
      medium_threshold_min?: number | null
      medium_threshold_max?: number | null
      high_threshold_min?: number | null
      high_threshold_max?: number | null
      linked_library_ids?: number[]
    },
  ) => void
  onPointToggle: (
    media: CategoryKey,
    itemId: number,
    pointId: number,
    checked: boolean,
  ) => void
  defaultActiveKey?: CategoryKey
  /** 受控 activeKey：父级传入时使用，否则回退到内部 state */
  activeKey?: CategoryKey
  onActiveKeyChange?: (next: CategoryKey) => void
  // ---- 音频（语音审核专用配置）----
  voiceRuleMode?: VoiceRuleMode
  onVoiceRuleModeChange?: (next: VoiceRuleMode) => void
  audioFeatures?: AudioFeatures
  onAudioFeaturesChange?: (next: AudioFeatures) => void
  // ---- 文档（文本 + 图像 二段）----
  docComposeModes?: DocComposeModes
  onDocComposeModesChange?: (next: DocComposeModes) => void
  // ---- 视频（画面 + 语音 二段 + 抽帧频率）----
  videoComposeModes?: VideoComposeModes
  onVideoComposeModesChange?: (next: VideoComposeModes) => void
  videoFrameInterval?: number
  onVideoFrameIntervalChange?: (next: number) => void
  // ---- 图文 (image tab 子分类) ----
  /** 「图文」bar 元素(右栏顶部 Switch + ComposeRuleCard 容器);父级传入 */
  imageTextBar?: ReactNode
  /** 左栏 item 选中变化回调(供父级判断是否显示 bar) */
  onSelectedItemChange?: (item: AuditItem | null) => void
  /**
   * 2026-07-30 「图文」独立规则配置。
   * 当 imageTextConfig.mode === 'independent' 时,在 image tab 右栏 PointsColumn
   * 之后追加渲染一棵 text 包规则树,允许用户配置图文专有的独立规则。
   */
  imageTextConfig?: {
    mode: ImageTextMode
    pointMap: ItemPointMap
    onPointMapChange: (itemId: number, next: PointMap) => void
  }
  // 点击 item 行「关联库」入口 → 父级 (CreateStrategyForm) 打开 ItemLibrariesEditor 并即时 PATCH
  onItemLibraryLink?: (item: AuditItem) => void
  /**
   * 关联库成功保存后由父级 +1, 各 RulesTreeView 用它做 remount key,
   * 重新拉 items 让左栏 badge 同步刷新。
   */
  libraryRefreshTick?: number
  /** 当前检测强度档位：透传给 RulesTreeView 用于 sub 阈值显示回退 */
  intensity?: Intensity
}

export default function StrategyTypeTabs({
  enabledItemIds,
  pointMap,
  pointOverrides,
  onPointMapChange,
  onPointOverrideChange,
  onPointToggle,
  defaultActiveKey = 'image',
  voiceRuleMode = 'reuse_text',
  onVoiceRuleModeChange,
  audioFeatures,
  onAudioFeaturesChange,
  docComposeModes,
  onDocComposeModesChange,
  videoComposeModes,
  onVideoComposeModesChange,
  videoFrameInterval = DEFAULT_VIDEO_FRAME_INTERVAL_SEC,
  onVideoFrameIntervalChange,
  imageTextBar,
  onSelectedItemChange,
  imageTextConfig,
  onItemLibraryLink,
  libraryRefreshTick,
  intensity,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(defaultActiveKey)

  const setPointsForItem = (media: CategoryKey, itemId: number, next: PointMap) => {
    onPointMapChange({ ...pointMap, [media]: { ...pointMap[media], [itemId]: next } })
  }

  // 确认弹窗：切到独立时清空该 tab 维度的 pointMap
  const handleConfirmVoiceSwitch = async (next: VoiceRuleMode) => {
    if (next === 'independent') {
      onPointMapChange({ ...pointMap, audio: {} })
    }
    return true
  }

  const handleConfirmDocSwitch = async (_segmentIndex: number, nextMode: string) => {
    if (nextMode === 'independent') {
      onPointMapChange({ ...pointMap, doc: {} })
    }
    return true
  }

  const handleConfirmVideoSwitch = async (_segmentIndex: number, nextMode: string) => {
    if (nextMode === 'independent') {
      onPointMapChange({ ...pointMap, video: {} })
    }
    return true
  }

  // 图文 (image tab 子分类): 开启后用户选择模式,模式切到独立时弹确认
  // 文档：两段
  const buildDocSegments = (): ComposeSegment[] | null => {
    if (!docComposeModes || !onDocComposeModesChange) return null
    const segs: ComposeSegment[] = [
      {
        title: '文本审核',
        mode: docComposeModes.text_mode,
        reuseValue: 'reuse_text' satisfies DocTextMode,
        reuseLabel: '复用文本审核规则',
        independentValue: 'independent',
      },
      {
        title: '图片审核',
        mode: docComposeModes.image_mode,
        reuseValue: 'reuse_image' satisfies DocImageMode,
        reuseLabel: '复用图片审核规则',
        independentValue: 'independent',
      },
    ]
    return segs
  }

  // 视频：两段（画面 + 语音），并加上抽帧频率
  const buildVideoSegments = (): ComposeSegment[] | null => {
    if (!videoComposeModes || !onVideoComposeModesChange) return null
    return [
      {
        title: '画面审核',
        mode: videoComposeModes.frame_mode,
        reuseValue: 'reuse_image' satisfies VideoFrameMode,
        reuseLabel: '复用图片审核规则',
        independentValue: 'independent',
      },
      {
        title: '语音审核',
        mode: videoComposeModes.audio_mode,
        reuseValue: 'reuse_audio' satisfies VideoAudioMode,
        reuseLabel: '复用语音审核',
        independentValue: 'independent',
        helpText:
          '复用模式时，语音审核完全镜像短音频同步审核规则；切换为独立规则后将显示独立的视频音频规则。',
      },
    ]
  }

  const onChangeDocSegment = (idx: number, next: string) => {
    if (!docComposeModes || !onDocComposeModesChange) return
    const nextModes: DocComposeModes = {
      ...docComposeModes,
      ...(idx === 0 ? { text_mode: next as DocTextMode } : {}),
      ...(idx === 1 ? { image_mode: next as DocImageMode } : {}),
    }
    onDocComposeModesChange(nextModes)
  }

  const onChangeVideoSegment = (idx: number, next: string) => {
    if (!videoComposeModes || !onVideoComposeModesChange) return
    const nextModes: VideoComposeModes = {
      ...videoComposeModes,
      ...(idx === 0 ? { frame_mode: next as VideoFrameMode } : {}),
      ...(idx === 1 ? { audio_mode: next as VideoAudioMode } : {}),
    }
    onVideoComposeModesChange(nextModes)
  }

  // 语音 tab 独立模式才显示规则树
  const showAudioRulesTree = voiceRuleMode === 'independent'
  // 文档/视频 tab：段独立判定已下放到各 RulesTreeView 渲染条件
  // （按段映射到 text/image 树），不再用单一 show* 开关。
  const docSegments = buildDocSegments()
  const videoSegments = buildVideoSegments()

  const items: TabsProps['items'] = CATEGORIES.map((cat) => {
    const selectedItems = enabledItemIds[cat.key] ?? []
    const overriddenCount = Object.keys(pointMap[cat.key] ?? {}).filter((itemIdStr) => {
      const itemId = Number(itemIdStr)
      const itemMap = pointMap[cat.key]?.[itemId] ?? {}
      return Object.values(itemMap).some((v) => v === false)
    }).length
    const totalPoints = Object.values(pointMap[cat.key] ?? {}).reduce(
      (n, itemMap) => n + Object.values(itemMap).filter((v) => v === true).length,
      0,
    )

    return {
      key: cat.key,
      label: (
        <span>
          {cat.label}
          {totalPoints > 0 ? ` (${totalPoints})` : ''}
          {overriddenCount > 0 ? (
            <span style={{ color: '#F59E0B', marginLeft: 4 }}>
              ·{overriddenCount} 已细化
            </span>
          ) : null}
        </span>
      ),
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 语音 tab：AudioRuleCard（声纹 / 音频质量 + 单选） */}
          {cat.key === 'audio' &&
            onVoiceRuleModeChange &&
            audioFeatures &&
            onAudioFeaturesChange && (
              <AudioRuleCard
                voiceRuleMode={voiceRuleMode}
                onVoiceRuleModeChange={onVoiceRuleModeChange}
                audioFeatures={audioFeatures}
                onAudioFeaturesChange={onAudioFeaturesChange}
                onConfirmModeSwitch={handleConfirmVoiceSwitch}
              />
            )}
          {/* 文档 tab：ComposeRuleCard 两段 */}
          {cat.key === 'doc' && docSegments && (
            <ComposeRuleCard
              cardTitle="文档规则配置"
              segments={docSegments}
              onSegmentChange={onChangeDocSegment}
              onConfirmSegmentSwitch={handleConfirmDocSwitch}
            />
          )}
          {/* 视频 tab：VideoFrameIntervalInput + ComposeRuleCard 两段 */}
          {cat.key === 'video' && (
            <>
              {onVideoFrameIntervalChange && (
                <div
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 6,
                    padding: '4px 20px 12px',
                  }}
                >
                  <VideoFrameIntervalInput
                    value={videoFrameInterval}
                    onChange={onVideoFrameIntervalChange}
                  />
                </div>
              )}
              {videoSegments && (
                <ComposeRuleCard
                  cardTitle="视频规则配置"
                  segments={videoSegments}
                  onSegmentChange={onChangeVideoSegment}
                  onConfirmSegmentSwitch={handleConfirmVideoSwitch}
                />
              )}
            </>
          )}
          {/* 规则树：仅在对应 tab 处于「独立」状态时渲染
              语音/文档/视频的「独立规则」按组合来源映射到 text/image 标签树
              （语音审转写文本→文本树；文档文本段→文本树、图片段→图片树；
               视频画面段→图片树、语音段→文本树），保证处处三级标签。
              mediaKey 显式传 tab 自身 key，pointOverrides/pointMap 不与文/图 tab 串数据。 */}
          {cat.key === 'audio' && showAudioRulesTree && (
            <RulesTreeView
              key={`${cat.key}-${voiceRuleMode}`}
              packageCode={PACKAGE_BY_MEDIA.text}
              mediaKey="audio"
              enabledItemIds={enabledItemIds.audio ?? []}
              getPointMap={(itemId) => pointMap.audio?.[itemId] ?? {}}
              onPointMapChange={(itemId, next) => setPointsForItem('audio', itemId, next)}
              pointOverrides={pointOverrides}
              onPointOverrideChange={(itemId, pointId, override) =>
                onPointOverrideChange('audio', itemId, pointId, override)
              }
              onPointToggle={(itemId, pointId, checked) =>
                onPointToggle('audio', itemId, pointId, checked)
              }
              onItemLibraryLink={onItemLibraryLink}
              refreshKey={libraryRefreshTick}
              intensity={intensity}
            />
          )}
          {cat.key === 'doc' && docSegments && docSegments[0].mode === 'independent' && (
            <RulesTreeView
              key={`${cat.key}-text`}
              packageCode={PACKAGE_BY_MEDIA.text}
              mediaKey="doc"
              enabledItemIds={enabledItemIds.doc ?? []}
              getPointMap={(itemId) => pointMap.doc?.[itemId] ?? {}}
              onPointMapChange={(itemId, next) => setPointsForItem('doc', itemId, next)}
              pointOverrides={pointOverrides}
              onPointOverrideChange={(itemId, pointId, override) =>
                onPointOverrideChange('doc', itemId, pointId, override)
              }
              onPointToggle={(itemId, pointId, checked) =>
                onPointToggle('doc', itemId, pointId, checked)
              }
              onItemLibraryLink={onItemLibraryLink}
              refreshKey={libraryRefreshTick}
              intensity={intensity}
            />
          )}
          {cat.key === 'doc' && docSegments && docSegments[1].mode === 'independent' && (
            <RulesTreeView
              key={`${cat.key}-image`}
              packageCode={PACKAGE_BY_MEDIA.image}
              mediaKey="doc"
              enabledItemIds={enabledItemIds.doc ?? []}
              getPointMap={(itemId) => pointMap.doc?.[itemId] ?? {}}
              onPointMapChange={(itemId, next) => setPointsForItem('doc', itemId, next)}
              pointOverrides={pointOverrides}
              onPointOverrideChange={(itemId, pointId, override) =>
                onPointOverrideChange('doc', itemId, pointId, override)
              }
              onPointToggle={(itemId, pointId, checked) =>
                onPointToggle('doc', itemId, pointId, checked)
              }
              onItemLibraryLink={onItemLibraryLink}
              refreshKey={libraryRefreshTick}
              intensity={intensity}
            />
          )}
          {cat.key === 'video' && videoSegments && videoSegments[0].mode === 'independent' && (
            <RulesTreeView
              key={`${cat.key}-frame`}
              packageCode={PACKAGE_BY_MEDIA.image}
              mediaKey="video"
              enabledItemIds={enabledItemIds.video ?? []}
              getPointMap={(itemId) => pointMap.video?.[itemId] ?? {}}
              onPointMapChange={(itemId, next) => setPointsForItem('video', itemId, next)}
              pointOverrides={pointOverrides}
              onPointOverrideChange={(itemId, pointId, override) =>
                onPointOverrideChange('video', itemId, pointId, override)
              }
              onPointToggle={(itemId, pointId, checked) =>
                onPointToggle('video', itemId, pointId, checked)
              }
              onItemLibraryLink={onItemLibraryLink}
              refreshKey={libraryRefreshTick}
              intensity={intensity}
            />
          )}
          {cat.key === 'video' && videoSegments && videoSegments[1].mode === 'independent' && (
            <RulesTreeView
              key={`${cat.key}-audio`}
              packageCode={PACKAGE_BY_MEDIA.text}
              mediaKey="video"
              enabledItemIds={enabledItemIds.video ?? []}
              getPointMap={(itemId) => pointMap.video?.[itemId] ?? {}}
              onPointMapChange={(itemId, next) => setPointsForItem('video', itemId, next)}
              pointOverrides={pointOverrides}
              onPointOverrideChange={(itemId, pointId, override) =>
                onPointOverrideChange('video', itemId, pointId, override)
              }
              onPointToggle={(itemId, pointId, checked) =>
                onPointToggle('video', itemId, pointId, checked)
              }
              onItemLibraryLink={onItemLibraryLink}
              refreshKey={libraryRefreshTick}
              intensity={intensity}
            />
          )}
          {/* 普通 tab（非合成类）的规则树 */}
          {cat.key !== 'audio' && cat.key !== 'doc' && cat.key !== 'video' && (
            <>
              {/* 配置词库快捷栏：仅文本 tab 时,在规则树之上(作为右栏顶部)。
                  选择状态仅本地,刷新即丢。 */}
              {cat.key === 'text' && <TextLibraryQuickBar />}
              <RulesTreeView
                packageCode={PACKAGE_BY_MEDIA[cat.key]}
                enabledItemIds={selectedItems}
                getPointMap={(itemId) => pointMap[cat.key]?.[itemId] ?? {}}
                onPointMapChange={(itemId, next) => setPointsForItem(cat.key, itemId, next)}
                pointOverrides={pointOverrides}
                onPointOverrideChange={(itemId, pointId, override) =>
                  onPointOverrideChange(cat.key, itemId, pointId, override)
                }
                onPointToggle={(itemId, pointId, checked) =>
                  onPointToggle(cat.key, itemId, pointId, checked)
                }
                onItemLibraryLink={onItemLibraryLink}
                refreshKey={libraryRefreshTick}
                imageTextBar={cat.key === 'image' ? imageTextBar : undefined}
                onSelectedItemChange={cat.key === 'image' ? onSelectedItemChange : undefined}
                imageTextConfig={cat.key === 'image' ? imageTextConfig : undefined}
                intensity={intensity}
              />
            </>
          )}
          {!['audio', 'doc', 'video'].includes(cat.key) && cat.description && (
            <Alert
              type="info"
              showIcon
              message={cat.description}
              style={{ marginTop: 4 }}
            />
          )}
        </Space>
      ),
    }
  })

  return (
    <Tabs
      type="line"
      activeKey={activeCategory}
      onChange={(k) => setActiveCategory(k as CategoryKey)}
      destroyOnHidden={false}
      items={items}
    />
  )
}
