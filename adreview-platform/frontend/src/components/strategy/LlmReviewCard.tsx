import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Empty, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { ExperimentOutlined, WarningOutlined } from '@ant-design/icons'
import { registeredModelsApi, type ActiveModelOption } from '@/api/registered-models'
import { type LlmReviewConfig } from '@/types/domain'

const { Text } = Typography

interface Props {
  value: LlmReviewConfig
  onChange: (next: LlmReviewConfig) => void
}

/**
 * 策略级「大模型审核能力」卡片 — 单一开关、不区分素材类型。
 *
 * - 资源库候选：已激活 (`status=active`) 且 `scale_class=large` 的所有模型，含纯文本与多模态。
 * - 当策略启用项覆盖图片 / 音频 / 视频 / 文档，且所选模型缺少对应 modality 时，
 *   后端会把 ``needs_multimodal_hint=true`` 写回；这里以 Alert 提示用户切换到多模态模型。
 */
export function LlmReviewCard({ value, onChange }: Props) {
  const { message } = App.useApp()
  const [options, setOptions] = useState<ActiveModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    registeredModelsApi
      .listActiveModels({ kind: 'large' }) // 列出已激活的大模型
      .then((list) => {
        if (!cancelled) setOptions(list)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
          <Switch checked={value.is_enabled} onChange={onToggle} />
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          开启后，策略下所有启用的审核项在机审时都会调用所选大模型补充审核结果。开关不区分素材类型。
        </Text>

        {/* 多模态提示：仅在策略启用项覆盖图片/音频/视频/文档且所选模型不覆盖时显示 */}
        {value.is_enabled && value.needs_multimodal_hint && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="所选大模型缺少此策略所需的模态能力"
            description={
              <span>
                此策略启用的规则覆盖了图片 / 音频 / 视频 / 文档等非纯文本媒体，
                当前选定的大模型未同时覆盖这些模态。建议选择「多模态大模型」以避免
                「文本模型去处理图片审核」的不匹配。
              </span>
            }
          />
        )}

        {value.is_enabled && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              选择资源库已激活大模型（单选，含纯文本与多模态）
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
                options={options.map((m) => ({
                  value: m.id,
                  // 在 label 中标注模态能力，帮助用户在选单中识别多模态模型
                  label: (
                    <Space size={6} wrap>
                      <span>{m.name}</span>
                      {m.model_name && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          （{m.model_name}）
                        </Text>
                      )}
                    </Space>
                  ) as unknown as string,
                }))}
              />
            )}
          </Space>
        )}
      </Space>
    </div>
  )
}
