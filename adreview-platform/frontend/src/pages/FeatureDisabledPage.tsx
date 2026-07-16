import { Button, Empty } from 'antd'
import { useNavigate } from 'react-router-dom'

interface Props {
  title?: string
  description?: string
}

export default function FeatureDisabledPage({
  title = '功能暂未开放',
  description = '该功能计划在后续版本中提供。',
}: Props) {
  const navigate = useNavigate()
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <Empty description={<span style={{ fontSize: 14, color: '#666' }}>{title} · {description}</span>} />
        <Button type="primary" onClick={() => navigate('/overview')} style={{ marginTop: 16 }}>
          返回总览
        </Button>
      </div>
    </div>
  )
}