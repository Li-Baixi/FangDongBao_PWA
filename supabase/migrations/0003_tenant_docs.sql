-- =============================================================
-- 租客证件/合同照片引用（v0.8.0，在 Supabase SQL Editor 运行一次）
-- tenants 加一列 docs：[{id, kind:'idcard'|'contract', thumb}]
-- 原图仍只存各自手机本地（同抄表照片策略），这列存的是小缩略图。
-- =============================================================

alter table public.tenants
  add column if not exists "docs" jsonb default '[]';
