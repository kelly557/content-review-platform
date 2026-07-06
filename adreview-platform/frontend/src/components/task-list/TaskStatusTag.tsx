import { Tag } from 'antd'
import {
  ClockCircleOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  UserOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
} from '@ant-design/icons'
import { TASK_STATUS_CONFIG, getTaskStatus, type ReviewTask } from '@/types/domain'

const ICON_MAP: Record<string, React.ReactNode> = {
  ClockCircleOutlined: <ClockCircleOutlined />,
  RobotOutlined: <RobotOutlined />,
  CheckCircleOutlined: <CheckCircleOutlined />,
  ExclamationCircleOutlined: <ExclamationCircleOutlined />,
  UserOutlined: <UserOutlined />,
  CloseCircleOutlined: <CloseCircleOutlined />,
  RollbackOutlined: <RollbackOutlined />,
}

interface TaskStatusTagProps {
  task: ReviewTask
}

export default function TaskStatusTag({ task }: TaskStatusTagProps) {
  const statusKey = getTaskStatus(task)
  const config = TASK_STATUS_CONFIG[statusKey] || TASK_STATUS_CONFIG.pending

  return (
    <Tag color={config.color} icon={ICON_MAP[config.icon]}>
      {config.label}
    </Tag>
  )
}
