import { useEffect, useState } from 'react'
import { Breadcrumb, Spin, Typography } from 'antd'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import CreateStrategyForm from '@/components/CreateStrategyForm'
import { strategiesApi } from '@/api/strategies'
import type { Strategy } from '@/types/domain'

const { Title } = Typography

export default function CreateStrategyPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const location = useLocation()
  const isEdit = Boolean(id)
  const [loading, setLoading] = useState(isEdit)
  const [initial, setInitial] = useState<Strategy | null>(null)
  const stateStep = (location.state ?? {}) as { step?: 0 | 1 }
  const initialStep = stateStep.step

  useEffect(() => {
    if (!id) return
    let cancel = false
    setLoading(true)
    strategiesApi
      .get(Number(id))
      .then((s) => {
        if (!cancel) setInitial(s)
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [id])

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/strategies')}>策略中心</a> },
          { title: isEdit ? '编辑策略' : '创建策略' },
        ]}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          {isEdit ? '编辑策略' : '创建策略'}
        </Title>
      </div>

      {isEdit && loading ? (
        <Spin />
      ) : isEdit && initial ? (
        <CreateStrategyForm
          mode="edit"
          strategyId={initial.id}
          initial={initial}
          initialStep={initialStep}
          onCancel={() => navigate('/strategies')}
        />
      ) : isEdit ? (
        <Spin />
      ) : (
        <CreateStrategyForm
          initialStep={initialStep}
          onCancel={() => navigate('/strategies')}
        />
      )}
    </div>
  )
}
