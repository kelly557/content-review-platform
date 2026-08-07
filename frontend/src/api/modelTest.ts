import { api } from './client'
import type { SmallModelModality } from '@/types/domain'

export interface ModelTestInput {
  modality: SmallModelModality
  inputText?: string
  imageFile?: File
  auditPoints: { label: string }[]
  configuredTags?: { discoveredTag: string; tagPath: string }[]
  modelId?: number
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

export async function runModelTest(req: ModelTestInput): Promise<ModelTestResponse> {
  if (!req.modelId) {
    throw new Error('未指定模型，无法测试')
  }
  const { data } = await api.post<ModelTestResponse>(
    `/registered-models/${req.modelId}/test`,
    {
      modality: req.modality,
      input_text: req.inputText ?? null,
      audit_points: req.auditPoints.map((p) => ({ label: p.label })),
    },
  )
  // 后端 latency_ms → 前端 latencyMs
  return {
    ...data,
    latencyMs: (data as unknown as { latency_ms?: number }).latency_ms ?? data.latencyMs,
  }
}

