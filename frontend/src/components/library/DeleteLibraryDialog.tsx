import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
  Spin,
  Tag,
} from 'antd'
import { librariesApi } from '@/api/libraries'
import type {
  AuditPointRef,
  Library,
  LibraryDeletePayload,
  LibraryType,
} from '@/types/domain'

const { Text } = Typography

interface Props {
  open: boolean
  library: Library | null
  onCancel: () => void
  onSuccess: (result: { transferred_to: number | null; forced: boolean; affected: number }) => void
}

export default function DeleteLibraryDialog({
  open,
  library,
  onCancel,
  onSuccess,
}: Props) {
  const [mode, setMode] = useState<'transfer' | 'force' | 'cancel'>('cancel')
  const [refs, setRefs] = useState<AuditPointRef[]>([])
  const [refsLoading, setRefsLoading] = useState(false)
  const [transferTo, setTransferTo] = useState<number | undefined>()
  const [candidates, setCandidates] = useState<Library[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const libType: LibraryType | undefined = library?.library_type

  useEffect(() => {
    if (!open || !library) return
    setMode('cancel')
    setTransferTo(undefined)
    setRefsLoading(true)
    setCandidatesLoading(true)
    Promise.all([
      librariesApi.references(library.id),
      librariesApi
        .list({ type: libType, size: 200 })
        .then((p) => p.items.filter((l) => l.id !== library.id && !l.is_deleted))
        .catch(() => []),
    ])
      .then(([r, c]) => {
        setRefs(r)
        setCandidates(c as Library[])
      })
      .finally(() => {
        setRefsLoading(false)
        setCandidatesLoading(false)
      })
  }, [open, library?.id, libType])

  const hasRefs = refs.length > 0
  const transferOptions = useMemo(
    () =>
      candidates.map((c) => ({
        value: c.id,
        label: `${c.name}（${c.code}）`,
      })),
    [candidates],
  )

  const submit = async () => {
    if (!library) return
    if (mode === 'cancel') {
      onCancel()
      return
    }
    if (mode === 'transfer' && !transferTo) return
    const body: LibraryDeletePayload =
      mode === 'transfer'
        ? { transfer_to_library_id: transferTo, force: false }
        : { force: true }
    setSubmitting(true)
    try {
      const res = await librariesApi.delete(library.id, body)
      onSuccess({
        transferred_to: res.transferred_to,
        forced: res.forced,
        affected: res.affected_audit_points,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const okDisabled =
    submitting ||
    (mode === 'transfer' && !transferTo) ||
    refsLoading ||
    candidatesLoading

  return (
    <Modal
      open={open}
      title={library ? `删除「${library.name}」` : '删除'}
      okText={mode === 'cancel' ? '关闭' : '确认删除'}
      cancelText="返回"
      confirmLoading={submitting}
      okButtonProps={{ danger: mode !== 'cancel', disabled: okDisabled }}
      onCancel={onCancel}
      onOk={submit}
      destroyOnHidden
      width={560}
    >
      <Spin spinning={refsLoading || candidatesLoading}>
        {hasRefs ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              <span>
                该库当前被 <b>{refs.length}</b> 个审核点引用：
              </span>
            }
            description={
              <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 6 }}>
                {refs.map((r) => (
                  <div key={r.audit_point_id} style={{ fontSize: 12, color: '#475569' }}>
                    · {r.service_code} · {r.label}
                  </div>
                ))}
              </div>
            }
          />
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="该库当前未被任何审核点引用,可安全删除"
          />
        )}

        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Radio value="transfer" disabled={!hasRefs || candidates.length === 0}>
              <Space>
                转移到其他库
                {!hasRefs && <Tag>无引用</Tag>}
                {hasRefs && candidates.length === 0 && <Tag color="orange">无可选目标</Tag>}
              </Space>
              {mode === 'transfer' && (
                <div style={{ marginTop: 6, marginLeft: 24 }}>
                  <Select
                    placeholder="选择目标词库/图库"
                    options={transferOptions}
                    value={transferTo}
                    onChange={setTransferTo}
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                  />
                </div>
              )}
            </Radio>

            <Radio value="force" disabled={!hasRefs}>
              强制删除（清空审核点引用）
              {mode === 'force' && hasRefs && (
                <div style={{ marginTop: 6, marginLeft: 24 }}>
                  <Text type="danger" style={{ fontSize: 12 }}>
                    ⚠ 这 {refs.length} 个审核点的 custom_library_id 将被置空
                  </Text>
                </div>
              )}
            </Radio>

            <Radio value="cancel">取消</Radio>
          </Space>
        </Radio.Group>
      </Spin>
    </Modal>
  )
}