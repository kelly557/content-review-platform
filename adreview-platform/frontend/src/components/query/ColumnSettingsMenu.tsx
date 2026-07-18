import { useMemo } from 'react'
import { Button, Checkbox, Divider, Dropdown, type MenuProps } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { QUERY_COLUMNS, type QueryColumnKey } from '@/types/domain'

interface Props {
  visible: QueryColumnKey[]
  onChange: (next: QueryColumnKey[]) => void
}

export default function ColumnSettingsMenu({ visible, onChange }: Props) {
  const visibleSet = useMemo(() => new Set(visible), [visible])

  const toggle = (key: QueryColumnKey, checked: boolean) => {
    if (checked) {
      const set = new Set(visibleSet)
      set.add(key)
      onChange(QUERY_COLUMNS.filter((c) => set.has(c.key)).map((c) => c.key))
    } else {
      onChange(visible.filter((k) => k !== key))
    }
  }

  const menu: MenuProps = {
    items: [
      {
        key: 'columns',
        type: 'group',
        label: (
          <div style={{ minWidth: 200 }}>
            {QUERY_COLUMNS.map((c) => (
              <div key={c.key} style={{ padding: '4px 0' }}>
                <Checkbox
                  checked={visibleSet.has(c.key)}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                >
                  {c.title}
                </Checkbox>
              </div>
            ))}
            <div style={{ padding: '4px 0' }}>
              <Checkbox checked disabled>
                操作
              </Checkbox>
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                size="small"
                onClick={() => onChange(QUERY_COLUMNS.map((c) => c.key))}
              >
                全选
              </Button>
              <Button
                size="small"
                onClick={() =>
                  onChange(
                    QUERY_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
                  )
                }
              >
                重置默认
              </Button>
            </div>
          </div>
        ),
      },
    ],
  }

  return (
    <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
      <Button icon={<SettingOutlined />} aria-label="列设置" />
    </Dropdown>
  )
}