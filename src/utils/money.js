/**
 * 金额工具：数据库里一律存“分”（整数），彻底避免浮点误差。
 * 例：1234.56 元 -> 123456 分
 */

/** 元（数字或字符串）-> 分（整数），非法输入返回 0 */
export function yuanToFen(yuan) {
  const n = typeof yuan === 'string' ? parseFloat(yuan.trim()) : Number(yuan)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** 分 -> 元（数字，保留两位小数） */
export function fenToYuan(fen) {
  const n = Number(fen) || 0
  return Math.round(n) / 100
}

/** 分 -> 展示字符串："1234.56"；comma=true 带千分位："1,234.56"；sign=true 正数带 + */
export function formatFen(fen, { comma = false, sign = false } = {}) {
  const neg = fen < 0
  const abs = Math.abs(Math.round(Number(fen) || 0))
  const yuan = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  let yuanStr = comma ? yuan.toLocaleString('en-US') : String(yuan)
  if (neg) yuanStr = `-${yuanStr}`
  else if (sign && abs !== 0) yuanStr = `+${yuanStr}`
  return `${yuanStr}.${cents}`
}

/** 分 -> 表单输入框用的字符串（不带千分位）："1234.56" */
export function fenToInput(fen) {
  return formatFen(fen)
}

/** 用量：保留 2 位小数的数字（读数相减） */
export function calcUsage(prev, cur) {
  return Math.round((Number(cur) - Number(prev)) * 100) / 100
}

/** 用量 x 单价(分) -> 金额(分)，四舍五入 */
export function usageToAmount(usage, priceFen) {
  return Math.round(usage * priceFen)
}
