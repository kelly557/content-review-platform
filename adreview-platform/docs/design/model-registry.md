# 模型库（Resources · Models）

> 资源库下「模型库」领域。架构采用「Provider 二级实体 + Model」分层：一个 Provider
> 承载接入地址、API Key 与一组共享凭证的 model；model 自身只保留业务标识与
> 分类。模型分为大模型 / 小模型；大模型有固定三分类（文本 / 多模态 / 其他），
> 小模型有 9 分类（涉政 / 涉恐 / ...）。所有模型都支持版本管理。

---

## 1. 交互文案

- 资源库下模型列表页顶部按钮：「**添加 Provider**」「**添加模型**」
- 抽屉标题：`添加 Provider` / `添加模型`。
- 「添加 Provider」表单：与参考截图一致 — display_name / Provider 类型 / Base URL /
  API key（编辑框）+ Models（Form.List 动态行：model_id + display name + 大模型分类）。
- 「添加模型」表单：从已有 Provider 选 + 填 model_id + 大模型分类。

---

## 2. 概念模型

```
Provider (1) ──── (n) Model
   │                  │
   │ display_name     ├─ name  (业务展示名)
   │ provider_preset  ├─ model_name (厂商 model_id)
   │ endpoint_url     ├─ large_category (text/multimodal/other) — kind=large 时必填
   │ credential ─┐    ├─ small_category (9 类) — kind=small 时必填
   │ (FK)        │    ├─ version / description / config
   │ api_key ────┘    ├─ kind (large/small)
   │ (raw, 自动加密)  ├─ status (draft/active/...)
   │ status          └─ versions[] (RegisteredModelVersion[])
   └─ models[]
       (config.protocol / timeout 继承自 Provider)
```

实际数据库：

```
resource_credentials (加密存储 credential)
        ▲
        │ credential_id (FK)
        │
registered_providers        registered_provider_options (active only)
        ▲
        │ provider_id (FK)
        │
registered_models            registered_models.options (active only)
        ▲
        │ model_id
        │
registered_model_versions
```

---

## 3. Provider 实体（`registered_providers`）

### 3.1 字段表

| 字段 | 类型 | 必填 | 备注 |
|---|---|---|---|
| `id` | bigint | ✓ | PK |
| `public_id` | uuid | ✓ | 对外路由 |
| `code` | string(64) | ✓ | **后端自动生成** `prv_<preset>_<rand6>`，前端不展示 |
| `display_name` | string(128) | ✓ | 用户可见 |
| `description` | text | × | 描述 |
| `provider_preset` | string(64) | × | openai / anthropic / bailian / deepseek / self-hosted / custom |
| `endpoint_url` | text | ✓ | Base URL；preset 提供默认值时自动预填 |
| `config` | jsonb | ✓ | `{protocol, timeout, ...}`，按 preset 推断 |
| `credential_id` | FK resource_credentials.id | × | 创建时传 raw api_key 自动建并绑定 |
| `status` | string(16) | ✓ | `active`（默认）/ `archived` |
| `owner_id` / `created_by_id` / `updated_by_id` | FK users.id | × | 审计字段 |
| `created_at` / `updated_at` | timestamptz | ✓ | |

### 3.2 endpoint 与脚本

| Method | Path | Body | 行为 |
|---|---|---|---|
| GET    | `/api/v1/providers` | – | list providers（含 model_count + masked_token） |
| GET    | `/api/v1/providers/options` | – | 轻量下拉（active only），给 Model 创建 modal |
| GET    | `/api/v1/providers/{id}` | – | 详情 + 关联 models 列表 |
| POST   | `/api/v1/providers` | ProviderCreate（含 api_key + initial_models[]） | 创建；一次性建 initial_models |
| PATCH  | `/api/v1/providers/{id}` | ProviderUpdate（metadata） | 仅元数据；api_key 用单独 rotate |
| POST   | `/api/v1/providers/{id}/api-key` | `{api_key}` | 替换凭证并切换 provider.credential_id |
| POST   | `/api/v1/providers/{id}/validate` | – | 调 `GET {endpoint_url}` 测连通性 |
| POST   | `/api/v1/providers/{id}/archive` | – | 软归档（status='archived'） |
| DELETE | `/api/v1/providers/{id}` | – | 模型非空 → 409；为空 → 真删 |

### 3.3 自动建凭证

`POST /providers` 接收 raw `api_key`：服务端 `_find_or_create_credential` 按
`(provider_preset + masked_token)` 复用已有 resource_credential，命中返回；未命中新建。
这样多个 provider 用同一 token 共享一份凭证，替换时通过 `/api-key` 切换。

### 3.4 删除约束

`DELETE /providers/{id}` 若 `model_count > 0` 返回 409，前端引导用户迁移或归档。
归档是软操作（`status='archived'`），从 `/options` 列表消失但数据保留。

---

## 4. Model 实体（`registered_models`）

### 4.1 字段表

| 字段 | 类型 | 必填 | 备注 |
|---|---|---|---|
| `id` / `code` / `public_id` | – | ✓ | PK + 业务编号 |
| `name` | string(128) | ✓ | 业务展示名 |
| `description` | text | × | 用途说明 |
| `kind` | string(8) | ✓ | `large` / `small` |
| `small_category` | string(32) | × | 9 类（kind=small 时必填） |
| `large_category` | string(16) | × | 3 类（kind=large 时必填） |
| `provider_id` | FK registered_providers.id | ✓ | 模型归属的 Provider |
| `model_name` | string(128) | × | 厂商 model_id（gpt-4o-mini 等） |
| `max_output_tokens` | int | × | 小模型专用 |
| `registration_method` | string(16) | ✓ | `remote_api` (默认) / `uploaded_file` (小模型) |
| `status` | string(16) | ✓ | draft/validating/active/inactive/failed/archived |
| `version` | string(64) | × | 当前版本号 |
| `config` | jsonb | ✓ | 协议 / 超时等 |

> 旧字段 `endpoint_url` / `credential_id` 已不再可读写；保留在 DB column 以
> 兼容现有数据，**应用层完全忽略**。

### 4.2 endpoint 与脚本

| Method | Path | 行为 |
|---|---|---|
| GET    | `/api/v1/models` | list (filter: `kind` / `small_category` / `large_category` / `provider_id` / `status` / `q`) |
| GET    | `/api/v1/models/options` | 轻量下拉 active models |
| GET    | `/api/v1/models/{id}` | 详情 |
| POST   | `/api/v1/models` | 注册模型（必填 `provider_id` + 按 kind 校验分类） |
| PATCH  | `/api/v1/models/{id}` | 修改 |
| DELETE | `/api/v1/models/{id}` | 软删除 |
| POST   | `/api/v1/models/{id}/archive` / `/deactivate` | 状态切换 |
| POST   | `/api/v1/models/{id}/validate` | 连通性校验 |
| GET    | `/api/v1/models/{id}/versions` | list versions |
| POST   | `/api/v1/models/{id}/versions` | 创建新版本（credential/endpoint 继承自 Provider） |
| POST   | `/api/v1/models/{id}/versions/{vid}/activate` | 切换到该版本 |
| POST   | `/api/v1/models/upload-artifact` | 上传小模型权重 |

### 4.3 大模型三分类（必填）

| 值 | 标签 | 用途 |
|---|---|---|
| `text` | 文本模型 | 文本输入输出 |
| `multimodal` | 多模态模型 | 含图像 / 视频 / 音频输入 |
| `other` | 其他模型 | 兜底 |

校验：`kind='large'` 时 `large_category NOT NULL`；`kind='small'` 时强制置空。

### 4.4 小模型 9 分类（kind=small 必填）

| 值 | 标签 |
|---|---|
| `politics` | 涉政 |
| `terrorism` | 涉恐 |
| `porn` | 涉黄 |
| `illicit` | 违禁 |
| `ad` | 广告 |
| `religion` | 宗教 |
| `ad_law` | 广告法 |
| `abuse` | 辱骂 |
| `unhealthy` | 不良 |

---

## 5. 版本管理

每个 model 有 `RegisteredModelVersion[]`，版本号自增。

- `large_category`：大模型版本可覆盖（不传则继承 model 当前值）
- `endpoint_url` / `credential`：默认继承 Provider；**版本层不直接读写**
- 状态机：`draft → validated → active ↔ inactive → archived`；`failed` 表示校验异常
- 切换：`POST /models/{id}/versions/{vid}/activate` 把 `current_version_id` 指向该版本

### 5.1 注册 Provider 时一次性携带 model

`POST /providers` body 内 `initial_models[]`，每个模型一行：

```json
{
  "display_name": "OpenAI 生产",
  "provider_preset": "openai",
  "endpoint_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "initial_models": [
    {"model_name": "gpt-4o-mini", "name": "文本审核 GPT-4o-mini",
     "large_category": "text", "version": "1.0.0"},
    {"model_name": "gpt-4o-vision", "large_category": "multimodal"}
  ]
}
```

效果：原子化创建 1 个 Provider + N 个 model + 1 个 version（v1）+ 自动建凭证。

---

## 6. 凭证策略

- `resource_credentials.ciphertext`：Fernet + HKDF 加密（见 `services/credential_cipher.py`）
- 列表只返 `masked_token`；audit 不写 raw api_key
- 命中 `(provider_preset + masked_token)` 的 raw token 自动复用同凭证
- 替换：用 `/api-key` 显式切换 provider.credential_id；旧凭证自然失效

---

## 7. 历史数据迁移

Alembic `20260723_provider_split_and_large_category.py` 在 upgrade 中：

1. 新表 `registered_providers`
2. 给 `registered_models` 加列 `provider_id` / `large_category`
3. 按 `(provider_preset, endpoint_url, credential_id)` 三元组**唯一性**创建 Provider 行
4. 回填每个 model 的 `provider_id`
5. 大模型自动置 `large_category='other'`
6. `registered_model_versions` 同步加 `large_category`

升级期间旧 `endpoint_url` / `credential_id` 列保留（nullable=True），应用层
不再读写。

---

## 8. UI 路径

| URL | 页面 |
|---|---|
| `/resources/models` | 模型库列表（顶部 Tabs：大模型 / 小模型） |
| `/resources/models/:id` | 模型详情（发布新版本 / 校验 / 删除） |
| `/resources/providers/:id` | Provider 详情（编辑元数据 / 替换 API Key / 归档 / 删除 / 添加模型） |

### 8.1 统一「添加模型」入口 + Tab 化

「添加模型」是所有 model 创建的统一入口。无论是大模型还是小模型，UI 上
只看到一个主按钮。背后根据 activeTab 切换 modal 内部内容：

```
/resources/models
├── Tabs: 大模型(n) | 小模型(n)
├── 共享筛选：搜索 / 状态
├── Tab 独享筛选：大模型分类（large 时）/ 小模型分类 + Provider（large 时）
└── [+ 添加模型]（按当前 tab 切换 modal 内容）
```

### 8.2 「添加模型」modal 两种模式

`CreateModelModal` 接受 `mode: 'large' | 'small'`，由 ModelListPage 按 activeTab 传入：

**大模型 mode（建 Provider + 一组 model）**：

```
Modal title: 添加模型
┌──────────────────────────────────────────────────┐
│ ⚠ 一个厂商级接入配置 = Provider + 一组 Model       │
│                                                  │
│ 显示名称 (display_name)        [必填]            │
│ Provider 类型 (preset)          [Select]           │
│ Base URL                       [必填, url]        │
│ API Key                        [必填, password]   │
│ 描述 (可选)                                       │
│ ── 模型列表 ──                                    │
│ ┌─ row 1 ──────────────────────────────────┐     │
│ │ model_id [必填] │ 显示名 [可选] │ [删除]  │     │
│ │ 大模型分类 [Select 必填]                   │     │
│ │ Version [可选]                             │     │
│ └──────────────────────────────────────────┘     │
│ [+ 添加模型]                                       │
└──────────────────────────────────────────────────┘
```

提交：POST /api/v1/providers（带 initial_models[]）一次性原子创建。

**小模型 mode（仅建 model，不挂 Provider）**：

```
Modal title: 添加小模型
┌──────────────────────────────────────────────────┐
│ ⚠ 小模型不绑定任何 Provider                  │
│                                                  │
│ 业务标识 (model_name)           [必填]            │
│ 起始版本号 (version)             [可选]            │
│ max_output_tokens                [必填, 1-32768]   │
│ 上传权重文件 (.onnx/.pt/.zip…)   [Dragger, 必填]  │
│ 小模型分类                       [Select 必填]     │
│ 模型名称 (name)                  [可选]            │
│ 描述 (可选)                                       │
└──────────────────────────────────────────────────┘
```

提交：POST /api/v1/registered-models（provider_id=null）。

### 8.3 Provider 详情页「追加 model」副入口

主入口走 ModelListPage「添加模型」（一次建 Provider + models）；
副入口走 Provider 详情页 header 的 [+ 添加模型]，向已有 Provider
**追加单条 model**：

```
[+ 添加模型] [校验连通性] [编辑] [替换 API Key] [归档] [删除]

Modal title: 添加模型到「<display_name>」
┌──────────────────────────────────────────────────┐
│ Model ID                       [必填]             │
│ 模型名称                       [可选]             │
│ 大模型分类                     [Select 必填]      │
│ Version                        [可选]             │
│ 描述 (可选)                                       │
└──────────────────────────────────────────────────┘
```

凭证与 Base URL 自动继承自 Provider；提交走
`POST /api/v1/registered-models` 并把 `provider_id` 写死为当前 Provider。

### 8.4 list 接口扩展（小模型 artifact 摘要）

`GET /api/v1/models` 在 ListItem 增加 2 个字段（仅 kind=small 有值）：

- `artifact_filename`：当前版本文件名（如 `politics-cls.onnx`）
- `artifact_size`：字节数（用于显示 MB）

实现上 list endpoint 显式 SELECT `registered_model_versions` 的这两列，按
`current_version_id` 索引返回；不走 selectinload 以避开跨测试 schema 缓存。
