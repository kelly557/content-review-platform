import {
  Alert,
  Button,
  Input,
  Radio,
  Space,
  Typography,
  Upload,
  type UploadProps,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { App } from 'antd'
import { parseWordsFile } from '@/lib/libraryImport'

const { Text } = Typography
const { Dragger } = Upload

export const MAX_WORDS = 1000
const MAX_FILE_BYTES = 10 * 1024 * 1024

export type WordsMode = 'batch' | 'file'

interface Props {
  text: string
  file: File | null
  mode: WordsMode
  disabled?: boolean
  onModeChange: (m: WordsMode) => void
  onTextChange: (v: string) => void
  onFileChange: (f: File | null) => void
}

export default function WordsInputPanel({
  text,
  file,
  mode,
  disabled,
  onModeChange,
  onTextChange,
  onFileChange,
}: Props) {
  const { message } = App.useApp()
  const batchActive = mode === 'batch'

  const uploadProps: UploadProps = {
    multiple: false,
    maxCount: 1,
    accept: '.txt,.csv,text/plain,text/csv',
    showUploadList: false,
    beforeUpload: (f) => {
      if (f.size > MAX_FILE_BYTES) {
        message.warning(`文件大小超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`)
        return Upload.LIST_IGNORE
      }
      onFileChange(f as File)
      void handleParse(f as File)
      return false
    },
    onRemove: () => onFileChange(null),
    disabled: disabled || !mode,
  }

  async function handleParse(f: File) {
    try {
      const { words, errors } = await parseWordsFile(f)
      if (errors.length > 0 || words.length === 0) {
        message.error(errors[0] ?? '文件无有效数据')
        return
      }
      if (words.length > MAX_WORDS) {
        message.error(`单次最多 ${MAX_WORDS} 个词,检测到 ${words.length}`)
        return
      }
      onTextChange(words.join('\n'))
      onModeChange('batch')
      message.success(
        `已导入 ${words.length} 个词,切换到批量粘贴后可继续编辑`,
      )
    } catch (e) {
      message.error('解析失败：' + (e as Error).message)
    }
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <section
        style={{
          borderBottom: '1px dashed #E2E8F0',
          paddingBottom: 16,
        }}
      >
        <Radio
          value="batch"
          checked={batchActive}
          onChange={() => onModeChange('batch')}
          disabled={disabled}
        >
          <Text strong>批量添加词</Text>
        </Radio>
        <div
          style={{
            marginTop: 12,
            opacity: batchActive ? 1 : 0.55,
            pointerEvents: batchActive ? 'auto' : 'none',
          }}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8 }}>
                <li>
                  支持多个关键词通过与或非逻辑组合成一个关键词。如关键词&quot;微信&amp;兼职&quot;
                  表示只有同时出现以上两个词才会命中,&quot;&amp;&quot;表示与关系,&quot;~&quot;
                  表示非（排除）关系,配置关键词时&quot;&amp;&quot;必须在&quot;~&quot;之前。
                </li>
                <li>每个关键词以换行分隔,单个词不超过 50 字。</li>
                <li>最多 1000 行,如需一次增加超过 1000 行,请使用上传文件导入。</li>
              </ol>
            }
          />
          <Input.TextArea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="请输入,每行一个词,最多1000行。"
            rows={10}
            disabled={disabled || !batchActive}
            style={{ resize: 'vertical' }}
          />
        </div>
      </section>

      <section>
        <Radio
          value="file"
          checked={mode === 'file'}
          onChange={() => onModeChange('file')}
          disabled={disabled}
        >
          <Text strong>上传文件导入</Text>
        </Radio>
        <div
          style={{
            marginTop: 12,
            opacity: mode === 'file' ? 1 : 0.55,
            pointerEvents: mode === 'file' ? 'auto' : 'none',
          }}
        >
          <Dragger {...uploadProps} style={{ padding: '24px 0' }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">拖拽上传 TXT 文件</p>
            <p className="ant-upload-hint">或</p>
            <Button type="primary" size="small" disabled={disabled || mode !== 'file'}>
              查看本地文件
            </Button>
          </Dragger>
          {file && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: '#F1F5F9',
                borderRadius: 4,
                fontSize: 12,
                color: '#475569',
              }}
            >
              <Space size={8} wrap>
                <Text strong>已选择:</Text>
                <Text>{file.name}</Text>
                <Text type="secondary">({(file.size / 1024).toFixed(1)} KB)</Text>
              </Space>
            </div>
          )}
        </div>
      </section>
    </Space>
  )
}