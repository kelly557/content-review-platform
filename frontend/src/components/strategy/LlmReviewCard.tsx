import { useEffect, useMemo, useState } from 'react'
import { App, Empty, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'
import { registeredModelsApi, type ActiveModelOption } from '@/api/registered-models'
import {
  LARGE_MODEL_CATEGORY_LABEL,
  LARGE_MODEL_CATEGORY_OPTIONS,
  type LargeModelCategory,
  type LlmReviewConfig,
} from '@/types/domain'

const { Text } = Typography

interface Props {
  value: LlmReviewConfig
  onChange: (next: LlmReviewConfig) => void
  /** 当前策略启用的审核模态列表（如 ['text','image']）；用于自动过滤大模型列表 */
  enabledMediaTypes?: string[]
}

/**
 * 策略级「大模型审核能力」卡片 — 单一开关、不区分素材类型。
 *
 * - 资源库候选：已激活 (`status=active`) 且 `scale_class=large` 的所有模型。
 * - 根据策略启用的审核模态自动过滤：
 *   只启用文本审核 → 显示所有大模型（text + multimodal）；
 *   启用了图片/音频/视频/文档 → 只显示 multimodal 大模型（多模态兼容文本）。
 */
export function LlmReviewCard({ value, onChange, enabledMediaTypes = [] }: Props) {
  const { message } = App.useApp()
  const [allOptions, setAllOptions] = useState<ActiveModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    registeredModelsApi
      .listActiveModels({ kind: 'large' }) // 列出已激活的大模型
      .then((list) => {
        if (!cancelled) setAllOptions(list)
      })
      .catch(() => {
        if (!cancelled) setAllOptions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 是否需要多模态：启用了非 text 模态（image/audio/doc/video）时只显示 multimodal
  const needsMultimodal = useMemo(() => {
    const nonText = enabledMediaTypes.filter((m) => m !== 'text')
    return nonText.length > 0
  }, [enabledMediaTypes])

  // 按模态需求过滤：多模态兼容文本，故 needsMultimodal 时只保留 multimodal
  const options = useMemo(() => {
    if (!needsMultimodal) return allOptions
    return allOptions.filter((m) => m.large_category === 'multimodal')
  }, [allOptions, needsMultimodal])

  // 过滤后当前选中模型不在列表中 → 自动清空（多模态兼容文本，无需提示）
  useEffect(() => {
    if (value.model_id && needsMultimodal) {
      const stillValid = options.some((m) => m.id === value.model_id)
      if (!stillValid) {
        onChange({ ...value, model_id: null, needs_multimodal_hint: false })
      }
    }
  }, [options, value.model_id, needsMultimodal])

  const pickedModel = useMemo(
    () => (value.model_id ? options.find((m) => m.id === value.model_id) ?? null : null),
    [options, value.model_id],
  )

  const onToggle = (checked: boolean) => {
    if (!checked) {
      onChange({
        is_enabled: false,
        model_id: null,
        needs_multimodal_hint: false,
      })
      return
    }
    onChange({
      is_enabled: true,
      model_id: value.model_id ?? null,
      needs_multimodal_hint: false,
    })
  }

  const onPickModel = (id: number | null) => {
    if (id == null) {
      onChange({
        ...value,
        model_id: null,
        // 清空 model 时把 hint 也清掉，避免被旧 hint 持续显示
        needs_multimodal_hint: false,
      })
      return
    }
    const picked = options.find((m) => m.id === id)
    if (!picked) {
      message.error('选择的模型已失效，请重新选择')
      return
    }
    onChange({
      ...value,
      is_enabled: true,
      model_id: id,
      // hint 由后端在 serialize 时按当前 enabled_items 重新计算并回传
      needs_multimodal_hint: false,
    })
  }

  return (
    <div
      style={{
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        borderRadius: 6,
        padding: '12px 16px',
      }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="center" wrap>
          <ExperimentOutlined style={{ color: '#0EA5E9', fontSize: 16 }} />
          <Text strong style={{ color: '#0F172A' }}>
            大模型审核能力
          </Text>
          <Tag color={value.is_enabled ? 'green' : 'default'} bordered={false}>
            {value.is_enabled ? '已开启' : '已关闭'}
          </Tag>
          {pickedModel && (
            <Tag color="blue" bordered={false}>
              {pickedModel.name}（{pickedModel.model_name ?? '-'}）
            </Tag>
          )}
          {pickedModel?.large_category && (
            <Tag
              color={
                LARGE_MODEL_CATEGORY_OPTIONS.find(
                  (o) => o.value === pickedModel.large_category,
                )?.color ?? 'default'
              }
              bordered={false}
            >
              {LARGE_MODEL_CATEGORY_LABEL[pickedModel.large_category as LargeModelCategory]}
            </Tag>
          )}
          <Switch checked={value.is_enabled} onChange={onToggle} />
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          开启后，策略下所有启用的通用审核规则在机审时都会叠加大模型的审核能力。
        </Text>

        {value.is_enabled && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              如待审核素材包含图片、音视频等非纯文本内容，请选择多模态模型
            </Text>
            {loading ? (
              <Spin size="small" />
            ) : options.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    暂无可用的已激活大模型；请到「资源库 → 模型库」完成接入并激活。
                  </Text>
                }
                style={{ padding: '8px 0' }}
              />
            ) : (
              <Select
                value={value.model_id ?? undefined}
                onChange={onPickModel}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="选择资源库已激活的大模型"
                style={{ width: '100%', maxWidth: 480 }}
                options={options.map((m) => {
                  const cat = m.large_category
                  const catLabel = cat ? LARGE_MODEL_CATEGORY_LABEL[cat] : null
                  const catColor = cat
                    ? (LARGE_MODEL_CATEGORY_OPTIONS.find((o) => o.value === cat)?.color ?? 'default')
                    : 'default'
                  return {
                    value: m.id,
                    // label 同时展示：大模型名 + 模型分类 + 模型技术名
                    label: (
                      <Space size={6} wrap style={{ width: '100%' }}>
                        <span style={{ color: '#0F172A' }}>{m.name}</span>
                        {catLabel && (
                          <Tag
                            color={catColor}
                            bordered={false}
                            style={{ margin: 0, fontSize: 11, padding: '0 6px' }}
                          >
                            {catLabel}
                          </Tag>
                        )}
                        {m.model_name && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            （{m.model_name}）
                          </Text>
                        )}
                      </Space>
                    ) as unknown as string,
                  }
                })}
              />
            )}
          </Space>
        )}
      </Space>
    </div>
  )
}
