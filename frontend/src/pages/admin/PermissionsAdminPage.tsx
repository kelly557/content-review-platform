import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { rolesApi, type RolePermissionRow } from '@/api/admin'

const { Title } = Typography

// 权限管理页可见的角色 Tab（root_admin 已隐藏）
const VISIBLE_ROLE_KEYS: ReadonlyArray<MergedRoleKey> = MERGED_ROLE_KEYS.filter(
  (r) => r !== 'root_admin',
)

// 不渲染"删除"checkbox 的节点（业务上无删除功能）
const NON_DELETE_NODES = new Set<string>(['query', 'reports'])

// 把后端 RolePermissionRow[] 与 MENU_TREE 默认 permissions 合并为 RolePermissions 状态
function mergeStoredIntoRole(
  base: RolePermissions,
  role: MergedRoleKey,
  stored: RolePermissionRow[],
): RolePermissions {
  const storedMap = new Map<string, Set<string>>()
  for (const r of stored) {
    storedMap.set(r.menu_key, new Set(r.permissions ?? []))
  }
  const menuRows = flattenMenuForTable()
  const next = { ...base, [role]: { ...base[role] } }
  for (const row of menuRows) {
    const node = row.menuNode
    const defaultPerms = node.permissions ?? []
    const storedPerms = storedMap.get(node.key)
    const initial: Partial<Record<PermissionKey, boolean>> = {}
    for (const p of PERMISSION_KEYS) {
      if (storedPerms) {
        initial[p] = storedPerms.has(p)
      } else {
        initial[p] = defaultPerms.includes(p)
      }
    }
    next[role][node.key] = initial
  }
  return next
}

const LEVEL1_LABEL: Record<string, string> = Object.fromEntries(
  MENU_TREE.map((n) => [n.key, n.label]),
)

export default function PermissionsAdminPage() {
  const { message, modal } = App.useApp()
  const [activeRole, setActiveRole] = useState<MergedRoleKey>('admin')
  const [perms, setPerms] = useState<RolePermissions>(() => {
    // 空初始 — 加载后填充
    const out: RolePermissions = {}
    for (const role of MERGED_ROLE_KEYS) out[role] = {}
    return out
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const rows = useMemo(() => flattenMenuForTable(), [])

  // 加载某角色权限
  const loadRolePerms = useCallback(
    async (role: MergedRoleKey) => {
      setLoading(true)
      try {
        const stored = await rolesApi.listPermissions(role)
        setPerms((prev) => mergeStoredIntoRole(prev, role, stored))
      } catch (e) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        message.error(detail ?? '加载权限失败')
      } finally {
        setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    loadRolePerms(activeRole)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole])

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
    try {
      const rolePerms = perms[activeRole] ?? {}
      const items: RolePermissionRow[] = Object.entries(rolePerms).map(
        ([menuKey, permMap]) => ({
          role_key: activeRole,
          menu_key: menuKey,
          permissions: PERMISSION_KEYS.filter((p) => permMap?.[p]),
        }),
      )
      await rolesApi.replacePermissions(activeRole, items)
      setDirty(false)
      message.success(`已保存 ${MERGED_ROLE_LABELS[activeRole]} 的菜单权限`)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }, [activeRole, perms, message])

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
        if (node.children && node.children.length > 0) return '-'
        const available = node.permissions ?? []
        // 总览永远只读：只显示「查看」checkbox（锁定），不显示编辑/删除
        if (node.key === 'overview') {
          return (
            <Space size="large">
              <Checkbox checked disabled>查看</Checkbox>
            </Space>
          )
        }
        return (
          <Space size="large">
            {PERMISSION_KEYS.map((p) => {
              // query / reports 不渲染"删除"checkbox（业务无该功能）
              if (p === 'delete' && NON_DELETE_NODES.has(node.key)) return null
              const checked = !!perms[activeRole]?.[node.key]?.[p]
              const inAvailable = available.includes(p)
              const disabled = !inAvailable || activeRole === 'superadmin'
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
      <Space size="middle" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>功能菜单权限</Title>
        {dirty && <Tag color="warning">未保存</Tag>}
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
              {VISIBLE_ROLE_KEYS.map((r) => (
                <Button
                  key={r}
                  type={activeRole === r ? 'primary' : 'default'}
                  onClick={() => requestSwitchRole(r)}
                >
                  {MERGED_ROLE_LABELS[r]}
                </Button>
              ))}
            </Space.Compact>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
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
          loading={loading}
        />
      </Card>
    </div>
  )
}
