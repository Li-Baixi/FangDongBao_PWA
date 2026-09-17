import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import repo, { onRepoChange } from '@/db/repo'
import { billStatus } from '@/db/billing'
import { today, periodOf, monthDays } from '@/utils/dates'

/**
 * 内存数据缓存：repo 任何写入都会自动触发 reload。
 * 家庭数据量级（每年几百条），全量进内存最简单可靠。
 */
let bound = false

export const useDataStore = defineStore('data', {
  state: () => ({
    loading: false,
    landlords: [],
    buildings: [],
    tenants: [],
    bills: [],
    payments: [],
  }),
  getters: {
    buildingsById: (s) => Object.fromEntries(s.buildings.map((b) => [b.id, b])),
    tenantsById: (s) => Object.fromEntries(s.tenants.map((t) => [t.id, t])),
    landlordsById: (s) => Object.fromEntries(s.landlords.map((l) => [l.id, l])),
    /** 每张账单的累计已收（分） */
    paidByBill: (s) => {
      const m = {}
      for (const p of s.payments) m[p.billId] = (m[p.billId] || 0) + (p.amount || 0)
      return m
    },
  },
  actions: {
    bind() {
      if (bound) return
      bound = true
      onRepoChange(() => this.reload())
    },
    async reload() {
      this.loading = true
      try {
        const [landlords, buildings, tenants, bills, payments] = await Promise.all([
          repo.listLandlords(),
          repo.listBuildings(),
          repo.listTenants(),
          repo.listBills(),
          repo.listPayments(),
        ])
        this.landlords = landlords
        this.buildings = buildings
        this.tenants = tenants
        this.bills = bills
        this.payments = payments
      } finally {
        this.loading = false
      }
    },
  },
})

// ============ 派生视图（纯函数，页面直接调用） ============

/** 数据是否在当前查看范围内：self 自己 / all 全部（管理员）/ landlordId 某成员 */
export function inScope(row, session) {
  if (!row) return false
  if (session.viewing === 'all') return true
  const owner = session.viewing === 'self' ? session.current?.id : session.viewing
  return row.ownerId === owner
}

/** 账单附上状态/已收/欠款 */
export function billView(bill, paidMap, tStr) {
  const paid = paidMap[bill.id] || 0
  const total = bill.total || 0
  return {
    ...bill,
    paid,
    remaining: Math.max(0, total - paid),
    status: billStatus(bill, paid, tStr || today()),
  }
}

/** 某租客当前总欠款（所有未结清账单的 remaining 合计） */
export function tenantDebt(tenantId, bills, paidMap, tStr) {
  let sum = 0
  for (const b of bills) {
    if (b.tenantId !== tenantId) continue
    const v = billView(b, paidMap, tStr)
    if (v.status !== 'paid') sum += v.remaining
  }
  return sum
}

/**
 * 今天是否是某租客本月的收租日（收租日按月末钳位）。
 */
export function isRentDayToday(tenant) {
  if (tenant.status !== 'active') return false
  const now = new Date()
  const len = monthDays(now.getFullYear(), now.getMonth() + 1)
  return now.getDate() === Math.min(tenant.rentDay || 1, len)
}

/**
 * 首页"今日待收"：在租、今天是收租日、且本期账单未结清（或还没建）。
 */
export function dueTodayList(tenants, bills, paidMap, session, tStr) {
  const period = periodOf()
  const out = []
  for (const t of tenants) {
    if (!inScope(t, session) || t.status !== 'active') continue
    if (!isRentDayToday(t)) continue
    const bill = bills.find((b) => b.tenantId === t.id && b.period === period)
    const settled = bill ? billView(bill, paidMap, tStr).status === 'paid' : false
    if (!settled) out.push({ tenant: t, bill: bill || null })
  }
  return out
}

/** 近 N 天内将到收租日（含今天），用于首页预告 */
export function upcomingWithinDays(tenants, session, days = 7) {
  const now = dayjs()
  const todayD = now.date()
  const thisLen = now.daysInMonth()
  const nextMonth = now.add(1, 'month')
  const nextLen = nextMonth.daysInMonth()
  const out = []
  for (const t of tenants) {
    if (!inScope(t, session) || t.status !== 'active') continue
    const rd = Math.min(t.rentDay || 1, thisLen)
    let diff = rd - todayD
    if (diff < 0) {
      // 已过本月收租日，看下个月
      const nextRd = Math.min(t.rentDay || 1, nextLen)
      diff = thisLen - todayD + nextRd
    }
    if (diff >= 0 && diff <= days) out.push({ tenant: t, inDays: diff })
  }
  return out.sort((a, b) => a.inDays - b.inDays)
}

/** 逾期未结清账单列表（首页醒目提醒） */
export function overdueBills(bills, paidMap, session, tStr) {
  const t = tStr || today()
  return bills
    .filter((b) => inScope(b, session))
    .map((b) => billView(b, paidMap, t))
    .filter((v) => v.status === 'overdue')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
}
