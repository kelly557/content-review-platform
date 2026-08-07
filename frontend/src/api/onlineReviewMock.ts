import type { MaterialType } from '@/types/domain'
import type { UploadItem } from '@/components/task-create/UploadArea'

export interface MockRequestItem {
  index: number
  kind: 'file' | 'text'
  name: string
  size?: number
  mime?: string
  text_snippet?: string
}

export interface MockRequest {
  strategy_id: number | null
  strategy_name?: string
  backendType: MaterialType
  detection_mode: 'single' | 'bulk'
  item_count: number
  submitted_at: string
  items: MockRequestItem[]
}

export interface MockResponseHit {
  source: string
  position?: number
  matched_text?: string
  risk_level: string
  rule_code: string
  rule_label: string
}

export interface MockResponseDataItem {
  msg: string
  conclusion: string
  hits: MockResponseHit[]
}

export interface MockResponse {
  conclusion: string
  log_id: number
  phoneRisk: Record<string, never>
  isHitMd5: boolean
  conclusionType: number
  data: MockResponseDataItem[]
}

export interface OnlineDetectionMockResult {
  request: MockRequest
  response: MockResponse
  latencyMs: number
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

function randomLatency(): number {
  return Math.round(600 + Math.random() * 600)
}

function pickFileName(items: UploadItem[]): string {
  if (items.length === 0) return '未命名文案'
  const it = items[0]
  if (it.file) return it.file.name
  return it.textBody ? `文本-${it.textBody.slice(0, 12)}` : '未命名文案'
}

function pickFileMeta(items: UploadItem[]): {
  name: string
  size?: number
  mime?: string
  text_snippet?: string
} {
  if (items.length === 0) return { name: '未命名文案' }
  const it = items[0]
  if (it.file) {
    return { name: it.file.name, size: it.file.size, mime: it.file.type || '未知' }
  }
  const snippet = it.textBody.trim().slice(0, 120)
  return { name: '文本输入', text_snippet: snippet || '(空)' }
}

function buildRequest(
  strategyId: number | undefined,
  items: UploadItem[],
  backendType: MaterialType,
  mode: 'single' | 'bulk',
  strategyName?: string,
): MockRequest {
  const requestItems: MockRequestItem[] = items.map((it, idx) => {
    if (it.file) {
      return {
        index: idx,
        kind: it.rewriteAsVideo ? 'file' : 'file',
        name: it.file.name,
        size: it.file.size,
        mime: it.file.type || '未知',
      }
    }
    return {
      index: idx,
      kind: 'text',
      name: '文本输入',
      text_snippet: it.textBody.trim().slice(0, 120) || '(空)',
    }
  })
  if (requestItems.length === 0) {
    requestItems.push({ index: 0, kind: 'text', name: pickFileName(items), text_snippet: '(空)' })
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

function buildHardcodedResponse(): MockResponse {
  return {
    conclusion: '不合规',
    log_id: 17847762083563480,
    phoneRisk: {},
    isHitMd5: false,
    conclusionType: 2,
    data: [
      {
        msg: '存在一号领导姓名及职务不合规',
        conclusion: '不合规',
        hits: [
          {
            source: 'rules.policy.leaders',
            position: 12,
            matched_text: '某某书记',
            risk_level: 'high',
            rule_code: 'LEADER_NAME_TITLE',
            rule_label: '一号领导姓名及职务',
          },
        ],
      },
    ],
  }
}

export async function runOnlineDetectionMock(
  req: {
    strategyId?: number
    strategyName?: string
    items: UploadItem[]
    backendType: MaterialType
    mode: 'single' | 'bulk'
  },
  signal?: AbortSignal,
): Promise<OnlineDetectionMockResult> {
  const latencyMs = randomLatency()
  await sleep(latencyMs, signal)
  return {
    request: buildRequest(
      req.strategyId,
      req.items,
      req.backendType,
      req.mode,
      req.strategyName,
    ),
    response: buildHardcodedResponse(),
    latencyMs,
  }
}

export function pickRequestSummaryMeta(items: UploadItem[]): {
  name: string
  size?: number
  mime?: string
  text_snippet?: string
} {
  return pickFileMeta(items)
}