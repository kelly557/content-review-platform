import { useEffect, useState } from 'react'
import {
  Button,
  Empty,
  Image,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  App,
} from 'antd'
import {
  PlusOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import { librariesApi } from '@/api/libraries'
import type { Library, LibraryItem } from '@/types/domain'
import ImageUploadDrawer from '@/components/library/ImageUploadDrawer'
import EditLibraryEffectiveModal from '@/components/library/EditLibraryEffectiveModal'
import EditPlatformToggleModal from '@/components/library/EditPlatformToggleModal'
import { useAuthStore } from '@/store'
import { deriveEffectiveMeta } from '@/lib/libraryEffective'

const { Title, Text } = Typography

export default function ImageLibraryDetailPage() {
  const { id: rawId } = useParams<{ id?: string }>()
  const libraryId =
    rawId != null && !Number.isNaN(Number(rawId)) ? Number(rawId) : null
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const isSuperadmin = user?.role === 'superadmin'

  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editEffOpen, setEditEffOpen] = useState(false)
  const [editPlatformOpen, setEditPlatformOpen] = useState(false)

  const effectiveMeta = deriveEffectiveMeta(
    library?.is_active ?? false,
    library?.effective_from ?? null,
    library?.effective_until ?? null,
  )

  function effectiveTooltip(lib: Library): string {
    if (lib.library_type === 'reply') return '代答库不支持有效时间'
    if (!lib.effective_from && !lib.effective_until) return '永久：一直生效'
    return `到期后审核默认不生效`
  }

  const fetchLibrary = async () => {
    if (libraryId == null) return
    setLoading(true)
    try {
      setLibrary(await librariesApi.get(libraryId))
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(d ?? '加载库失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchItems = async () => {
    if (libraryId == null) return
    setItemsLoading(true)
    try {
      const data = await librariesApi.listItems(libraryId, { size: 200 })
      setItems(data.items)
    } finally {
      setItemsLoading(false)
    }
  }

  useEffect(() => {
    void fetchLibrary()
    void fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId])

  const onDeleteItem = async (itemId: number) => {
    if (!library) return
    try {
      await librariesApi.deleteItem(library.id, itemId)
      message.success('已删除')
      void fetchItems()
      void fetchLibrary()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(d ?? '删除失败')
    }
  }

  if (libraryId == null) {
    return <Empty description="无效的图片库 ID" />
  }

  return (
    <div style={{ width: '100%' }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to="/knowledge/images" style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            图片库
          </Space>
        </Link>
      </Space>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space size={12} align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            {library?.name ?? '加载中…'}
          </Title>
          {library?.kind && (
            <Tag color={library.kind === '黑名单' ? 'red' : 'green'}>
              {library.kind}
            </Tag>
          )}
          {library && (
            <>
              <Tooltip title={effectiveTooltip(library)}>
                <Tag color={effectiveMeta.color}>{effectiveMeta.status}</Tag>
              </Tooltip>
              {effectiveMeta.rangeText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {effectiveMeta.rangeText}
                </Text>
              )}
            </>
          )}
          {library && !library.is_active && <Tag>已停用</Tag>}
          {library?.is_platform && (
            <Tooltip title="通用平台库:仅超级管理员可见可改可删">
              <Tag color="purple">通用平台</Tag>
            </Tooltip>
          )}
          <Button
            type="link"
            size="small"
            icon={<ClockCircleOutlined />}
            onClick={() => setEditEffOpen(true)}
            disabled={!library}
          >
            编辑有效期
          </Button>
          {isSuperadmin && library && (
            <Button
              type="link"
              size="small"
              onClick={() => setEditPlatformOpen(true)}
            >
              {library.is_platform ? '改为个性化' : '设为通用平台'}
            </Button>
          )}
        </Space>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
            disabled={!library}
          >
            添加图片
          </Button>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchItems()} />
        </Space>
      </div>

      {loading || itemsLoading ? null : items.length === 0 ? (
        <Empty description="暂无图片,点击「添加图片」上传" />
      ) : (
        <Image.PreviewGroup>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((it) => (
              <div
                key={it.id}
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: 6,
                  background: '#fff',
                }}
              >
                <Image
                  src={librariesApi.itemDownloadUrl(library!.id, it.id)}
                  alt={it.original_filename ?? ''}
                  style={{ width: '100%', height: 120, objectFit: 'cover' }}
                />
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    color: '#475569',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={it.original_filename ?? ''}
                >
                  {it.original_filename ?? '—'}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {it.file_size ? `${(it.file_size / 1024).toFixed(1)} KB` : ''}
                  </Text>
                  <Popconfirm
                    title="确认删除该图片？"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDeleteItem(it.id)}
                  >
                    <Button type="link" size="small" danger style={{ padding: 0 }}>
                      <DeleteOutlined />
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}

      <ImageUploadDrawer
        open={addOpen}
        library={library}
        onCancel={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false)
          void fetchItems()
          void fetchLibrary()
        }}
      />
      <EditLibraryEffectiveModal
        open={editEffOpen}
        library={library}
        onClose={() => setEditEffOpen(false)}
        onSuccess={(updated) => setLibrary(updated)}
      />
      <EditPlatformToggleModal
        open={editPlatformOpen}
        library={library}
        onClose={() => setEditPlatformOpen(false)}
        onSuccess={(updated) => setLibrary(updated)}
      />
    </div>
  )
}