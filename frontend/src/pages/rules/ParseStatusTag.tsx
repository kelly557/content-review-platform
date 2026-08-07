/**
 * 解析状态 Tag — 行内展示文档聚合状态（多文件取最差）
 */
import { Tag, Tooltip } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, MinusCircleFilled } from '@ant-design/icons'
import type { UploadedDocument } from '@/types/domain'

type AggStatus = 'pending' | 'parsing' | 'parsed' | 'partial' | 'failed' | 'empty'

function aggregateStatus(docs: UploadedDocument[]): {
  status: AggStatus
  label: string
  color: string
  detail: string
} {
  if (docs.length === 0) {
    return { status: 'empty', label: '未上传', color: 'default', detail: '' }
  }
  const states = docs.map((d) => d.status)
  if (states.some((s) => s === 'parsing')) {
    return {
      status: 'parsing',
      label: '解析中',
      color: 'processing',
      detail: `${states.filter((s) => s === 'parsing').length} 个文件解析中`,
    }
  }
  if (states.some((s) => s === 'pending')) {
    return {
      status: 'pending',
      label: '待解析',
      color: 'default',
      detail: `${states.filter((s) => s === 'pending').length} 个文件待解析`,
    }
  }
  if (states.every((s) => s === 'failed')) {
    return {
      status: 'failed',
      label: '解析失败',
      color: 'error',
      detail: `${docs.length} 个文件全部失败`,
    }
  }
  if (states.some((s) => s === 'failed')) {
    return {
      status: 'partial',
      label: '部分失败',
      color: 'warning',
      detail: `${states.filter((s) => s === 'failed').length} 个文件失败`,
    }
  }
  return {
    status: 'parsed',
    label: '已解析',
    color: 'success',
    detail: `${docs.length} 个文件全部成功`,
  }
}

interface Props {
  documents: UploadedDocument[]
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  parsing: <LoadingOutlined spin />,
  failed: <CloseCircleFilled />,
  partial: <MinusCircleFilled />,
  parsed: <CheckCircleFilled />,
}

export default function ParseStatusTag({ documents }: Props) {
  const { status, label, color, detail } = aggregateStatus(documents)
  const icon = STATUS_ICON[status]
  const node = (
    <Tag
      color={color}
      icon={icon as never}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {label}
    </Tag>
  )
  return detail ? <Tooltip title={detail}>{node}</Tooltip> : node
}