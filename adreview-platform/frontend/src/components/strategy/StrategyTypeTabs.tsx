import { useState } from 'react'
import { Alert, Space, Tabs, type TabsProps } from 'antd'
import { CATEGORIES, type CategoryKey } from './constants'
import RulesTreeView from './RulesTreeView'
import AudioRuleCard from './AudioRuleCard'
import ComposeRuleCard, { type ComposeSegment } from './ComposeRuleCard'
import VideoFrameIntervalInput from './VideoFrameIntervalInput'
import type {
  AudioFeatures,
  AuditItem,
  DocComposeModes,
  DocImageMode,
  DocTextMode,
  VideoAudioMode,
  VideoComposeModes,
  VideoFrameMode,
  VoiceRuleMode,
} from '@/types/domain'
import {
  DEFAULT_VIDEO_FRAME_INTERVAL_SEC,
} from '@/types/domain'
import {
  type MediaPointMap,
  type MediaPointOverrideMap,
  type PointMap,
} from './pointLevel'

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
  // 点击 item 行「关联库」入口 → 父级 (CreateStrategyForm) 打开 ItemLibrariesEditor 并即时 PATCH
  onItemLibraryLink?: (item: AuditItem) => void
  /**
   * 关联库成功保存后由父级 +1, 各 RulesTreeView 用它做 remount key,
   * 重新拉 items 让左栏 badge 同步刷新。
   */
  libraryRefreshTick?: number
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
  onItemLibraryLink,
  libraryRefreshTick,
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
        title: '图像审核',
        mode: docComposeModes.image_mode,
        reuseValue: 'reuse_image' satisfies DocImageMode,
        reuseLabel: '复用图像审核规则',
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
        reuseLabel: '复用图像审核规则',
        independentValue: 'independent',
      },
      {
        title: '语音审核',
        mode: videoComposeModes.audio_mode,
        reuseValue: 'reuse_audio' satisfies VideoAudioMode,
        reuseLabel: '复用短音频同步审核规则',
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
  // 文档 tab：任一段切到独立就显示独立规则树
  const docSegments = buildDocSegments()
  const showDocRulesTree =
    !!docSegments && docSegments.some((s) => s.mode === s.independentValue)
  // 视频 tab：任一段切到独立就显示独立规则树；抽帧频率始终可见
  const videoSegments = buildVideoSegments()
  const showVideoRulesTree =
    !!videoSegments && videoSegments.some((s) => s.mode === s.independentValue)

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
          {/* 规则树：仅在对应 tab 处于「独立」状态时渲染 */}
          {cat.key === 'audio' && showAudioRulesTree && (
            <RulesTreeView
              key={`${cat.key}-${voiceRuleMode}`}
              packageCode={PACKAGE_BY_MEDIA.audio}
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
            />
          )}
          {cat.key === 'doc' && showDocRulesTree && (
            <RulesTreeView
              key={`${cat.key}-independent`}
              packageCode={PACKAGE_BY_MEDIA.doc}
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
            />
          )}
          {cat.key === 'video' && showVideoRulesTree && (
            <RulesTreeView
              key={`${cat.key}-independent`}
              packageCode={PACKAGE_BY_MEDIA.video}
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
            />
          )}
          {/* 普通 tab（非合成类）的规则树 */}
          {cat.key !== 'audio' && cat.key !== 'doc' && cat.key !== 'video' && (
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
            />
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
