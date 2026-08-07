export type AccessCheckModality = 'text' | 'image' | 'audio' | 'video'

export interface AccessCheckInput {
  modality: AccessCheckModality
  endpoint_url: string
  name?: string
}

export interface AccessCheckResult {
  ok: boolean
  discoveredTags: string[]
  latencyMs: number
  message?: string
}

const TEXT_LABELS = [
  '涉政敏感',
  '广告营销',
  '色情低俗',
  '暴恐违禁',
  '辱骂攻击',
  '虚假宣传',
  '青少年不良',
  '隐私信息',
]

const IMAGE_LABELS = [
  '涉政敏感人物',
  '广告商品识别',
  '色情低俗',
  '暴恐血腥',
  '青少年不良',
  '公众人物',
  '商标侵权',
  '违规水印',
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomLatency(): number {
  return Math.round(1800 + Math.random() * 1000)
}

function randomCount(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, arr.length))
}

export async function runAccessCheck(
  input: AccessCheckInput,
): Promise<AccessCheckResult> {
  const latencyMs = randomLatency()
  await sleep(latencyMs)

  if (input.modality === 'text') {
    const count = randomCount(3, 5)
    return {
      ok: true,
      discoveredTags: pickRandom(TEXT_LABELS, count),
      latencyMs,
    }
  }

  if (input.modality === 'image') {
    const count = randomCount(3, 5)
    return {
      ok: true,
      discoveredTags: pickRandom(IMAGE_LABELS, count),
      latencyMs,
    }
  }

  const modLabel =
    input.modality === 'audio' ? '音频' : input.modality === 'video' ? '视频' : input.modality
  return {
    ok: false,
    discoveredTags: [],
    latencyMs,
    message: `当前模态「${modLabel}」暂不支持接入校验,请使用图片或文本模型`,
  }
}