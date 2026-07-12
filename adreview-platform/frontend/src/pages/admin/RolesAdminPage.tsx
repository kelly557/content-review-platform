import { useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Checkbox,
  Space,
  Table,
  Typography,
  type TableColumnsType,
} from 'antd'
import { flattenMenuForTable, MENU_TREE } from '@/lib/menuTree'
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type MenuPermissionRow,
  type PermissionKey,
  type RolePermissions,
} from '@/types/role'
import { ROLE_LABELS, type UserRole } from '@/types/domain'

const { Title } = Typography

const EDITABLE_ROLES: UserRole[] = ['superadmin', 'admin', 'mlr', 'reviewer', 'submitter']

function buildMockPermissions(): RolePermissions {
  const rows = flattenMenuForTable()
  const out: Record<string, Record<string, Partial<Record<PermissionKey, boolean>>>> = {}
  for (const role of EDITABLE_ROLES) {
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
      out.mlr[row.menuNode.key] = { view: true }
      out.reviewer[row.menuNode.key] = { view: true }
      out.submitter[row.menuNode.key] = { view: true }
    }
  }
  return out as RolePermissions
}

const LEVEL1_LABEL: Record<string, string> = Object.fromEntries(
  MENU_TREE.map((n) => [n.key, n.label]),
)

export default function RolesAdminPage() {
  const { message } = App.useApp()
  const [activeRole, setActiveRole] = useState<UserRole>('admin')
  const [perms, setPerms] = useState<RolePermissions>(() => buildMockPermissions())
  const rows = useMemo(() => flattenMenuForTable(), [])

  const togglePerm = (menuKey: string, perm: PermissionKey, checked: boolean) => {
    setPerms((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [menuKey]: { ...prev[activeRole]?.[menuKey], [perm]: checked },
      },
    }))
  }

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
      <Card
        title={<Title level={4} style={{ margin: 0 }}>功能菜单权限</Title>}
        extra={
          <Space size="middle" wrap>
            <Space.Compact>
              {EDITABLE_ROLES.map((r) => (
                <Button
                  key={r}
                  type={activeRole === r ? 'primary' : 'default'}
                  onClick={() => setActiveRole(r)}
                >
                  {ROLE_LABELS[r]}
                </Button>
              ))}
            </Space.Compact>
            <Button
              type="primary"
              onClick={() =>
                message.success(`已保存 ${ROLE_LABELS[activeRole]} 的权限（仅本地）`)
              }
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