-- =============================================================
-- 每天定时触发收租提醒（在 Supabase SQL Editor 里运行一次）
-- 运行前先替换两处 <...>：
--   PROJECT_REF ：项目 Settings -> General 里那串 ref（网址里也有）
--   SERVICE_ROLE_KEY：项目 Settings -> API 里的 service_role 密钥
-- 注意：service_role 密钥等同管理员权限，只贴在这个私有调度里，
--       绝不要写进前端代码或提交到 GitHub。
-- =============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('rent-reminder-daily')
where exists (select 1 from cron.job where jobname = 'rent-reminder-daily');

select cron.schedule(
  'rent-reminder-daily',
  '0 * * * *',  -- 每小时整点跑一次；程序内部只在"当前小时 == 每位用户自选提醒时间"时才发推送
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/rent-reminder',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
