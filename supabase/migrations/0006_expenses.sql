-- 0006：支出记录（维护成本：打扫卫生 / 维修 / 更换设施 / 其他）
-- 与其他业务表同款规则：行级安全 = 只能动自己的数据，管理员可看可改全部。
-- 在 Supabase SQL Editor 里整段运行一次即可（可重复运行不出错）。
create table if not exists public.expenses (
  "id" uuid primary key,
  "ownerId" uuid not null,
  "buildingId" uuid,
  "date" text not null,
  "category" text,
  "amount" bigint not null,
  "note" text,
  "createdAt" bigint default 0,
  "updatedAt" bigint default 0,
  "deletedAt" bigint
);

create index if not exists idx_expenses_sync on public.expenses ("updatedAt");

alter table public.expenses enable row level security;

drop policy if exists "expenses_select" on public.expenses;
drop policy if exists "expenses_insert" on public.expenses;
drop policy if exists "expenses_update" on public.expenses;
drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_select" on public.expenses for select to authenticated using (public.is_my_data("ownerId") or public.is_admin());
create policy "expenses_insert" on public.expenses for insert to authenticated with check (public.is_my_data("ownerId") or public.is_admin());
create policy "expenses_update" on public.expenses for update to authenticated using (public.is_my_data("ownerId") or public.is_admin());
create policy "expenses_delete" on public.expenses for delete to authenticated using (public.is_my_data("ownerId") or public.is_admin());
