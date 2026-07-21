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

function randomLatency() {
  return Math.round(1500 + Math.random() * 1500)
}

function pickPoints<T>(points: T[], count: number): T[] {
  if (count <= 0 || points.length === 0) return []
  const shuffled = [...points].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, points.length))
}

export function runTest(input: {
  modality: '文本' | '图像' | '图文'
  text: string
  mode: TestModality
  points: { id: string; label: string }[]
}): Promise<TestResult> {
  const latencyMs = randomLatency()
  const segments =
    input.mode === 'multi'
      ? input.text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      : [input.text]

  return new Promise((resolve) => {
    setTimeout(() => {
      const triggeredCount =
        input.points.length > 0
          ? Math.min(input.points.length, Math.max(0, Math.floor(Math.random() * 3)))
          : 0
      const triggered = input.points.map((p) => ({
        pointId: p.id,
        label: p.label,
        triggered: false,
      }))
      const picked = pickPoints(input.points, triggeredCount)
      for (const p of picked) {
        const idx = triggered.findIndex((t) => t.pointId === p.id)
        if (idx >= 0) triggered[idx].triggered = true
      }

      const decision: 'pass' | 'block' = triggeredCount > 0 ? 'block' : 'pass'
      const confidence = Math.round((60 + Math.random() * 35) * 10) / 10

      const raw = {
        decision,
        segments,
        triggered_points: triggered.filter((t) => t.triggered).map((t) => t.label),
        latency_ms: latencyMs,
      }

      resolve({
        decision,
        latencyMs,
        confidence,
        triggered,
        rawOutput: JSON.stringify(raw, null, 2),
      })
    }, latencyMs)
  })
}