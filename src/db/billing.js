import { calcUsage, usageToAmount } from '@/utils/money'

/**
 * 计费核心逻辑（纯函数，无副作用）。
 *
 * 租客的计费配置：
 *   monthlyRent: 月房租（分）
 *   internet:    网费等固定费（分/月，0 表示无）
 *   electric: { mode: 'metered' 按表 | 'flat' 包干 | 'included' 全包, price: 分/度, flatAmount: 分/月 }
 *   water:    { mode: 同上, price: 分/吨, flatAmount: 分/月 }
 */

export const UTILITY_LABELS = { electric: '电费', water: '水费' }

/**
 * 计算某项水电费。
 * 返回 { amount: 分, usage: 用量, mode }
 */
export function utilityCharge(cfg, prev, cur) {
  if (!cfg || cfg.mode === 'included') return { amount: 0, usage: 0, mode: 'included' }
  if (cfg.mode === 'flat') return { amount: cfg.flatAmount || 0, usage: 0, mode: 'flat' }
  const usage = calcUsage(prev ?? 0, cur ?? 0)
  return { amount: usageToAmount(usage, cfg.price || 0), usage, mode: 'metered' }
}

/**
 * 生成账单草稿（收租向导"账单确认"页的数据源，每一项之后都可以人工改）。
 * readings: { electric: {prev, cur}, water: {prev, cur} }，按表的租客才有对应键。
 */
export function buildBillDraft(tenant, period, readings = {}) {
  const items = []
  if (tenant.monthlyRent > 0) {
    items.push({ type: 'rent', name: '房租', amount: tenant.monthlyRent || 0 })
  }
  if (tenant.internet > 0) {
    items.push({ type: 'internet', name: '网费', amount: tenant.internet || 0 })
  }
  for (const util of ['electric', 'water']) {
    const cfg = tenant[util]
    if (!cfg || cfg.mode === 'included') continue
    if (cfg.mode === 'flat') {
      if ((cfg.flatAmount || 0) !== 0) {
        items.push({
          type: util,
          name: `${UTILITY_LABELS[util]}（包干）`,
          amount: cfg.flatAmount || 0,
          detail: { mode: 'flat' },
        })
      }
      continue
    }
    const r = readings[util] || {}
    const { amount, usage } = utilityCharge(cfg, r.prev, r.cur)
    items.push({
      type: util,
      name: UTILITY_LABELS[util],
      amount,
      detail: {
        mode: 'metered',
        usage,
        prev: r.prev ?? null,
        cur: r.cur ?? null,
        unitPrice: cfg.price || 0,
      },
    })
  }
  const total = items.reduce((s, i) => s + (i.amount || 0), 0)
  return { items, total }
}

/** 账单项合计 */
export function sumItems(items) {
  return (items || []).reduce((s, i) => s + (i.amount || 0), 0)
}

/**
 * 账单状态推导（核心鲁棒性逻辑）：
 *   paid    已结清（含全减免）
 *   partial 部分已收且未过收租日
 *   overdue 逾期（过了收租日还没收齐，含部分收款后欠的）
 *   pending 待收（未到收租日）
 * paidFen: 该账单的累计收款（分）
 */
export function billStatus(bill, paidFen, todayStr) {
  const total = bill.total || 0
  const paid = paidFen || 0
  if (total <= 0) return 'paid'
  if (paid >= total) return 'paid'
  const overdue = todayStr > (bill.dueDate || '')
  if (paid > 0) return overdue ? 'overdue' : 'partial'
  return overdue ? 'overdue' : 'pending'
}

export const STATUS_META = {
  paid: { label: '已结清', cls: 'fdb-tag--paid' },
  partial: { label: '部分已收', cls: 'fdb-tag--partial' },
  overdue: { label: '逾期', cls: 'fdb-tag--overdue' },
  pending: { label: '待收', cls: 'fdb-tag--pending' },
}
