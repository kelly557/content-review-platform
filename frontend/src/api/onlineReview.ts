import { api } from './client'
import type { MaterialType } from '@/types/domain'
import type { UploadItem } from '@/components/task-create/UploadArea'
import type { MockRequest, MockResponse } from '@/api/onlineReviewMock'

export interface OnlineDetectionResult {
  request: MockRequest
  response: MockResponse
  latencyMs: number
}

interface DetectApiResponse {
  conclusion: string
  log_id: number
  conclusionType: number
  data: Array<{ msg: string; conclusion: string; hits: MockResponse['data'][number]['hits'] }>
  latency_ms: number
}

function buildRequestSummary(
  strategyId: number | undefined,
  items: UploadItem[],
  backendType: MaterialType,
  mode: 'single' | 'bulk',
  strategyName?: string,
): MockRequest {
  const requestItems = items.map((it, idx) => {
    if (it.file) {
      return {
        index: idx,
        kind: 'file' as const,
        name: it.file.name,
        size: it.file.size,
        mime: it.file.type || '未知',
      }
    }
    return {
      index: idx,
      kind: 'text' as const,
      name: '文本输入',
      text_snippet: it.textBody.trim().slice(0, 120) || '(空)',
    }
  })
  if (requestItems.length === 0) {
    requestItems.push({ index: 0, kind: 'text', name: '未命名文案', text_snippet: '(空)' })
  }
  return {
    strategy_id: strategyId ?? null,
    strategy_name: strategyName,
    backendType,
    detection_mode: mode,
    item_count: items.length,
    submitted_at: new Date().toISOString(),
    items: requestItems,
  }
}

export async function runOnlineDetection(
  req: {
    strategyId?: number
    strategyName?: string
    items: UploadItem[]
    backendType: MaterialType
    mode: 'single' | 'bulk'
  },
  signal?: AbortSignal,
): Promise<OnlineDetectionResult> {
  const texts = req.items
    .filter((it) => it.textBody && it.textBody.trim())
    .map((it) => it.textBody)

  const { data } = await api.post<DetectApiResponse>(
    '/online-review/detect',
    {
      strategy_id: req.strategyId ?? null,
      media_type: req.backendType,
      mode: req.mode,
      items: texts.length
        ? texts.map((t, i) => ({ kind: 'text', name: `文本-${i + 1}`, text: t }))
        : [{ kind: 'text', name: '空文本', text: '' }],
    },
    { signal },
  )

  const response: MockResponse = {
    conclusion: data.conclusion,
    log_id: data.log_id,
    phoneRisk: {},
    isHitMd5: false,
    conclusionType: data.conclusionType,
    data: data.data,
  }

  return {
    request: buildRequestSummary(
      req.strategyId,
      req.items,
      req.backendType,
      req.mode,
      req.strategyName,
    ),
    response,
    latencyMs: data.latency_ms,
  }
}
