// 房东宝收租提醒（Supabase Edge Function，Deno 运行时）
// pg_cron 每分钟触发一次；程序先做"便宜检查"，
// 只有到了某位房东自选的提醒时间（几点几分）才真正拉账干活：
//   1) 今天是收租日且本期没收齐 -> 提醒房东
//   2) 逾期未清且间隔 2 天 -> 提醒房东
// 部署：supabase functions deploy rent-reminder
// 密钥：supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... PUSH_NOTIFY_MAILTO=...

// @ts-ignore Deno 环境
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore
import webpush from 'npm:web-push@3.6.7'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const MAILTO = Deno.env.get('PUSH_NOTIFY_MAILTO') ?? 'mailto:fangdongbao@example.com'

Deno.serve(async (req) => {
  // 只接受 service role 身份的内部调用（定时任务）。
  // 平台层已开启 JWT 校验，能进到这里的令牌都是签名有效的；
  // 这里再看身份：与环境服务密钥一致，或 JWT 声明 role=service_role
  // （新版项目的环境密钥是 sb_secret_ 格式，与后台复制的旧版 JWT 原文不同，
  //   所以不能逐字比对，要按声明判断）。
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  let isService = token !== '' && token === SERVICE_KEY
  if (!isService && token.split('.').length === 3) {
    try {
      const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const payload = JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)))
      isService = payload?.role === 'service_role'
    } catch {
      /* 解析失败按未授权处理 */
    }
  }
  if (!isService) {
    return new Response('Unauthorized', { status: 401 })
  }

  webpush.setVapidDetails(MAILTO, VAPID_PUBLIC, VAPID_PRIVATE)

  const supa = createClient(URL_, SERVICE_KEY)

  // ---- 北京时间的"今天" ----
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  const hour = now.getUTCHours() // 北京时间当前小时
  const minute = now.getUTCMinutes() // 北京时间当前分钟
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n) => String(n).padStart(2, '0')
  const todayStr = `${year}-${pad(month)}-${pad(day)}`
  const period = `${year}-${pad(month)}`

  // ---- 第一步（便宜检查）：这一分钟有没有人的自选提醒时间到了 ----
  // 闹钟每分钟叫醒本程序一次；没到点就直接返回，不碰账单等大表
  const force = new URL(req.url).searchParams.get('force') === '1'
  const { data: landlords, error: e5 } = await supa
    .from('landlords')
    .select('id,prefs')
    .is('deletedAt', null)
  if (e5) {
    return new Response(`查询失败: ${e5.message}`, { status: 500 })
  }
  // 每位房东自选的提醒时间（prefs.notifyHour/notifyMinute，默认 9:00）。
  // 只有"现在 == 自己选的几点几分"的人才收到推送，人人各选各的、互不干扰。
  // ?force=1（仅服务密钥可调）跳过时间过滤，用于手动测试推送。
  const matchedOwners = new Set(
    (landlords ?? [])
      .filter((l) =>
        force ||
        (Number(l.prefs?.notifyHour ?? 9) === hour &&
          Number(l.prefs?.notifyMinute ?? 0) === minute)
      )
      .map((l) => l.id)
  )
  if (matchedOwners.size === 0) {
    // 谁的点都没到：整点留一笔"心跳"痕（证明闹钟在自动跑），其余分钟静默返回
    if (minute === 0) {
      try {
        await supa.from('push_log').insert({ hour, minute, sent: 0, detail: [] })
      } catch { /* 留痕失败不影响 */ }
    }
    return new Response(JSON.stringify({ ok: true, sent: 0, idle: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ---- 第二步：到点了，才拉账单等大表干活 ----
  const [{ data: tenants, error: e1 }, { data: bills, error: e2 }, { data: payments, error: e3 }, { data: subs, error: e4 }] =
    await Promise.all([
      supa.from('tenants').select('id,ownerId,name,room,rentDay,monthlyRent,internet,electric,water').eq('status', 'active').is('deletedAt', null),
      supa.from('bills').select('id,tenantId,ownerId,period,dueDate,total').is('deletedAt', null),
      supa.from('payments').select('billId,amount').is('deletedAt', null),
      supa.from('push_subscriptions').select('endpoint,landlordId,keys'),
    ])
  if (e1 || e2 || e3 || e4) {
    return new Response(`查询失败: ${e1?.message || e2?.message || e3?.message || e4?.message}`, { status: 500 })
  }

  const paidByBill = new Map()
  for (const p of payments ?? []) {
    paidByBill.set(p.billId, (paidByBill.get(p.billId) || 0) + (p.amount || 0))
  }
  const subsByOwner = new Map()
  for (const s of subs ?? []) {
    if (!s.landlordId || !s.keys?.p256dh || !s.keys?.auth) continue
    if (!matchedOwners.has(s.landlordId)) continue
    if (!subsByOwner.has(s.landlordId)) subsByOwner.set(s.landlordId, [])
    subsByOwner.get(s.landlordId).push(s)
  }

  /** 发送给某位房东的所有设备 */
  const results = []
  async function notify(ownerId, body) {
    const list = subsByOwner.get(ownerId) || []
    for (const s of list) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify({ title: '房东宝 · 收租提醒', body, tag: 'rent-' + body.length })
        )
        results.push({ ok: s.endpoint.slice(0, 40) })
      } catch (err) {
        // 订阅失效（404/410）就删掉，避免一直报错
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supa.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
        results.push({ fail: String(err?.message || err).slice(0, 80) })
      }
    }
  }

  const fmtYuan = (fen) => ((fen || 0) / 100).toFixed(2).replace(/\.00$/, '')

  // ---- 1) 今天的收租日 ----
  for (const t of tenants ?? []) {
    const rentDay = Math.min(t.rentDay || 1, daysInMonth)
    if (rentDay !== day) continue
    const bill = (bills ?? []).find((b) => b.tenantId === t.id && b.period === period)
    if (bill && (paidByBill.get(bill.id) || 0) >= (bill.total || 0)) continue // 已收齐
    const estimate = bill
      ? bill.total
      : (t.monthlyRent || 0) + (t.internet || 0) +
        (t.electric?.mode === 'flat' ? t.electric.flatAmount || 0 : 0) +
        (t.water?.mode === 'flat' ? t.water.flatAmount || 0 : 0)
    const who = t.room ? `${t.room}·${t.name}` : t.name
    await notify(t.ownerId, `今天该收 ${who} 的租金了，约 ¥${fmtYuan(estimate)}`)
  }

  // ---- 2) 逾期提醒（每 2 天一次，避免烦人） ----
  for (const b of bills ?? []) {
    if (!b.dueDate || b.dueDate >= todayStr) continue
    const paid = paidByBill.get(b.id) || 0
    if (paid >= (b.total || 0)) continue
    const overdueDays = Math.round((Date.parse(todayStr) - Date.parse(b.dueDate)) / 86400000)
    if (overdueDays % 2 !== 0) continue
    const t = (tenants ?? []).find((x) => x.id === b.tenantId)
    const who = t ? (t.room ? `${t.room}·${t.name}` : t.name) : '租客'
    const rest = (b.total || 0) - paid
    await notify(b.ownerId, `${who} ${b.period} 的租金逾期 ${overdueDays} 天，还差 ¥${fmtYuan(rest)}`)
  }

  // ---- 3) 已过收租日、还没抄表建账（漏收预警，每 2 天一次） ----
  // 场景：收租日过了但没建当期账单 —— 第 1 段只看当天、第 2 段只看已建账单，这里补盲区
  for (const t of tenants ?? []) {
    const rentDay = Math.min(t.rentDay || 1, daysInMonth)
    if (day <= rentDay) continue // 本月收租日还没到
    const hasBill = (bills ?? []).some((b) => b.tenantId === t.id && b.period === period)
    if (hasBill) continue // 建了账的交给第 2 段
    const overdueDays = day - rentDay
    if (overdueDays % 2 !== 0) continue
    const estimate = (t.monthlyRent || 0) + (t.internet || 0) +
      (t.electric?.mode === 'flat' ? t.electric.flatAmount || 0 : 0) +
      (t.water?.mode === 'flat' ? t.water.flatAmount || 0 : 0)
    const who = t.room ? `${t.room}·${t.name}` : t.name
    await notify(t.ownerId, `${who} 的收租日（${rentDay}号）已过 ${overdueDays} 天，还没建本期账单，约 ¥${fmtYuan(estimate)}`)
  }

  // ---- 运行留痕：真跑完（到点干活）记一笔，排查"闹钟到底跑没跑"一看便知 ----
  //（表由 migrations/0004_push_log.sql 建立，只有服务密钥能读写）
  try {
    await supa.from('push_log').insert({
      hour,
      minute,
      sent: results.filter((r) => r.ok).length,
      detail: results,
    })
  } catch {
    /* 留痕失败不影响发送 */
  }

  return new Response(JSON.stringify({ ok: true, sent: results.length, detail: results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
