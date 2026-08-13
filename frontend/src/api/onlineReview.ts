import { api } from './client'
import type { MaterialType } from '@/types/domain'
import type { UploadItem } from '@/components/task-create/UploadArea'
import type { OnlineReviewRequest, OnlineReviewResponse, OnlineReviewLogListItem, OnlineReviewLogDetail } from '@/api/onlineReviewTypes'

export interface OnlineDetectionResult {
  request: OnlineReviewRequest
  response: OnlineReviewResponse
  latencyMs: number
}

interface DetectApiResponse {
  conclusion: string
  log_id: number
  conclusionType: number
  data: Array<{ msg: string; conclusion: string; hits: OnlineReviewResponse['data'][number]['hits'] }>
  latency_ms: number
  strategy: { id: number; name: string } | null
  engines_used: string[]
  model: string | null
  llm_error: string | null
}

function buildRequestSummary(
  strategyId: number | undefined,
  items: UploadItem[],
  backendType: MaterialType,
  mode: 'single' | 'bulk',
  strategyName?: string,
): OnlineReviewRequest {
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      // 保留 data:image/...;base64, 前缀, 后端兼容
      resolve(result)
    }
    reader.readAsDataURL(file)
  })
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
  // 图片模式: 转 base64 发送; 文本模式: 走原逻辑
  const isImage = req.backendType === 'image'
  let postItems: Array<{ kind: string; name: string; text?: string; image_base64?: string }>

  if (isImage) {
    const imageItems = req.items.filter((it) => it.file)
    if (imageItems.length === 0) {
      postItems = [{ kind: 'image', name: '空图片', image_base64: '' }]
    } else {
      const base64List = await Promise.all(imageItems.map((it) => fileToBase64(it.file!)))
      postItems = imageItems.map((it, i) => ({
        kind: 'image',
        name: it.file!.name,
        image_base64: base64List[i],
      }))
    }
  } else {
    const texts = req.items
      .filter((it) => it.textBody && it.textBody.trim())
      .map((it) => it.textBody)
    postItems = texts.length
      ? texts.map((t, i) => ({ kind: 'text', name: `文本-${i + 1}`, text: t }))
      : [{ kind: 'text', name: '空文本', text: '' }]
  }

  const { data } = await api.post<DetectApiResponse>(
    '/online-review/detect',
    {
      strategy_id: req.strategyId ?? null,
      media_type: req.backendType,
      mode: req.mode,
      items: postItems,
    },
    { signal },
  )

  const response: OnlineReviewResponse = {
    conclusion: data.conclusion,
    log_id: data.log_id,
    conclusionType: data.conclusionType,
    strategy: data.strategy ?? null,
    engines_used: data.engines_used ?? [],
    model: data.model ?? null,
    llm_error: data.llm_error ?? null,
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

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------

export interface ListLogsParams {
  media_type?: string
  strategy_id?: number
  conclusion?: string
  limit?: number
  offset?: number
}

export async function listOnlineReviewLogs(
  params: ListLogsParams = {},
): Promise<OnlineReviewLogListItem[]> {
  const search = new URLSearchParams()
  if (params.media_type) search.set('media_type', params.media_type)
  if (params.strategy_id) search.set('strategy_id', String(params.strategy_id))
  if (params.conclusion) search.set('conclusion', params.conclusion)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const qs = search.toString()
  const { data } = await api.get<OnlineReviewLogListItem[]>(
    `/online-review/logs${qs ? `?${qs}` : ''}`,
  )
  return data
}

export async function getOnlineReviewLog(
  id: number,
): Promise<OnlineReviewLogDetail> {
  const { data } = await api.get<OnlineReviewLogDetail>(`/online-review/logs/${id}`)
  return data
}
