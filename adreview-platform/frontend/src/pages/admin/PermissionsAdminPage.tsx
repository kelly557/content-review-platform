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

const { Title } = Typography

// 权限管理页可见的角色 Tab（root_admin 已隐藏）
const VISIBLE_ROLE_KEYS: ReadonlyArray<MergedRoleKey> = MERGED_ROLE_KEYS.filter(
  (r) => r !== 'root_admin',
)

// 不渲染"删除"checkbox 的节点（业务上无删除功能）
const NON_DELETE_NODES = new Set<string>(['query', 'reports'])

function buildMockPermissions(): RolePermissions {
  const rows = flattenMenuForTable()
  const out: Record<string, Record<string, Partial<Record<PermissionKey, boolean>>>> = {}

  // 管理员对以下节点仅查看（无编辑/删除）：词库-系统 / 代答库-系统 / 模型库(系统+自定义)
  const ADMIN_VIEW_ONLY_NODES = new Set<string>([
    'resources-words-system',
    'resources-replies-system',
    'resources-models',
  ])
  // 业务员对账号管理下子节点全部不勾选
  const STAFF_NO_ACCOUNT_NODES = new Set<string>([
    'admin-users',
    'admin-roles',
    'admin-permissions',
  ])

  for (const role of MERGED_ROLE_KEYS) {
    out[role] = {}
    for (const row of rows) {
      const node = row.menuNode
      const perms = node.permissions ?? []
      const initial: Partial<Record<PermissionKey, boolean>> = {}
      for (const p of PERMISSION_KEYS) {
        initial[p] = perms.includes(p)
      }
      out[role][node.key] = initial
    }
  }

  // 管理员：词库-系统 / 代答库-系统 / 模型库(系统+自定义) → 仅查看
  for (const key of ADMIN_VIEW_ONLY_NODES) {
    out.admin[key] = { view: true }
  }
  // 业务员：账号管理下 3 个子节点 → 全部不勾选
  for (const key of STAFF_NO_ACCOUNT_NODES) {
    out.staff[key] = {}
  }
  // superadmin / root_admin：全部全勾
  for (const row of rows) {
    out.superadmin[row.menuNode.key] = { view: true, edit: true, delete: true }
    out.root_admin[row.menuNode.key] = { view: true, edit: true, delete: true }
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
      `已保存 ${MERGED_ROLE_LABELS[activeRole]} 的菜单权限`,
    )
  }, [activeRole, message])

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
        />
      </Card>
    </div>
  )
}
