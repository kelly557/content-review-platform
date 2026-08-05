// 主流大模型预设 — 用于 CreateModelModal 的 "Provider 类型" 两级选择。
// 第一级：vendor（保留与 REGISTERED_MODEL_PROVIDER_PRESETS 同语义 → 后端 enum 不变）
// 第二级：vendor 下的主流模型列表（仅 UI 用，不写后端 enum）
//
// 选择某个具体模型时，会自动带出：
//   - endpoint_url      （若 preset 提供）
//   - model_name        （供 model 注册使用）
//   - modality          （若 preset 提供）
//   - large_category    （若 preset 提供）
import type {
  LargeModelCategory,
  RegisteredModelModality,
  RegisteredModelProvider,
} from '@/types/domain'

export interface MainstreamModelPreset {
  /** 唯一 key，例如 'qwen3-max' — 仅 UI 用 */
  key: string
  /** 显示名，例如 '通义千问 Qwen3-Max' */
  label: string
  /** 默认 model_name（写入后端 RegisteredModel.model） */
  defaultModelName: string
  /** 模态 */
  modality: RegisteredModelModality
  /** 大模型分类 */
  largeCategory: LargeModelCategory
}

/** vendor 分组 — 每个 vendor 下列出主流模型 */
export interface MainstreamVendorGroup {
  vendor: RegisteredModelProvider
  vendorLabel: string
  models: MainstreamModelPreset[]
}

export const MAINSTREAM_MODEL_GROUPS: MainstreamVendorGroup[] = [
  {
    vendor: 'bailian',
    vendorLabel: '阿里云 (DashScope / 百炼)',
    models: [
      {
        key: 'qwen3-max',
        label: '通义千问 Qwen3-Max',
        defaultModelName: 'qwen3-max',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'qwen3-plus',
        label: '通义千问 Qwen3-Plus',
        defaultModelName: 'qwen3-plus',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'qwen-long',
        label: '通义千问 Qwen-Long',
        defaultModelName: 'qwen-long',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'qwen-vl-max',
        label: '通义千问 Qwen-VL-Max',
        defaultModelName: 'qwen-vl-max',
        modality: 'image',
        largeCategory: 'multimodal',
      },
      {
        key: 'qwen-coder-plus',
        label: '通义千问 Qwen-Coder-Plus',
        defaultModelName: 'qwen-coder-plus',
        modality: 'text',
        largeCategory: 'text',
      },
    ],
  },
  {
    vendor: 'openai',
    vendorLabel: 'OpenAI',
    models: [
      {
        key: 'gpt-4o',
        label: 'GPT-4o',
        defaultModelName: 'gpt-4o',
        modality: 'image',
        largeCategory: 'multimodal',
      },
      {
        key: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        defaultModelName: 'gpt-4o-mini',
        modality: 'image',
        largeCategory: 'multimodal',
      },
      {
        key: 'o1',
        label: 'o1',
        defaultModelName: 'o1',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'o1-mini',
        label: 'o1-mini',
        defaultModelName: 'o1-mini',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'gpt-4-turbo',
        label: 'GPT-4 Turbo',
        defaultModelName: 'gpt-4-turbo',
        modality: 'text',
        largeCategory: 'text',
      },
    ],
  },
  {
    vendor: 'deepseek',
    vendorLabel: 'DeepSeek',
    models: [
      {
        key: 'deepseek-v3',
        label: 'DeepSeek-V3',
        defaultModelName: 'deepseek-chat',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'deepseek-r1',
        label: 'DeepSeek-R1',
        defaultModelName: 'deepseek-reasoner',
        modality: 'text',
        largeCategory: 'text',
      },
      {
        key: 'deepseek-vl2',
        label: 'DeepSeek-VL2',
        defaultModelName: 'deepseek-vl2',
        modality: 'image',
        largeCategory: 'multimodal',
      },
    ],
  },
]

/** 在所有分组内根据 key 查找预设 */
export function findMainstreamPreset(
  key: string | null | undefined,
): MainstreamModelPreset | null {
  if (!key) return null
  for (const g of MAINSTREAM_MODEL_GROUPS) {
    const m = g.models.find((mm) => mm.key === key)
    if (m) return m
  }
  return null
}

/** 在所有分组内根据 key 查找所属 vendor */
export function findMainstreamVendorOfPreset(
  key: string | null | undefined,
): RegisteredModelProvider | null {
  if (!key) return null
  for (const g of MAINSTREAM_MODEL_GROUPS) {
    if (g.models.some((m) => m.key === key)) return g.vendor
  }
  return null
}