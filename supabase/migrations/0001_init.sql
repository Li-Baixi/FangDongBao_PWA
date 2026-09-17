-- =============================================================
-- 房东宝 数据库初始化（在 Supabase 的 SQL Editor 里整段运行）
-- 表名/列名与前端字段一一对应（camelCase），免映射。
-- 金额一律存"分"（bigint）；时间戳为毫秒整数（客户端生成，用于增量同步）。
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- 房东档案（家庭成员） ----------
create table if not exists public.landlords (
  "id" uuid primary key,
  "name" text not null,
  "role" text not null default 'member' check ("role" in ('admin', 'member')),
  "authUid" uuid unique references auth.users (id) on delete set null,
  "prefs" jsonb default '{}',
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 楼栋 ----------
create table if not exists public.buildings (
  "id" uuid primary key,
  "ownerId" uuid not null, -- = auth.users.id（谁的楼）
  "name" text not null,
  "address" text,
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 租客 ----------
create table if not exists public.tenants (
  "id" uuid primary key,
  "ownerId" uuid not null,
  "buildingId" uuid,
  "name" text not null,
  "phone" text,
  "room" text,
  "status" text not null default 'active' check ("status" in ('active', 'left')),
  "rentDay" int not null default 1 check ("rentDay" between 1 and 31),
  "monthlyRent" bigint not null default 0,
  "deposit" bigint default 0,
  "internet" bigint default 0,
  "electric" jsonb default '{"mode":"metered","price":0,"flatAmount":0}',
  "water" jsonb default '{"mode":"metered","price":0,"flatAmount":0}',
  "note" text,
  "movedInAt" bigint,
  "movedOutAt" bigint,
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 抄表记录（thumb 为照片缩略图 dataURL，原图只存手机本地） ----------
create table if not exists public.meterReadings (
  "id" uuid primary key,
  "ownerId" uuid not null,
  "tenantId" uuid not null,
  "utility" text not null check ("utility" in ('electric', 'water')),
  "period" text,
  "readingDate" text,
  "prevValue" double precision,
  "value" double precision not null,
  "usage" double precision,
  "photoId" uuid,
  "thumb" text,
  "billId" uuid,
  "source" text default 'manual',
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 月账单 ----------
create table if not exists public.bills (
  "id" uuid primary key,
  "ownerId" uuid not null,
  "tenantId" uuid not null,
  "tenantName" text,
  "period" text not null, -- 'YYYY-MM'
  "dueDate" text,
  "items" jsonb default '[]',
  "total" bigint default 0,
  "note" text,
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 收款记录（支持分次） ----------
create table if not exists public.payments (
  "id" uuid primary key,
  "ownerId" uuid not null,
  "billId" uuid not null,
  "tenantId" uuid,
  "amount" bigint not null,
  "paidDate" text,
  "method" text,
  "note" text,
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

-- ---------- 推送订阅 ----------
create table if not exists public.push_subscriptions (
  "endpoint" text primary key,
  "authUid" uuid not null,
  "landlordId" uuid,
  "landlordName" text,
  "keys" jsonb,
  "updatedAt" bigint default 0
);

-- ---------- 索引（增量同步 + 常用查询） ----------
create index if not exists idx_buildings_sync on public.buildings ("updatedAt");
create index if not exists idx_tenants_sync on public.tenants ("updatedAt");
create index if not exists idx_tenants_owner on public.tenants ("ownerId") where "deletedAt" is null;
create index if not exists idx_readings_sync on public.meterReadings ("updatedAt");
create index if not exists idx_readings_tenant on public.meterReadings ("tenantId", "utility");
create index if not exists idx_bills_sync on public.bills ("updatedAt");
create index if not exists idx_bills_tenant_period on public.bills ("tenantId", "period");
create index if not exists idx_bills_period on public.bills ("period") where "deletedAt" is null;
create index if not exists idx_payments_sync on public.payments ("updatedAt");
create index if not exists idx_payments_bill on public.payments ("billId");
create index if not exists idx_push_user on public.push_subscriptions ("landlordId");

-- =============================================================
-- 行级安全（RLS）：成员只能看/改自己的数据；管理员可以看/改全家。
-- ownerId 存的是各人登录账号的 auth.users.id。
-- =============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.landlords l
    where l."authUid" = auth.uid()
      and l."role" = 'admin'
      and l."deletedAt" is null
  );
$$;

-- 管理员角色保护：非管理员不能把任何人（含自己）设为管理员；第一位用户除外
create or replace function public.guard_landlord_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_other_admin boolean;
begin
  if NEW."role" = 'admin' and not public.is_admin() then
    select exists (
      select 1 from public.landlords
      where "role" = 'admin' and "deletedAt" is null
        and "id" is distinct from NEW."id"
    ) into has_other_admin;
    if has_other_admin then
      raise exception '只有管理员能设置管理员';
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_guard_landlord_role on public.landlords;
create trigger trg_guard_landlord_role
  before insert or update on public.landlords
  for each row execute function public.guard_landlord_role();

alter table public.landlords enable row level security;
alter table public.buildings enable row level security;
alter table public.tenants enable row level security;
alter table public.meterReadings enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.push_subscriptions enable row level security;

-- landlords：都能看（首页要显示名字），只能改自己的（管理员可改全部）
create policy "landlords_select" on public.landlords for select to authenticated using (true);
create policy "landlords_insert" on public.landlords for insert to authenticated with check ("authUid" = auth.uid());
create policy "landlords_update" on public.landlords for update to authenticated using ("authUid" = auth.uid() or public.is_admin());
create policy "landlords_delete" on public.landlords for delete to authenticated using ("authUid" = auth.uid() or public.is_admin());

-- 业务表统一策略
do $$
declare
  t text;
begin
  foreach t in array array['buildings', 'tenants', 'meterReadings', 'bills', 'payments']
  loop
    execute format('create policy "%s_select" on public.%I for select to authenticated using ("ownerId" = auth.uid() or public.is_admin());', t, t);
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check ("ownerId" = auth.uid() or public.is_admin());', t, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using ("ownerId" = auth.uid() or public.is_admin());', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using ("ownerId" = auth.uid() or public.is_admin());', t, t);
  end loop;
end;
$$;

-- 推送订阅：每人只管自己的
create policy "push_select" on public.push_subscriptions for select to authenticated using ("authUid" = auth.uid());
create policy "push_insert" on public.push_subscriptions for insert to authenticated with check ("authUid" = auth.uid());
create policy "push_update" on public.push_subscriptions for update to authenticated using ("authUid" = auth.uid());
create policy "push_delete" on public.push_subscriptions for delete to authenticated using ("authUid" = auth.uid());
