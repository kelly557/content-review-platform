# 内容审核业务知识库

> 资源库下「知识库」领域。本期重新设计：**只保留接入/检索/上传/版本管理必需的字段**，与内容审核业务强绑定，不做通用知识中台。

---

## 1. 业务定位

- 用途：审核员/审核系统用来比对内容的**基准材料**（如《广告法》《互联网广告管理办法》、内部审核 SOP、平台社区规范、案例汇编等）。
- 与通用知识库/政策法规归档的区别：
  - **不是**「任意文档」——必须有审核依据的语义。
  - **不是**通用 wiki/知识中台——不引入 JSON metadata、复杂权限树、标签字典等扩展机制。
- 数据规模与查询场景稳定：单文档 1–50MB 文件、URL 登记、版本管理、按标签与标题检索。

## 2. 字段语义

> 仅保留与「能上传、能检索、能引用」强相关的字段。其它历史字段（文档类型字典、发文机关、文号、适用区域、生效起止、行业标签、主题标签）已彻底从 DB 与响应中移除。

| 字段 | 必填 | 类型 | 含义 | 备注 |
|---|---|---|---|---|
| `title` | ✅ | string(255) | 文档标题 | 业务展示与检索 |
| `code` | — | string(64) | 服务端标识符 | 留空自动生成 `kdoc_<时间戳>_<4字符>` |
| `description` | — | text | 简介 | 「这份文档用在哪些审核场景」 |
| `tags[]` | — | JSON string[] | 业务标签 | 例如 `["广宣品", "广告法", "合规"]`；唯一分类维度 |
| `issued_at` | — | timestamptz | 发布日期 | 通用字段；与审核时效性有关 |
| `status` | — | enum | 状态 | `draft / active / archived`；无 `expired`（可派生） |
| `source_type` | ✅ | enum | 来源方式 | `upload / url / manual` |
| `source_url` | URL 时必填 | text | 外部链接 | source_type=url 时必填 |
| `current_version_id` | — | FK | 当前版本 | 文件上传或 URL 登记时自动创建首版本 |
| `created_by_id` / `updated_by_id` | — | FK | 服务端 | 审计与归属 |
| `is_deleted` / `deleted_at` | — | — | 软删除 | — |

**版本表** `knowledge_document_versions` 字段：
- `version_no`（自增，首版 1，每次上传/登记递增）
- `storage_key`（upload 时有值）/ `source_url`（url 时有值）/ 二者皆空时为纯元数据
- `original_filename` / `mime_type` / `file_size` / `sha256`
- `metadata` JSONB（仅存版本内部 metadata，如 `{"note": "updated chapter 3"}`，**不是**对外扩展点）

## 3. 来源方式

| 值 | 文案 | 适用场景 |
|---|---|---|
| `upload` | 本地上传 | PDF / Word / Markdown 等文件 |
| `url` | 外部链接 | 政府网站、平台规范的官方 URL |
| `manual` | 仅元数据 | 仅记录标题、描述、标签，无原文 |

注册时强制 URL 类型必填 `source_url`；upload 类型必传文件。

## 4. 状态

- `draft` 草稿 / `active` 已启用 / `archived` 已归档
- 不维护 `expired` 状态；如未来需要「自动按 issued_at 派生生效」则在 service 层计算，不冗余存储。

## 5. 不引入的字段

以下字段**已彻底删除**（不保留 DB 列、不出现在响应中、不出现在前端）：

- `document_type` 受控枚举（policy / law / regulation / standard / guidance / notice / other）
- `issuing_authority` 发文机关
- `document_number` 文号
- `jurisdiction` 适用区域
- `effective_from` / `effective_until` 生效/失效
- `published_at`（已重命名为 `issued_at`）
- `industry_tags` / `policy_tags`（已合并为 `tags[]`）

**理由**：这些字段：
1. 不参与审核匹配或规则决策，仅作分类与展示。
2. 不同来源类型（法律 / 行业标准 / 平台规则 / 内部 SOP）字段语义不一致，强约束会让 60% 录入场景无意义。
3. 「不展示和业务无关的信息」——把这些信息塞到 `tags` 或 `description` 中即可，运营不需维护冗余结构。

## 6. API 行为

- 列表 GET `/api/v1/knowledge-documents`
  - 参数：`q`（标题/编码模糊）、`tag`（精确匹配）、`source_type`、`status`、`include_deleted`
  - 响应：精简字段集（`title / tags / source_type / issued_at / status / current_version / updated_at` 等）
- 详情 GET `/api/v1/knowledge-documents/{id}`
- 创建 POST `/api/v1/knowledge-documents`（仅元数据）
- 上传 POST `/api/v1/knowledge-documents/uploads`（multipart，必传文件）
- URL 登记 POST `/api/v1/knowledge-documents/register-url`
- 更新 PATCH `/api/v1/knowledge-documents/{id}`（元数据）
- 删除 DELETE `/api/v1/knowledge-documents/{id}`（软删除）
- 版本 POST `/api/v1/knowledge-documents/{id}/versions`（multipart）
- 版本 GET `/api/v1/knowledge-documents/{id}/versions`
- 下载 GET `/api/v1/knowledge-documents/{id}/download?version_id=`（file 流 / URL 302 重定向）

## 7. 权限

| 操作 | submitter | reviewer | mlr | admin | superadmin |
|---|---:|---:|---:|---:|---:|
| 查看 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 新建/编辑/上传/删除 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 下载/版本历史 | ❌ | ❌ | ✅ | ✅ | ✅ |

后端权限由 `app/services/resource_auth.py:require_reader / require_writer` 统一管理。

## 8. 引用关系（待算法确认）

- 当前：`tags.knowledge_refs`（JSON 数组）记录审核点/规则对知识文档的引用。
- 本期**不**新增关联表（如 `audit_point_knowledge_documents`）。
- 等算法团队给出引用关系的形式后，再决定是否升级为独立表（届时新增 migration）。

## 9. 已落地文件

后端
- `app/models/knowledge_document.py`（精简后字段：title / code / description / tags / issued_at / status / source_type / source_url / 当前版本 + 元数据）
- `app/schemas/knowledge_document.py`（`KnowledgeDocumentCreate/Update/Out/ListItem` 字段集与 ORM 一致）
- `app/api/v1/knowledge_documents.py`（列表过滤参数 `tag` / `source_type` / `status`；CRUD 字段集最小化）
- `alembic/versions/20260720_knowledge_minimize_fields.py`（合并双 tag 列 + 重命名 + DROP 老列）
- `tests/test_knowledge_documents.py`（7 个用例覆盖上传、URL、URL 必填校验、软删除、MIME 校验、tag/status 过滤、权限拒绝）

前端
- `src/types/domain.ts`（移除 `KnowledgeDocumentType` 与相关枚举；保留 `tags / issued_at / source_type`）
- `src/api/knowledge-documents.ts`（请求参数与字段名同步）
- `src/pages/knowledge/KnowledgeDocumentListPage.tsx`（列精简为 标题 / 标签 / 来源 / 发布日期 / 状态 / 更新时间 / 操作；筛选：搜索 / 标签 / 来源 / 状态）
- `src/pages/knowledge/KnowledgeDocumentDetailPage.tsx`（编辑字段精简为 标题 / 描述 / 标签 / 发布日期 / 状态 / 原文 URL；移除发文机关/文号/适用区域/生效期）
