import type { TagTreeNode } from '@/types/domain'

/**
 * 业务标签三级树（mock）
 *
 * 用于「模型管理 / 配置标签」模块：为模型的 discoveredTag 匹配一个三级业务标签。
 * 全局唯一：每个三级节点只能被一个模型绑定。
 *
 * id 命名：`mock-l3-{l1}-{l2}-{leaf}`
 */
export const MOCK_BUSINESS_TAG_TREE: TagTreeNode[] = [
  {
    id: 'mock-l1-politics',
    name: '涉政',
    code: 'mock_l1_politics',
    level: 1,
    status: 'active',
    domain: 'politics',
    children: [
      {
        id: 'mock-l2-politics-top-leader',
        name: '一号领导',
        code: 'mock_l2_politics_top_leader',
        level: 2,
        status: 'active',
        domain: 'politics',
        children: [
          {
            id: 'mock-l3-politics-top-leader-real',
            name: '写实',
            code: 'mock_l3_politics_top_leader_real',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
          {
            id: 'mock-l3-politics-top-leader-cartoon',
            name: '漫画',
            code: 'mock_l3_politics_top_leader_cartoon',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
          {
            id: 'mock-l3-politics-top-leader-illust',
            name: '配图',
            code: 'mock_l3_politics_top_leader_illust',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
        ],
      },
      {
        id: 'mock-l2-politics-former-leader',
        name: '历任领导',
        code: 'mock_l2_politics_former_leader',
        level: 2,
        status: 'active',
        domain: 'politics',
        children: [
          {
            id: 'mock-l3-politics-former-leader-figure',
            name: '人像',
            code: 'mock_l3_politics_former_leader_figure',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
          {
            id: 'mock-l3-politics-former-leader-cartoon',
            name: '漫画',
            code: 'mock_l3_politics_former_leader_cartoon',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
        ],
      },
      {
        id: 'mock-l2-politics-symbol',
        name: '政治象征',
        code: 'mock_l2_politics_symbol',
        level: 2,
        status: 'active',
        domain: 'politics',
        children: [
          {
            id: 'mock-l3-politics-symbol-graffiti',
            name: '涂鸦',
            code: 'mock_l3_politics_symbol_graffiti',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
          {
            id: 'mock-l3-politics-symbol-tamper',
            name: '篡改',
            code: 'mock_l3_politics_symbol_tamper',
            level: 3,
            status: 'active',
            domain: 'politics',
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'mock-l1-terror',
    name: '暴恐',
    code: 'mock_l1_terror',
    level: 1,
    status: 'active',
    domain: 'violence',
    children: [
      {
        id: 'mock-l2-terror-org',
        name: '恐怖组织',
        code: 'mock_l2_terror_org',
        level: 2,
        status: 'active',
        domain: 'violence',
        children: [
          {
            id: 'mock-l3-terror-org-image',
            name: '画面',
            code: 'mock_l3_terror_org_image',
            level: 3,
            status: 'active',
            domain: 'violence',
            children: [],
          },
          {
            id: 'mock-l3-terror-org-text',
            name: '文字',
            code: 'mock_l3_terror_org_text',
            level: 3,
            status: 'active',
            domain: 'violence',
            children: [],
          },
          {
            id: 'mock-l3-terror-org-video',
            name: '视频',
            code: 'mock_l3_terror_org_video',
            level: 3,
            status: 'active',
            domain: 'violence',
            children: [],
          },
        ],
      },
      {
        id: 'mock-l2-terror-org-figure',
        name: '恐怖组织人物',
        code: 'mock_l2_terror_org_figure',
        level: 2,
        status: 'active',
        domain: 'violence',
        children: [
          {
            id: 'mock-l3-terror-org-figure-avatar',
            name: '头像',
            code: 'mock_l3_terror_org_figure_avatar',
            level: 3,
            status: 'active',
            domain: 'violence',
            children: [],
          },
          {
            id: 'mock-l3-terror-org-figure-cartoon',
            name: '卡通',
            code: 'mock_l3_terror_org_figure_cartoon',
            level: 3,
            status: 'active',
            domain: 'violence',
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'mock-l1-insult',
    name: '辱骂',
    code: 'mock_l1_insult',
    level: 1,
    status: 'active',
    domain: 'custom',
    children: [
      {
        id: 'mock-l2-insult-regional',
        name: '地域歧视',
        code: 'mock_l2_insult_regional',
        level: 2,
        status: 'active',
        domain: 'custom',
        children: [
          {
            id: 'mock-l3-insult-regional-text',
            name: '文字',
            code: 'mock_l3_insult_regional_text',
            level: 3,
            status: 'active',
            domain: 'custom',
            children: [],
          },
          {
            id: 'mock-l3-insult-regional-emoji',
            name: '表情包',
            code: 'mock_l3_insult_regional_emoji',
            level: 3,
            status: 'active',
            domain: 'custom',
            children: [],
          },
        ],
      },
      {
        id: 'mock-l2-insult-person',
        name: '人格侮辱',
        code: 'mock_l2_insult_person',
        level: 2,
        status: 'active',
        domain: 'custom',
        children: [
          {
            id: 'mock-l3-insult-person-text',
            name: '文字',
            code: 'mock_l3_insult_person_text',
            level: 3,
            status: 'active',
            domain: 'custom',
            children: [],
          },
          {
            id: 'mock-l3-insult-person-cartoon',
            name: '卡通',
            code: 'mock_l3_insult_person_cartoon',
            level: 3,
            status: 'active',
            domain: 'custom',
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'mock-l1-ads-law',
    name: '广告法',
    code: 'mock_l1_ads_law',
    level: 1,
    status: 'active',
    domain: 'ads_law',
    children: [
      {
        id: 'mock-l2-ads-law-misleading',
        name: '误导性虚假广告',
        code: 'mock_l2_ads_law_misleading',
        level: 2,
        status: 'active',
        domain: 'ads_law',
        children: [
          {
            id: 'mock-l3-ads-law-misleading-extreme',
            name: '极限词',
            code: 'mock_l3_ads_law_misleading_extreme',
            level: 3,
            status: 'active',
            domain: 'ads_law',
            children: [],
          },
          {
            id: 'mock-l3-ads-law-misleading-promise',
            name: '虚假承诺',
            code: 'mock_l3_ads_law_misleading_promise',
            level: 3,
            status: 'active',
            domain: 'ads_law',
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'mock-l1-ads',
    name: '广告',
    code: 'mock_l1_ads',
    level: 1,
    status: 'active',
    domain: 'ads_law',
    children: [
      {
        id: 'mock-l2-ads-contact',
        name: '联系方式',
        code: 'mock_l2_ads_contact',
        level: 2,
        status: 'active',
        domain: 'ads_law',
        children: [
          {
            id: 'mock-l3-ads-contact-qr',
            name: '二维码',
            code: 'mock_l3_ads_contact_qr',
            level: 3,
            status: 'active',
            domain: 'ads_law',
            children: [],
          },
          {
            id: 'mock-l3-ads-contact-private',
            name: '私人账号',
            code: 'mock_l3_ads_contact_private',
            level: 3,
            status: 'active',
            domain: 'ads_law',
            children: [],
          },
        ],
      },
    ],
  },
]

export function findTagById(
  tree: TagTreeNode[],
  id: string,
): TagTreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n
    if (n.children?.length) {
      const hit = findTagById(n.children, id)
      if (hit) return hit
    }
  }
  return null
}

export function buildTagPath(tree: TagTreeNode[], id: string): string {
  const path: string[] = []
  function dfs(nodes: TagTreeNode[], trail: string[]): boolean {
    for (const n of nodes) {
      if (n.id === id) {
        path.push(...trail, n.name)
        return true
      }
      if (n.children?.length && dfs(n.children, [...trail, n.name])) {
        return true
      }
    }
    return false
  }
  dfs(tree, [])
  return path.join(' / ')
}