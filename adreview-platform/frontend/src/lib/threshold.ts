import type {
  MediaPointMap,
  MediaPointOverrideMap,
  PointOverride,
} from '@/components/strategy/pointLevel'

export type Intensity = 'low' | 'medium' | 'high'

export interface IntensityPreset {
  /** 低风险分区间 [min, max] */
  low: [number, number]
  /** 中风险分区间 [min, max] */
  medium: [number, number]
  /** 高风险分区间 [min, max] */
  high: [number, number]
}

/**
 * 检测强度三档预设。
 *
 * 语义：风险分 = 模型给出的风险概率（0-100），阈值把它映射为 低/中/高 风险标签。
 * - 低等级（高召回）：highMin=50，风险分 >50 即判高风险，覆盖最广，少漏报。
 * - 中等级（默认/平衡）：highMin=70，三段均衡切分。
 * - 高等级（高精确）：highMin=90，仅风险分 >90 才判高风险，置信度门槛最高，少误报。
 *   风险分 <30 视为安全（无风险），低风险段从 30 起算。
 *
 * 三段以 0.01 间隔不重叠，覆盖 [lowMin, 100]（与 RulesTreeView 高风险段上限 100 一致）。
 */
export const INTENSITY_PRESETS: Record<Intensity, IntensityPreset> = {
  low: {
    low: [0, 25],
    medium: [25.01, 50],
    high: [50.01, 100],
  },
  medium: {
    low: [0, 35],
    medium: [35.01, 70],
    high: [70.01, 100],
  },
  high: {
    low: [30, 45],
    medium: [45.01, 90],
    high: [90.01, 100],
  },
}

export const DEFAULT_INTENSITY: Intensity = 'medium'

/**
 * 获取指定强度档位的三段 min 回退值。
 *
 * 用于 RulesTreeView 的 sub 阈值显示：当某个 point 没有用户自定义 override 时，
 * 用当前检测强度档的预设 min 值作为显示回退，而非 mock 默认值。
 * 这样切换检测强度时，即使 point 未启用（pointMap 为空），
 * sub 阈值输入框也会立即反映对应档位的预设值。
 */
export function getIntensityFallback(intensity: Intensity): {
  low_min: number
  medium_min: number
  high_min: number
} {
  const p = INTENSITY_PRESETS[intensity]
  return {
    low_min: p.low[0],
    medium_min: p.medium[0],
    high_min: p.high[0],
  }
}

/**
 * 将指定强度档位的预设阈值应用到所有已启用的审核点。
 *
 * 遍历 pointMap 中 is_enabled=true 的 point，写入 low/medium/high 三段区间
 * （共 6 个字段）。旧的单值字段（medium_threshold / high_threshold）会被清除，
 * 仅保留区间形态。返回新的 MediaPointOverrideMap（不 mutate 原对象）。
 *
 * 未启用的 point 不会生成 override 条目。
 */
export function applyIntensityPreset(
  pointMap: MediaPointMap,
  intensity: Intensity,
): MediaPointOverrideMap {
  const preset = INTENSITY_PRESETS[intensity]
  const next: MediaPointOverrideMap = {
    image: {},
    text: {},
    audio: {},
    doc: {},
    video: {},
  }
  for (const [media, byItem] of Object.entries(pointMap)) {
    const bucket = next[media as keyof MediaPointOverrideMap]
    for (const [itemIdStr, byPoint] of Object.entries(byItem)) {
      const itemId = Number(itemIdStr)
      for (const [pointIdStr, isEnabled] of Object.entries(byPoint)) {
        if (!isEnabled) continue
        const pointId = Number(pointIdStr)
        const ov: PointOverride = {
          low_threshold_min: preset.low[0],
          low_threshold_max: preset.low[1],
          medium_threshold_min: preset.medium[0],
          medium_threshold_max: preset.medium[1],
          high_threshold_min: preset.high[0],
          high_threshold_max: preset.high[1],
        }
        if (!bucket[itemId]) bucket[itemId] = {}
        bucket[itemId][pointId] = ov
      }
    }
  }
  return next
}
