// 房东宝收租提醒（Supabase Edge Function，Deno 运行时）
// 每天 09:00（北京时间）由 pg_cron 触发：
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
  // 只接受持有 service role key 的内部调用（定时任务）
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  webpush.setVapidDetails(MAILTO, VAPID_PUBLIC, VAPID_PRIVATE)

  const supa = createClient(URL_, SERVICE_KEY)

  // ---- 北京时间的"今天" ----
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n) => String(n).padStart(2, '0')
  const todayStr = `${year}-${pad(month)}-${pad(day)}`
  const period = `${year}-${pad(month)}`

  // ---- 拉数据 ----
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

  return new Response(JSON.stringify({ ok: true, sent: results.length, detail: results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
