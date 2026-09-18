// 注销账号（Supabase Edge Function，Deno 运行时）
// 前端在「我的 → 注销账号」完成三重确认后调用：
//   1. 先清空云端业务数据（前端已做）
//   2. 调本函数删除登录账号本体（需要 service key，浏览器端做不了）
// 鉴权：只认 Bearer <用户自己的 access_token>，删的就是这个 token 对应的账号。
//
// 部署：supabase functions deploy delete-account
// 依赖 SUPABASE_SERVICE_ROLE_KEY secret（与 rent-reminder 相同）。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'missing token' }), { status: 401 })
  }

  const admin = createClient(PROJECT_URL, SERVICE_KEY)

  // 验证 token 并取出真实用户
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 })
  }
  const uid = userData.user.id

  // 兜底清数据（幂等：前端已清过，这里再删一遍防漏）
  const myLandlords = await admin
    .from('landlords')
    .select('id')
    .eq('authUid', uid)
  const ownerIds = (myLandlords.data || []).map((r) => r.id)
  for (const t of ['buildings', 'tenants', 'meterReadings', 'bills', 'payments']) {
    if (ownerIds.length) {
      await admin.from(t).delete().in('ownerId', ownerIds)
    }
  }
  await admin.from('push_subscriptions').delete().eq('authUid', uid)
  await admin.from('landlords').delete().eq('authUid', uid)

  // 删除账号本体（auth.users）
  const { error: delError } = await admin.auth.admin.deleteUser(uid)
  if (delError) {
    return new Response(JSON.stringify({ error: delError.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
