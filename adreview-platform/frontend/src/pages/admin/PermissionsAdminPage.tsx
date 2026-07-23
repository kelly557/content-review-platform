import { useCallback, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Checkbox,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { flattenMenuForTable, MENU_TREE } from '@/lib/menuTree'
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type MenuPermissionRow,
  type PermissionKey,
  type RolePermissions,
} from '@/types/role'
import {
  MERGED_ROLE_KEYS,
  MERGED_ROLE_LABELS,
  type MergedRoleKey,
} from '@/types/domain'

const { Title, Text } = Typography

function buildMockPermissions(): RolePermissions {
  const rows = flattenMenuForTable()
  const out: Record<string, Record<string, Partial<Record<PermissionKey, boolean>>>> = {}
  for (const role of MERGED_ROLE_KEYS) {
    out[role] = {}
    for (const row of rows) {
      out[role][row.menuNode.key] = { view: true }
    }
  }
  for (const row of rows) {
    out.superadmin[row.menuNode.key] = { view: true, edit: true, delete: true }
  }
  for (const row of rows) {
    if (row.menuNode.key === 'reports') {
      out.admin[row.menuNode.key] = { view: true }
    }
  }
  return out as RolePermissions
}

const LEVEL1_LABEL: Record<string, string> = Object.fromEntries(
  MENU_TREE.map((n) => [n.key, n.label]),
)

export default function PermissionsAdminPage() {
  const { message, modal } = App.useApp()
  const [activeRole, setActiveRole] = useState<MergedRoleKey>('admin')
  const [perms, setPerms] = useState<RolePermissions>(() => buildMockPermissions())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const rows = useMemo(() => flattenMenuForTable(), [])

  const togglePerm = useCallback(
    (menuKey: string, perm: PermissionKey, checked: boolean) => {
      setPerms((prev) => ({
        ...prev,
        [activeRole]: {
          ...prev[activeRole],
          [menuKey]: { ...prev[activeRole]?.[menuKey], [perm]: checked },
        },
      }))
      setDirty(true)
    },
    [activeRole],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    // mock: 模拟 300ms 延时
    await new Promise((r) => setTimeout(r, 300))
    setSaving(false)
    setDirty(false)
    message.success(
      `已保存 ${MERGED_ROLE_LABELS[activeRole]} 的权限（仅本地，Phase 5 落库）`,
    )
  }, [activeRole, message])

  const handleReset = useCallback(() => {
    setPerms((prev) => ({
      ...prev,
      [activeRole]: (() => {
        const out: Record<string, Partial<Record<PermissionKey, boolean>>> = {}
        for (const row of rows) {
          out[row.menuNode.key] = { view: true }
        }
        if (activeRole === 'superadmin') {
          for (const row of rows) {
            out[row.menuNode.key] = { view: true, edit: true, delete: true }
          }
        }
        if (activeRole === 'admin') {
          for (const row of rows) {
            if (row.menuNode.key === 'reports') {
              out[row.menuNode.key] = { view: true }
            }
          }
        }
        return out
      })(),
    }))
    setDirty(false)
    message.success(`已重置 ${MERGED_ROLE_LABELS[activeRole]} 的权限为默认值`)
  }, [activeRole, message, rows])

  const requestSwitchRole = useCallback(
    (next: MergedRoleKey) => {
      if (next === activeRole) return
      if (!dirty) {
        setActiveRole(next)
        return
      }
      modal.confirm({
        title: '切换角色',
        content: `当前 ${MERGED_ROLE_LABELS[activeRole]} 的权限改动尚未保存，切换后将丢失。是否继续？`,
        okText: '继续切换',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => {
          setActiveRole(next)
          setDirty(false)
        },
      })
    },
    [activeRole, dirty, modal],
  )

  const rowKey = (r: MenuPermissionRow) => `${r.level1}-${r.level2}`

  const columns: TableColumnsType<MenuPermissionRow> = [
    {
      title: '一级菜单',
      dataIndex: 'level1',
      width: '20%',
      render: (_v, row, _idx) => {
        if (row.level2 !== '__root__') return { children: null, props: { rowSpan: 0 } }
        const subCount = rows.filter((r) => r.level1 === row.level1).length
        return {
          children: <strong>{LEVEL1_LABEL[row.level1] ?? row.level1}</strong>,
          props: { rowSpan: subCount },
        }
      },
      onCell: (_row, index) => {
        const r = rows[index ?? 0]
        if (r.level2 !== '__root__') return { rowSpan: 0 }
        return { rowSpan: rows.filter((x) => x.level1 === r.level1).length }
      },
    },
    {
      title: '二级菜单',
      dataIndex: 'level2',
      width: '20%',
      render: (v: string, row) => (v === '__root__' ? '-' : row.menuNode.label),
    },
    {
      title: '操作',
      width: '60%',
      render: (_v, row) => {
        const node = row.menuNode
        const available = node.permissions ?? []
        return (
          <Space size="large">
            {PERMISSION_KEYS.map((p) => {
              const checked = !!perms[activeRole]?.[node.key]?.[p]
              const disabled = !available.includes(p)
              return (
                <Checkbox
                  key={p}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => togglePerm(node.key, p, e.target.checked)}
                >
                  {PERMISSION_LABELS[p]}
                </Checkbox>
              )
            })}
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Space direction="vertical" size={4} style={{ marginBottom: 16, width: '100%' }}>
        <Space size="middle">
          <Title level={4} style={{ margin: 0 }}>功能菜单权限</Title>
          {dirty && <Tag color="warning">未保存</Tag>}
        </Space>
        <Text type="secondary">
          当前为本地预览，保存后改动仅在本会话生效（Phase 5 落库）。
        </Text>
      </Space>

      <Card
        title={
          <Space size="small">
            <span>{MERGED_ROLE_LABELS[activeRole]} 的菜单权限</span>
            {dirty && <Tag color="warning">未保存</Tag>}
          </Space>
        }
        extra={
          <Space size="middle" wrap>
            <Space.Compact>
              {MERGED_ROLE_KEYS.map((r) => (
                <Button
                  key={r}
                  type={activeRole === r ? 'primary' : 'default'}
                  onClick={() => requestSwitchRole(r)}
                >
                  {MERGED_ROLE_LABELS[r]}
                </Button>
              ))}
            </Space.Compact>
            <Button onClick={handleReset} disabled={!dirty}>
              重置
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty}
              onClick={handleSave}
            >
              保存
            </Button>
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey={rowKey}
          dataSource={rows}
          columns={columns}
          pagination={false}
        />
      </Card>
    </div>
  )
}
