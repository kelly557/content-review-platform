import { App } from 'antd'
import { api } from './client'

export type AgentParseStatus = 'pending' | 'parsing' | 'success' | 'failed'

export interface AgentParseDocument {
  id: string
  file: File
  name: string
  size: number
  status: AgentParseStatus
  progress: number
  message?: string
  preview?: string
  charCount?: number
  durationMs?: number
  startedAt?: number
  /** 解析出的结构化审核点 (审核标签 + 审核描述) */
  points?: { label: string; desc: string }[]
}

export const ACCEPT_MIME = ['.txt', '.xls', '.xlsx']
export const ACCEPT_EXT_LABEL = 'Txt、Excel'
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_PREVIEW_CHARS = 10000
export const PREVIEW_LINE_LIMIT = 50

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function readTextPreview(file: File, maxChars = MAX_PREVIEW_CHARS): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve('')
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const lines = text.split(/\r?\n/)
      const trimmed = lines.slice(0, PREVIEW_LINE_LIMIT).join('\n')
      resolve(trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed)
    }
    reader.readAsText(file)
  })
}

export function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase()
  const ok = ACCEPT_MIME.some((ext) => lower.endsWith(ext))
  if (!ok) return `文件格式不支持,仅支持 ${ACCEPT_EXT_LABEL}`
  if (file.size > MAX_FILE_BYTES) return '文件大小超过 20MB 限制'
  return null
}

export function genDocId(): string {
  return `doc-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
}

export function downloadFile(doc: AgentParseDocument) {
  const url = URL.createObjectURL(doc.file)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface RunParseOptions {
  onProgress?: (progress: number) => void
}

interface ParseDocApiResponse {
  points: { label: string; desc: string }[]
  source_info: string
  preview: string
  char_count: number
}

/**
 * 调用后端文档解析端点，返回解析出的文本预览与审核点。
 * onProgress 仅在开始/结束回调（后端一次性返回，无中间进度）。
 */
export async function runParseDoc(
  doc: AgentParseDocument,
  opts: RunParseOptions = {},
): Promise<Pick<AgentParseDocument, 'status' | 'preview' | 'charCount' | 'durationMs' | 'message' | 'points'>> {
  const startedAt = Date.now()
  opts.onProgress?.(30)
  const fd = new FormData()
  fd.append('file', doc.file)
  try {
    const { data } = await api.post<ParseDocApiResponse>('/review-agents/parse-doc', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    opts.onProgress?.(100)
    return {
      status: 'success',
      preview: data.preview || (await readTextPreview(doc.file)),
      charCount: data.char_count,
      durationMs: Date.now() - startedAt,
      points: data.points ?? [],
    }
  } catch (e) {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    return {
      status: 'failed',
      message: detail ?? '解析失败，请稍后重试',
      durationMs: Date.now() - startedAt,
    }
  }
}

export function useParseMessage() {
  const { message } = App.useApp()
  return {
    success: (text: string) => message.success(text),
    error: (text: string) => message.error(text),
    warning: (text: string) => message.warning(text),
    info: (text: string) => message.info(text),
  }
}