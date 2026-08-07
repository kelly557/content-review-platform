-- ============================================================================
-- 手工 SQL: 把「PII 检测」审核点从"高风险"改为"敏感"
-- 触发原因:
--   v3 字段收敛要求 "敏感" 档位只承载 PII 语义.
--   seed.py:580 tx_privacy_pii 已改 default 为 "敏感", 本 SQL 把已
--   落库的现有数据一并对齐.
--
-- 不依赖 alembic, 直接 psql 执行.
--
-- 配套后端改动:
--   - app/services/risk_taxonomy.py: LABEL_RISK_MAP 把 pii_* 落到敏感档
--     (本 SQL 与之同步, 否则 PII 字面 label 不能落"敏感"档)
--   - aggregate_risk_level_v2 末尾新增 _normalize_label_cn
--   - aggregate_sensitive_level 末尾新增 coerce_sensitive_grade_for_hit
--
-- 落地前请:
--   1. 备份 audit_points 表: pg_dump -t audit_points > backup_pre_sensitive.sql
--   2. 先跑 SELECT 段确认目标行
--   3. 再执行 UPDATE
--
-- 回滚:
--   UPDATE audit_points SET risk_level = '高风险'
--   WHERE code = 'tx_privacy_pii' AND package_code = 'text_audit_pro';
-- ============================================================================

-- ─── 1. 预检查: 当前哪些行命中 ──────────────────────────────────
SELECT id, code, label_cn, risk_level
FROM audit_points
WHERE code = 'tx_privacy_pii'
  AND package_code = 'text_audit_pro';

-- ─── 2. ALTER enum: PG 不支持撤销 ADD VALUE, 只能借助 IF NOT EXISTS ──
-- 同一会话内多 SQL 由 alembic 或 psql \set AUTOCOMMIT on 包裹, 不能跑在
-- 事务块里 (PG < 12 老版本限制; 当前 PG 12+ 自动处理).
ALTER TYPE auditpointrisk ADD VALUE IF NOT EXISTS '敏感';

-- ─── 3. 修改目标行: (text_audit_pro + tx_privacy_pii) ──────────────
UPDATE audit_points
SET risk_level = '敏感'
WHERE code = 'tx_privacy_pii'
  AND package_code = 'text_audit_pro'
  AND risk_level = '高风险';

-- ─── 4. 验证: 改完应为 "敏感" ─────────────────────────────────
SELECT id, code, label_cn, risk_level, updated_at
FROM audit_points
WHERE code = 'tx_privacy_pii'
  AND package_code = 'text_audit_pro';

-- ─── 5. 兼容性自检: 确认应用层 _RISK_RANK 已含"敏感"档位
--    (无需 SQL, 仅文档提醒.)
--    app/services/risk_taxonomy.py::_RISK_RANK 必须在 '高风险' = 4,
--    '中风险' = 3, '敏感' = 2 的前提下运行, 否则可能引发
--    rank lookup 异常.
