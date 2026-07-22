import type { SmallModelModality } from '@/types/domain'

export interface ModelTestInput {
  modality: SmallModelModality
  inputText?: string
  imageFile?: File
  auditPoints: { label: string }[]
}

export interface ModelTestOutput {
  point: string
  triggered: boolean
  confidence: number
}

export interface ModelTestResponse {
  decision: 'pass' | 'block'
  latencyMs: number
  confidence: number
  results: ModelTestOutput[]
  rawOutput: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomLatency(): number {
  return Math.round(1500 + Math.random() * 1500)
}

function pickByRandom<T>(arr: T[], count: number): T[] {
  if (count <= 0 || arr.length === 0) return []
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, arr.length))
}

export async function runModelTest(req: ModelTestInput): Promise<ModelTestResponse> {
  const latencyMs = randomLatency()
  await sleep(latencyMs)

  const points = req.auditPoints ?? []
  const triggerCount =
    points.length === 0
      ? 0
      : Math.min(points.length, Math.max(0, Math.floor(Math.random() * 3)))
  const picked = pickByRandom(points, triggerCount).map((p) => p.label)
  const triggered = new Set(picked)

  const results: ModelTestOutput[] = points.map((p) => {
    const isOn = triggered.has(p.label)
    return {
      point: p.label,
      triggered: isOn,
      confidence: isOn ? Math.round((60 + Math.random() * 35) * 10) / 10 : 0,
    }
  })

  const decision: 'pass' | 'block' = triggerCount > 0 ? 'block' : 'pass'
  const confidence =
    results.length > 0
      ? Math.round(
          (results.reduce((sum, r) => sum + r.confidence, 0) / results.length) * 10,
        ) / 10
      : 0

  const segments = req.inputText
    ? req.inputText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const raw = {
    decision,
    modality: req.modality,
    segments,
    image_provided: Boolean(req.imageFile),
    triggered_points: results.filter((r) => r.triggered).map((r) => r.point),
    latency_ms: latencyMs,
  }

  return {
    decision,
    latencyMs,
    confidence,
    results,
    rawOutput: JSON.stringify(raw, null, 2),
  }
}
