import dayjs from 'dayjs'

/** 今天的日期字符串 'YYYY-MM-DD' */
export function today() {
  return dayjs().format('YYYY-MM-DD')
}

/** 月份期号 'YYYY-MM' */
export function periodOf(date) {
  return dayjs(date || undefined).format('YYYY-MM')
}

/** 某年某月有多少天（month: 1-12） */
export function monthDays(year, month) {
  return dayjs(`${year}-${String(month).padStart(2, '0')}-01`).daysInMonth()
}

/**
 * 计算某期账单的收租截止日（收租日按月末钳位）。
 * period: 'YYYY-MM'，rentDay: 1-31
 * 例：2025-02 + 31 -> 2025-02-28；2025-04 + 31 -> 2025-04-30
 */
export function dueDateFor(period, rentDay) {
  const [y, m] = period.split('-').map(Number)
  const d = Math.min(Number(rentDay) || 1, monthDays(y, m))
  return `${period}-${String(d).padStart(2, '0')}`
}

/** 今天是当月第几天 */
export function dayOfMonth() {
  return dayjs().date()
}

/** 两日期相差天数（a - b） */
export function daysBetween(a, b) {
  return dayjs(a).startOf('day').diff(dayjs(b).startOf('day'), 'day')
}

/** 数字格式化：读数展示（最多 2 位小数，去掉多余的 0） */
export function fmtReading(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 100) / 100)
}
