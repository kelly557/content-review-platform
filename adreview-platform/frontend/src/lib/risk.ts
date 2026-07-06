import type { AgentRiskLevel, ReviewDecision } from '@/types/domain'

export const RISK_COLOR: Record<AgentRiskLevel, string> = {
  高风险: 'red',
  中风险: 'orange',
  低风险: 'gold',
  无风险: 'green',
}

export type SuggestedAction = ReviewDecision | 'review'

export type RiskTone = 'success' | 'info' | 'warning' | 'error'

export interface SuggestedActionInfo {
  action: SuggestedAction
  label: string
  reason: string
  tone: RiskTone
}

export function suggestAction(risk: AgentRiskLevel | undefined): SuggestedActionInfo {
  switch (risk) {
    case '高风险':
      return {
        action: 'rejected',
        label: '建议：驳回',
        reason: 'AI 判定高风险，建议驳回并退回提交者修改。',
        tone: 'error',
      }
    case '中风险':
      return {
        action: 'returned',
        label: '建议：退回修改',
        reason: '存在中风险命中，建议退回补充材料或修改文案。',
        tone: 'warning',
      }
    case '低风险':
      return {
        action: 'review',
        label: '建议：人工复审',
        reason: '存在低风险命中，需人工复核具体内容后再决定。',
        tone: 'info',
      }
    case '无风险':
    default:
      return {
        action: 'approved',
        label: '建议：通过',
        reason: 'AI 未发现显著风险，可按合规要求通过。',
        tone: 'success',
      }
  }
}

export function truncate(text: string, max = 60): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}