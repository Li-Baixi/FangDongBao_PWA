import { createClient } from '@supabase/supabase-js'

/**
 * 云同步客户端（Supabase 免费版）。
 * 没有配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 时自动进入本地单机模式，
 * 应用依然完整可用——数据永不锁死。
 */
const url = import.meta.env.VITE_SUPABASE_URL || ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const cloudEnabled = Boolean(url && anonKey)

export const supabase = cloudEnabled
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null

/** 参与云同步的表（photos/outbox/meta 只在本地） */
export const SYNC_TABLES = ['landlords', 'buildings', 'tenants', 'meterReadings', 'bills', 'payments']

/** Web Push 的 VAPID 公钥（服务端持有私钥），未配置则推送按钮隐藏 */
// VAPID 公钥本身就是要发给每个浏览器端公开使用的信息（等同网址），写死默认值，
// 避免依赖 GitHub Secrets 导致构建缺钥匙。私钥只在 Supabase 服务端，绝不出现在这里。
export const vapidPublicKey =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BKETsAym3zsy6CbZkpDRK50JafEJR9YzpkY4vPwJDL838QN22sbBoRy3wqZVyZ0LV5I6bUdYD7pCl2g10OBZILU'
