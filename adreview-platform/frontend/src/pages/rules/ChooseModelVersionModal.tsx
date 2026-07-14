/**
 * 「切换生效模型版本」弹窗 — 仅通用规则使用
 *
 * 列出 scale_class=large 且 status=active 的大模型；点开行展开 RegisteredModelVersion。
 * 选中后 PUT /packages/{code}/items/{id} body={active_large_model_version_id: versionId}。
 */
import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Collapse,
  Empty,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { registeredModelsApi } from '@/api/registered-models'
import { auditItemsApi } from '@/api/auditItems'
import type { AuditItem, MediaTypeKey, RegisteredModelVersion } from '@/types/domain'

const { Text } = Typography

const PACKAGE_BY_MEDIA: Record<MediaTypeKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

interface ModelGroup {
  id: number
  code: string
  name: string
  provider: string | null
  versions: RegisteredModelVersion[]
  versionsLoading: boolean
}

interface Props {
  item: AuditItem | null
  mediaType: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function ChooseModelVersionModal({
  item,
  mediaType,
  onClose,
  onSaved,
}: Props) {
  const { message } = App.useApp()
  const [models, setModels] = useState<ModelGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item) return
    setPicked(item.active_large_model_version_id ?? null)
    setLoading(true)
    registeredModelsApi
      .listActiveModels({ kind: 'large' })
      .then((rows) => {
        setModels(
          rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            provider: r.provider ?? null,
            versions: [],
            versionsLoading: false,
          })),
        )
      })
      .catch(() => {
        message.error('加载模型列表失败')
      })
      .finally(() => setLoading(false))
  }, [item, message])

  const expandModel = async (mid: number) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === mid ? { ...m, versionsLoading: true } : m,
      ),
    )
    try {
      const versions = await registeredModelsApi.listVersions(mid)
      setModels((prev) =>
        prev.map((m) =>
          m.id === mid
            ? {
                ...m,
                versions,
                versionsLoading: false,
              }
            : m,
        ),
      )
    } catch {
      message.error('加载版本失败')
      setModels((prev) =>
        prev.map((m) =>
          m.id === mid ? { ...m, versionsLoading: false } : m,
        ),
      )
    }
  }

  const save = async () => {
    if (!item) return
    if (picked === null) {
      message.warning('请选择要切换到的版本')
      return
    }
    setSaving(true)
    try {
      const pkg = PACKAGE_BY_MEDIA[mediaType as MediaTypeKey] ?? mediaType
      await auditItemsApi.setActiveModelVersion(pkg, item.id, picked)
      message.success('已切换生效模型版本')
      await onSaved()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '切换失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={item ? `切换生效模型版本 — ${item.name_cn}` : '切换生效模型版本'}
      open={!!item}
      onCancel={onClose}
      width={640}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={saving}
          onClick={save}
        >
          确认切换
        </Button>,
      ]}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {models.length === 0 && !loading ? (
          <Empty description="暂无 active 状态的大模型" />
        ) : (
          <Collapse
            accordion
            onChange={(k) => {
              const key = Array.isArray(k) ? k[0] : k
              if (key) void expandModel(Number(key))
            }}
            items={models.map((m) => ({
              key: String(m.id),
              label: (
                <Space>
                  <Text strong>{m.name}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {m.code}
                    {m.provider ? ` · ${m.provider}` : ''}
                  </Text>
                </Space>
              ),
              children: m.versionsLoading ? (
                <Spin size="small" />
              ) : m.versions.length === 0 ? (
                <Empty description="该模型暂无版本" />
              ) : (
                <Radio.Group
                  value={picked}
                  onChange={(e) => setPicked(e.target.value as number)}
                  style={{ width: '100%' }}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {m.versions.map((v) => {
                      const isCurrent =
                        v.id === item?.active_large_model_version_id
                      const isLatest = m.versions[0]?.id === v.id
                      return (
                        <Radio key={v.id} value={v.id}>
                          <Space>
                            <Text style={{ fontVariantNumeric: 'tabular-nums' }}>
                              v{v.version_no}
                              {v.version_label ? ` (${v.version_label})` : ''}
                            </Text>
                            {isLatest && <Tag color="blue">最新</Tag>}
                            {isCurrent && <Tag color="green">当前</Tag>}
                            <Tag>{v.status}</Tag>
                          </Space>
                        </Radio>
                      )
                    })}
                  </Space>
                </Radio.Group>
              ),
            }))}
          />
        )}
      </Spin>
    </Modal>
  )
}