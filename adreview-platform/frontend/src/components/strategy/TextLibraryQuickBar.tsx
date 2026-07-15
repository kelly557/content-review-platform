import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Divider,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { librariesApi } from '@/api/libraries'
import type { LibraryKind, LibraryListItem } from '@/types/domain'

const { Text } = Typography

type KindKey = 'blacklist' | 'whitelist'

const KIND_LABEL: Record<KindKey, string> = {
  blacklist: '黑名单',
  whitelist: '白名单',
}
const KIND_COLOR: Record<KindKey, string> = {
  blacklist: 'red',
  whitelist: 'green',
}
const LIBRARY_KIND_TO_KEY: Record<LibraryKind, KindKey> = {
  黑名单: 'blacklist',
  白名单: 'whitelist',
}

export default function TextLibraryQuickBar() {
  const [libs, setLibs] = useState<LibraryListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selections, setSelections] = useState<Record<KindKey, number[]>>({
    blacklist: [],
    whitelist: [],
  })
  const [pickerKind, setPickerKind] = useState<KindKey | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    librariesApi
      .list({ type: 'word', size: 200 })
      .then((p) => {
        if (cancelled) return
        setLibs(p.items.filter((l) => !l.is_deleted))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const libsByKind = useMemo(() => {
    const map: Record<KindKey, LibraryListItem[]> = { blacklist: [], whitelist: [] }
    libs.forEach((l) => {
      if (!l.kind) return
      const key = LIBRARY_KIND_TO_KEY[l.kind]
      if (key) map[key].push(l)
    })
    return map
  }, [libs])

  const libMap = useMemo(() => {
    const m = new Map<number, LibraryListItem>()
    libs.forEach((l) => m.set(l.id, l))
    return m
  }, [libs])

  const openPicker = (kind: KindKey) => {
    setSearch('')
    setPickerKind(kind)
  }

  const closePicker = () => {
    setPickerKind(null)
    setSearch('')
  }

  const toggleLib = (kind: KindKey, id: number, checked: boolean) => {
    setSelections((prev) => {
      const cur = prev[kind]
      const next = checked ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id)
      return { ...prev, [kind]: next }
    })
  }

  const removeLib = (kind: KindKey, id: number) => {
    toggleLib(kind, id, false)
  }

  const renderRow = (kind: KindKey) => {
    const selected = selections[kind]
    const selectedLibs = selected
      .map((id) => libMap.get(id))
      .filter((l): l is LibraryListItem => !!l)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '4px 0',
        }}
      >
        <Text strong style={{ minWidth: 120, color: '#0F172A' }}>
          自定义{KIND_LABEL[kind]}库
        </Text>
        <Button
          type={selected.length === 0 ? 'default' : 'primary'}
          icon={<PlusOutlined />}
          onClick={() => openPicker(kind)}
        >
          添加词库
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {selected.length > 0 ? `已选 ${selected.length}` : '未选'}
        </Text>
        {selectedLibs.map((lib) => (
          <Tag
            key={lib.id}
            bordered={false}
            closeIcon={<CloseOutlined />}
            onClose={() => removeLib(kind, lib.id)}
            style={{
              margin: 0,
              background: '#fff',
              border: '1px solid #E2E8F0',
              color: '#0F172A',
              fontSize: 12,
              padding: '2px 8px',
            }}
          >
            {lib.name}
          </Tag>
        ))}
      </div>
    )
  }

  const pickerLibs = pickerKind ? libsByKind[pickerKind] : []
  const filteredPickerLibs = pickerLibs.filter((l) =>
    search ? l.name.toLowerCase().includes(search.toLowerCase()) : true,
  )

  return (
    <>
      <div
        style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
          padding: '12px 16px',
          marginBottom: 12,
        }}
      >
        {loading ? (
          <div style={{ padding: '8px 0' }}>
            <Spin size="small" />
          </div>
        ) : (
          <>
            {renderRow('blacklist')}
            <Divider style={{ margin: '8px 0' }} />
            {renderRow('whitelist')}
          </>
        )}
      </div>

      <Modal
        open={pickerKind !== null}
        onCancel={closePicker}
        onOk={closePicker}
        title={`选择${pickerKind ? KIND_LABEL[pickerKind] : ''}词库`}
        okText="确定"
        cancelText="取消"
        width={560}
      >
        <Input.Search
          placeholder="搜索词库名称"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {filteredPickerLibs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {pickerLibs.length === 0
                  ? `暂无${pickerKind ? KIND_LABEL[pickerKind] : ''}词库,请前往「资源库 → 词库」创建。`
                  : '未匹配到结果'}
              </Text>
            }
            style={{ padding: '20px 0' }}
          />
        ) : (
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            value={pickerKind ? selections[pickerKind] : []}
            onChange={(vals) => {
              if (!pickerKind) return
              setSelections((prev) => ({
                ...prev,
                [pickerKind]: vals as number[],
              }))
            }}
          >
            {filteredPickerLibs.map((lib) => (
              <Checkbox key={lib.id} value={lib.id}>
                <Space size={6} align="center">
                  <Tag
                    color={pickerKind ? KIND_COLOR[pickerKind] : 'default'}
                    bordered={false}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {lib.kind}
                  </Tag>
                  <span style={{ color: '#0F172A' }}>{lib.name}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {lib.item_count} 词
                  </Text>
                </Space>
              </Checkbox>
            ))}
          </Checkbox.Group>
        )}
      </Modal>
    </>
  )
}