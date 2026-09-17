/** 生成全局唯一 ID（各设备离线生成也不冲突，云同步依赖这一点） */
export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // 兜底：时间戳 + 随机数
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

/** 当前时间戳（毫秒整数），用作 updated_at 乐观同步 */
export function nowTs() {
  return Date.now()
}
