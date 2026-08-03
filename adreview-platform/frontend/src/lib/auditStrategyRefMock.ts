/**
 * 审核策略引用 mock
 *
 * key: 模型自识别标签（discoveredTag）
 * value: 引用该标签的审核策略名称列表
 *
 * 用于「移除模型标签配置」前的风险提示，未在此 map 中的 discoveredTag
 * 默认不被任何策略引用。
 */
export const MOCK_AUDIT_STRATEGY_REFS: Record<string, string[]> = {
  涉政敏感人物: ['涉政审查默认策略 v3', '高敏人群审核加强版'],
  广告营销: ['广告法合规 v2'],
  暴恐血腥: ['全量安全审查 v1'],
  色情低俗: ['内容安全基础策略', '未成年人保护 v2'],
}

export function findStrategiesByDiscoveredTag(tag: string): string[] {
  return MOCK_AUDIT_STRATEGY_REFS[tag] ?? []
}