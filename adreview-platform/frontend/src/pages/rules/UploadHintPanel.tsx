/**
 * 「上传知识规则文件」说明面板（顶部公共区域）。
 *
 * - 不再强制要求「先选中规则」——这是一个说明/统计区域，告诉用户：
 *   ① 上传是行级动作（点击文档列的「+ 上传文件」按钮即可）
 *   ② 全局上传进度
 *
 * - 上传的实际入口在每行 DocumentsCell 内的「+ 上传文件」按钮。
 */
import { useEffect, useState } from 'react'
import { Alert, Space, Typography } from 'antd'
import { CloudUploadOutlined, SyncOutlined } from '@ant-design/icons'

import { uploadedDocumentsApi } from '@/api/uploadedDocuments'
import type { AuditItem } from '@/types/domain'

const { Text } = Typography

interface Props {
  items: AuditItem[]
  packageCode: string
  onStatsChange?: (stats: { parsing: number; pending: number; failed: number }) => void
}

export default function UploadHintPanel({ items, packageCode, onStatsChange }: Props) {
  const [stats, setStats] = useState({ parsing: 0, pending: 0, failed: 0, total: 0 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchAll() {
      setLoading(true)
      try {
        let parsing = 0
        let pending = 0
        let failed = 0
        let total = 0
        await Promise.all(
          items.map(async (it) => {
            const resp = await uploadedDocumentsApi.list(packageCode, it.id).catch(() => null)
            if (!resp) return
            for (const d of resp.documents) {
              total += 1
              if (d.status === 'parsing') parsing += 1
              else if (d.status === 'pending') pending += 1
              else if (d.status === 'failed') failed += 1
            }
          }),
        )
        if (cancelled) return
        const next = { parsing, pending, failed, total }
        setStats(next)
        onStatsChange?.(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchAll()
    const t = setInterval(fetchAll, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [items, packageCode])

  return (
    <Alert
      type="info"
      showIcon
      icon={<CloudUploadOutlined />}
      message={
        <Space wrap>
          <Text strong>上传知识规则文件，AI 自动解析为审核点</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持法规文件（.pdf/.docx/.txt/.md）由大模型解析；结构化文件（.xlsx/.csv）按
            「审核点 | 审核内容」列直接导入
          </Text>
        </Space>
      }
      description={
        <Space size={16} wrap>
          <Text>
            💡 在下方表格的「文档」列点击{' '}
            <Text code>上传文件</Text> 即可为本规则上传文件
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            全局统计：共 {stats.total} 个文件 · 解析中{' '}
            <Text type={stats.parsing > 0 ? 'warning' : 'secondary'}>{stats.parsing}</Text> ·
            待解析 <Text type="secondary">{stats.pending}</Text> ·{' '}
            失败 <Text type={stats.failed > 0 ? 'danger' : 'secondary'}>{stats.failed}</Text>
          </Text>
          {loading && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <SyncOutlined spin /> 同步中…
            </Text>
          )}
        </Space>
      }
      style={{ marginBottom: 16 }}
    />
  )
}