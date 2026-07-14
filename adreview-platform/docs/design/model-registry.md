# 模型库（Resources · Models）

> 资源库下「模型库」领域。模型接入遵循「Provider + Model ID」结构；模型分为大模型 / 小模型；小模型有固定分类（9 类）。所有模型都支持版本管理。

---

## 1. 交互文案

- 顶部按钮：「**添加模型**」。
- 抽屉标题：`添加模型`。
- 保存成功提示：`模型添加成功`。
- 详情页按钮：校验连通性 / 停用 / 归档 / 删除。
- 详情页版本 Tab：`+ 发布新版本` / 列表中点 `切换到此版本` 把 current_version 指向该版本。

入口路径：
- 列表 `/resources/models`
- 详情 `/resources/models/:id`

---

## 2. 模型分类

### 2.1 大模型 / 小模型（kind）

`kind` 字段在添加时**必选**：

| 值 | 标签 | 适用 |
|---|---|---|
| `large` | 大模型 | 通用对话、分类、生成（GPT-4o / Claude / DeepSeek / Qwen 等） |
| `small` | 小模型 | 单一分类器（如"涉政分类器"），绑定一个固定分类 |

### 2.2 小模型分类（small_category）

`small_category` 在 `kind=small` 时**必选**。固定枚举，不允许运营自定义（与 LLM 风格的多分类分类器不同——小模型本身就是单一目标域）。

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

> 大模型（`kind=large`）的 `small_category` 始终为 null，添加时即使填写也会被自动置空。

---

## 3. 字段语义（精简版）

| 字段 | 必填 | 类型 | 含义 | 备注 |
|---|---|---|---|---|
| `name` | ✅ | string(128) | 模型展示名（中文友好） | `GPT-4o 文本审核` / `涉政分类小模型` |
| `description` | — | text | 模型说明 | 用途场景 / 注意事项 |
| `kind` | ✅ | enum | 大 / 小模型 | `large` / `small` |
| `small_category` | small 时必填 | enum | 9 类固定分类 | `politics` / `terrorism` / ... |
| `provider` | ✅ | enum+custom | 提供方键 | `openai` / `anthropic` / `bailian` / `deepseek` / `self-hosted` / `custom` |
| `model_name` | ✅ | string(128) | Model ID | 厂商返回的模型标识（`gpt-4o-mini`） |
| `endpoint_url` | ✅ | URL | Base URL | provider 预设可改 |
| `credential_id` | ✅ | FK | 凭证 ID | 必填，上线后无凭证直接 401 |
| `version` | — | string(64) | 语义版本号 | `1.0.0`（同时也是首版本 version_label） |
| `status` | — | enum | 状态 | draft / active / archived |

> `registration_method` 字段当前一期固定 `remote_api`，后端不暴露。
> 旧字段 `scale_class` / `framework` / `license` / `capabilities` 已 DROP。

---

## 4. Provider 字典

| provider 键 | 展示名 | 默认 `endpoint_url` | 默认 `protocol` |
|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai-compatible` |
| `anthropic` | Anthropic | `https://api.anthropic.com/v1` | `anthropic-messages` |
| `bailian` | 阿里百炼 (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `openai-compatible` |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai-compatible` |
| `self-hosted` | 自建 / 私有部署 | `null`（需手填） | `openai-compatible` |
| `custom` | 自定义 | `null`（需手填） | `custom` |

---

## 5. 版本管理

### 5.1 存储

`registered_model_versions` 表记录每次接入配置变更；`registered_models.current_version_id` 指向当前生效版本。

每条版本字段：
- `version_no`（自增：v1, v2, v3...）
- `version_label`（可选，如 "1.1.0" / "2025-Q1"）
- `notes`（变更说明，可展开行查看）
- `provider` / `model_name` / `endpoint_url` / `config` / `credential_id`（版本快照）
- `status`（draft / validated / active / inactive / failed / archived）
- `validation_log`（最近 20 次探活结果）

### 5.2 操作

| 操作 | 端点 | 效果 |
|---|---|---|
| 添加模型 | `POST /api/v1/registered-models` | 自动创建 v1 |
| 发布新版本 | `POST /api/v1/registered-models/:id/versions` | 递增 version_no；新版本为 draft |
| 切换版本 | `POST /api/v1/registered-models/:id/versions/:ver/activate` | 把 `current_version_id` 指向该版本；模型 status → active |
| 校验连通性 | `POST /api/v1/registered-models/:id/validate` | 探活当前版本 endpoint；记录 validation_log |
| 归档 | `POST /api/v1/registered-models/:id/archive` | 模型 status → archived |

> 一份模型可保留多个版本（如 v1 生产 / v2 测试），调用方始终走 `current_version` 指向的版本；切版本不影响调用方（除非显式监听 current_version 变化）。

---

## 6. 凭证（resource_credentials）

- 凭证以 `Fernet`（AES-128 CBC + HMAC-SHA256）加密写入 `ciphertext`。
- 列表/详情只返回 `masked_token`，明文不出现在 API 响应或 `audit_events` payload。
- 添加模型时**必须**选择凭证；上线后未配置凭证将直接返回 401。
- 校验/连接时由服务端在内存中解密 → 发起请求 → 不落库。

---

## 7. 状态机

### 模型主表

```
       [add]
         │
         ▼
   ┌─────────────┐
   │   draft     │ ← 默认
   └─────────────┘
      │     ▲
[active]    │ [archive 恢复]
      │     │
      ▼     │
   ┌─────────────┐         ┌─────────────┐
   │   active    │ ──────→ │  archived   │
   └─────────────┘         └─────────────┘
      │
[inactive]
      │
      ▼
   ┌─────────────┐
   │  inactive   │
   └─────────────┘
```

### 版本

- 新版本默认 `draft`。
- 校验通过 → `validated`。
- 切到当前版本（`activate_version`）→ `active`。
- 校验失败 → `failed`。

---

## 8. 权限矩阵

| 操作 | submitter | reviewer | mlr | admin | superadmin |
|---|---:|---:|---:|---:|---:|
| 查看列表/详情 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 添加模型 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 编辑模型 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 删除（软删） | ❌ | ❌ | ❌ | ✅ | ✅ |
| 校验连通性 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 停用/归档 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 发布新版本 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 切换版本 | ❌ | ❌ | ❌ | ✅ | ✅ |

后端权限检查位于 `app/services/resource_auth.py:require_reader / require_writer`。

---

## 9. 已落地文件清单

后端
- `app/models/registered_model.py`
  - 新增 `RegisteredModelKind`（large/small）与 `SmallModelCategory`（9 类）enum
  - 新增 `RegisteredModelVersionStatus` enum
  - `registered_models` 加列：kind / small_category
  - `registered_model_versions` 加列：version_label / notes / credential_id
- `app/schemas/registered_model.py`
  - `RegisteredModelCreate` / `Update` / `Out` / `ListItem` 同步；`RegisteredModelVersionCreate` schema
- `app/api/v1/registered_models.py`
  - `_validate_kind` / `_validate_small_category` / `_validate_version_status`
  - 大模型忽略 small_category；小模型必须带 small_category
  - 新增 `POST /:id/versions` 与 `POST /:id/versions/:ver/activate`
  - `archive` 端点（POST 替换 activate→已用 status 控制）
  - 列表移除 `selectinload(current_version)`，避免懒加载 IO
- `app/services/credential_cipher.py`（Fernet + HKDF）
- `alembic/versions/20260722_model_kind_and_categories.py`（kind / small_category / version_label / notes / version credential_id）
- `tests/test_registered_models.py`（10 个用例：CRUD / kind 必填 / small_category 强校验 / provider 预设 / version 创建+activate / 凭证必填 / MLR 拒绝）

前端
- `src/types/domain.ts`
  - 新增 `RegisteredModelKind` / `SmallModelCategory` 类型与 options
  - 字段集更新（kind / small_category / version_label / notes）
- `src/api/registered-models.ts`
  - 新增 `createVersion` / `activateVersion` / `archive` / `listActiveModels`
  - `ActiveModelOption` 类型导出
- `src/pages/models/ModelListPage.tsx`
  - 列：类型 / 分类 / Provider / Model ID / 状态 / 更新时间
  - 筛选：类型 / 分类 / Provider / 状态
  - 表单：kind（Radio）+ 条件渲染 small_category（仅 small 显示）
- `src/pages/models/ModelDetailPage.tsx`
  - 概览：类型 / 分类 / Provider / Model ID / Version / 凭证 / Base URL / 说明
  - 版本 Tab：列表 + 「发布新版本」/「切换到此版本」/ 当前版本 Tag
  - Modal：发布新版本（version_label / notes / provider / model_name / endpoint_url）
  - 顶部按钮：校验 / 停用 / 归档 / 删除
- `src/components/strategy/LlmReviewCard.tsx`
  - 改为使用 `listActiveModels({ kind: 'large' })` 拉取大模型选项
