import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Empty,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { auditItemsApi } from '@/api/auditItems'
import { librariesApi } from '@/api/libraries'
import type {
  AuditItem,
  LibraryListItem,
  LibraryType,
} from '@/types/domain'

const { Text } = Typography

const TYPE_LABEL: Record<LibraryType, string> = {
  image: '图库',
  word: '词库',
  reply: '代答库',
}
const TYPE_COLOR: Record<LibraryType, string> = {
  image: 'blue',
  word: 'green',
  reply: 'purple',
}

interface Props {
  open: boolean
  code: string
  item: AuditItem | null
  /** 当前策略名（用于编辑上下文物案；可省略） */
  strategyName?: string
  /** 媒体类型允许关联的库类型 */
  allowedTypes: LibraryType[]
  /** 是否只读；只读模式不显示保存按钮 */
  readOnly?: boolean
  onCancel: () => void
  onSaved: (next: AuditItem) => void
}

export function ItemLibrariesEditor({
  open,
  code,
  item,
  strategyName,
  allowedTypes,
  readOnly,
  onCancel,
  onSaved,
}: Props) {
  const { message } = App.useApp()
  const [libraryOptions, setLibraryOptions] = useState<LibraryListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    Promise.all(
      (['image', 'word', 'reply'] as LibraryType[]).map((t) =>
          librariesApi
            .list({ type: t, size: 200 })
            .then((p) => p.items.filter((l) => !l.is_deleted && l.is_active))
            .catch(() => [] as LibraryListItem[]),
      ),
    )
      .then(([img, word, reply]) => {
        if (cancelled) return
        setLibraryOptions([...img, ...word, ...reply])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !item) return
    setSelectedIds((item.linked_libraries ?? []).map((l) => l.library_id))
  }, [open, item])

  const lockedType: LibraryType | undefined = useMemo(() => {
    if (!item) return undefined
    const libs = item.linked_libraries ?? []
    if (libs.length === 0) return undefined
    const byType = libs[0].library_type
    const allSame = libs.every((l) => l.library_type === byType)
    return allSame ? (byType as LibraryType) : undefined
  }, [item])

  const allowedLibs = useMemo(
    () =>
      libraryOptions.filter((l) => {
        if (!allowedTypes.includes(l.library_type)) return false
        if (lockedType) return l.library_type === lockedType
        return true
      }),
    [libraryOptions, allowedTypes, lockedType],
  )

  const options = useMemo(
    () =>
      allowedLibs.map((l) => {
        const t = l.library_type
        return {
          value: l.id,
          label: (
            <Space size={4} align="center">
              <Tag color={TYPE_COLOR[t]} style={{ margin: 0 }}>
                {TYPE_LABEL[t]}
              </Tag>
              {l.kind && (
                <Tag
                  color={l.kind === '\u9ed1\u540d\u5355' ? 'red' : 'green'}
                  style={{ margin: 0 }}
                >
                  {l.kind}
                </Tag>
              )}
              <span>{l.name}</span>
              {l.is_platform && (
                <Tag color="gold" style={{ margin: 0 }}>
                  \u901a\u7528
                </Tag>
              )}
            </Space>
          ) as unknown as string,
        }
      }),
    [allowedLibs],
  )

  const onConfirm = async () => {
    if (!item || readOnly) return
    setSaving(true)
    try {
      const updated = await auditItemsApi.update(code, item.id, {
        linked_library_ids: selectedIds,
      })
      message.success('已保存关联词库 (全局生效)')
      onSaved(updated)
      onCancel()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail
      message.error(detail ?? (e as Error).message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={
        <Space>
          <Text strong>{'关联自定义图库词库'}</Text>
          {strategyName && (
            <Tag color="geekblue" style={{ margin: 0 }}>
              {`策略【${strategyName}】`}
            </Tag>
          )}
          {item && (
            <Tag color="blue" style={{ margin: 0 }}>
              {item.name_cn}
            </Tag>
          )}
        </Space>
      }
      width={720}
      destroyOnClose
      confirmLoading={saving}
      footer={readOnly ? null : undefined}
      onOk={onConfirm}
      okText="保存"
      cancelText="取消"
      okButtonProps={{
        disabled: readOnly || loading || allowedLibs.length === 0,
      }}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text strong>{'选择已激活的自定义词库'}</Text>
          <div style={{ marginTop: 6 }}>
            {loading ? (
              <Spin size="small" />
            ) : allowedLibs.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前媒体类型无可用库;请前往「资源库」页面创建并激活。
                  </Text>
                }
                style={{ padding: '12px 0' }}
              />
            ) : (
              <Select
                mode="multiple"
                disabled={readOnly}
                value={selectedIds}
                onChange={(ids) => {
                  if (lockedType) {
                    const filtered = ids.filter((id) => {
                      const lib = libraryOptions.find((l) => l.id === id)
                      return lib ? lib.library_type === lockedType : false
                    })
                    setSelectedIds(filtered)
                  } else if (ids.length > 0) {
                    const first = libraryOptions.find((l) => l.id === ids[0])
                    if (first) {
                      const filtered = ids
                        .map((id) => libraryOptions.find((l) => l.id === id))
                        .filter((l): l is LibraryListItem => !!l)
                        .filter((l) => l.library_type === first.library_type)
                        .map((l) => l.id)
                      setSelectedIds(filtered)
                    } else {
                      setSelectedIds([])
                    }
                  } else {
                    setSelectedIds([])
                  }
                }}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={
                  lockedType
                    ? `已锁定为 ${TYPE_LABEL[lockedType]} 类型,仅可选 ${TYPE_LABEL[lockedType]}`
                    : '选择自定义词库 (同 item 下只能选一种类型)'
                }
                style={{ width: '100%' }}
                options={options}
              />
            )}
          </div>
        </div>
      </Space>
    </Modal>
  )
}
