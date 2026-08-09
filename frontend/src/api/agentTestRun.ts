import { reviewAgentsApi } from './reviewAgents'

export type TestModality = 'single' | 'multi'

export interface TestSample {
  id: string
  label: string
  content: string
}

export interface TestTriggeredPoint {
  pointId: string
  label: string
  triggered: boolean
}

export interface TestResult {
  decision: 'pass' | 'block'
  latencyMs: number
  confidence: number
  triggered: TestTriggeredPoint[]
  rawOutput: string
}

const PRESET_SAMPLES: TestSample[] = [
  {
    id: 'sample-finance',
    label: '金融 - 违规示例',
    content: '【内部】100% 保本理财，年化 30%，加我微信 abc123 即可开户',
  },
  {
    id: 'sample-ad',
    label: '广告法 - 极限词示例',
    content: '本产品为中国第一、最佳、绝对有效，无任何副作用',
  },
  {
    id: 'sample-medical',
    label: '医药 - 处方药示例',
    content: '处方药处方购买链接：购买后立竿见影，根治糖尿病',
  },
]

export function getPresetSamples(): TestSample[] {
  return PRESET_SAMPLES
}

/**
 * 对指定智能体发起在线效果测试。
 * agentId 为后端数值 id（字符串形式）。
 */
export async function runTest(input: {
  agentId: string
  modality: '文本' | '图像' | '图文'
  text: string
  mode: TestModality
  points: { id: string; label: string }[]
}): Promise<TestResult> {
  const r = await reviewAgentsApi.test(Number(input.agentId), {
    modality: input.modality,
    text: input.text,
    mode: input.mode,
    points: input.points.map((p) => ({ id: p.id, label: p.label })),
  })
  return {
    decision: r.decision,
    latencyMs: r.latencyMs,
    confidence: r.confidence,
    triggered: r.triggered.map((t) => ({
      pointId: t.pointId,
      label: t.label,
      triggered: t.triggered,
    })),
    rawOutput: r.rawOutput,
  }
}