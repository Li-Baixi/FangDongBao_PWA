-- =============================================================
-- 收租提醒"运行留痕"表（v0.9.1，在 Supabase SQL Editor 运行一次）
-- 提醒程序每跑一次就记一笔（几点跑的、发了几条），
-- 以后怀疑"闹钟没响"时一查便知，不用再猜。
-- 开了 RLS 且不建任何策略 = 前台/游客完全读写不了，
-- 只有提醒程序用的服务密钥（绕过 RLS）能写、管理员能查。
-- =============================================================

create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),   -- 什么时候跑的
  hour int,                       -- 当时的北京小时（对照各人自选提醒时间）
  sent int,                       -- 实际发出几条
  detail jsonb                    -- 明细（发到哪些设备/失败原因）
);

alter table public.push_log enable row level security;
