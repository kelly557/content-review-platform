/**
 * 「切换审核模型版本」弹窗 — 仅通用规则使用
 *
 * 根据当前规则的审核场景（small_category）和媒体类型（modality）过滤小模型。
 * 选中后 PUT /packages/{code}/items/{id} body={active_small_model_version_id: versionId}。
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

const MODALITY_BY_MEDIA: Record<string, string> = {
  image: 'image',
  text: 'text',
  audio: 'text',
  doc: 'text',
  video: 'image',
}

const CODE_TO_SMALL_CATEGORY: Record<string, string> = {
  politics: 'politics',
  terrorism: 'terrorism',
  violence: 'terrorism',
  porn: 'porn',
  prohibited: 'illicit',
  ad: 'ad',
  adlaw: 'ad_law',
  advertising: 'ad_law',
  religion: 'religion',
  abuse: 'abuse',
  vulgar: 'unhealthy',
  minor: 'unhealthy',
  values: 'unhealthy',
  illegal: 'unhealthy',
  privacy: 'unhealthy',
  promptattack: 'unhealthy',
  bad: 'unhealthy',
  sensitive: 'unhealthy',
  voiceprint: 'unhealthy',
  audioquality: 'unhealthy',
  image: 'unhealthy',
  text: 'unhealthy',
  frame: 'unhealthy',
  audio: 'unhealthy',
  subtitle: 'unhealthy',
}

function extractSmallCategory(itemCode: string): string | null {
  const parts = itemCode.split('_')
  if (parts.length < 2) return null
  const suffix = parts.slice(1).join('_')
  return CODE_TO_SMALL_CATEGORY[suffix] ?? null
}

interface ModelGroup {
  id: number
  code: string
  name: string
  provider_id: number | null
  model_name: string | null
  versions: RegisteredModelVersion[]
  versionsLoading: boolean
}

interface Props {
  item: AuditItem | null
  mediaType: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function SmallModelChooseModal({
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
    setPicked(item.active_small_model_version_id ?? null)
    setLoading(true)

    const smallCategory = extractSmallCategory(item.code)
    const modality = MODALITY_BY_MEDIA[mediaType] ?? null

    registeredModelsApi
      .listActiveModels({
        kind: 'small',
        small_category: smallCategory ?? undefined,
      })
      .then((rows) => {
        const filtered = modality
          ? rows.filter((r) => !r.modality || r.modality === modality)
          : rows
        setModels(
          filtered.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            provider_id: r.provider_id ?? null,
            model_name: r.model_name ?? null,
            versions: [],
            versionsLoading: false,
          })),
        )
      })
      .catch(() => {
        message.error('加载模型列表失败')
      })
      .finally(() => setLoading(false))
  }, [item, mediaType, message])

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
      message.success('已切换审核模型版本')
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
      title={item ? `切换审核模型版本 — ${item.name_cn}` : '切换审核模型版本'}
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
          <Empty description="暂无匹配的审核模型" />
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
                    {m.model_name ? ` · ${m.model_name}` : ''}
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
                        v.id === item?.active_small_model_version_id
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