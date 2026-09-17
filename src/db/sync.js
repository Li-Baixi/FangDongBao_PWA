import { db, getMeta, setMeta } from './dexie'
import { supabase, cloudEnabled, SYNC_TABLES } from './supabase'

/**
 * 云同步引擎（仅 cloud 模式启用）。
 * 策略：本地优先写入 + 后台推送（outbox 队列）+ 增量拉取（updatedAt 游标）。
 * 冲突按 updatedAt "新者胜"（家庭场景足够，避免复杂的冲突合并）。
 * 删除走软删除（deletedAt），不会因同步误删历史。
 */

let flushTimer = null
let flushing = false

/** 防抖触发推送 */
export function scheduleFlush(delay = 2500) {
  if (!cloudEnabled) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushOutbox().catch(() => {})
  }, delay)
}

/** 把本地队列推送到云端。失败静默保留队列，下次再试。 */
export async function flushOutbox() {
  if (!cloudEnabled || flushing) return { ok: true, remaining: 0 }
  flushing = true
  try {
    for (let round = 0; round < 50; round++) {
      const batch = await db.outbox.orderBy('seq').limit(20).toArray()
      if (!batch.length) break
      for (const entry of batch) {
        const { error } = await supabase.from(entry.table).upsert(entry.record)
        if (error) {
          // 重复键冲突(23505)：说明云端已有此记录，视为成功
          if (error.code !== '23505') {
            console.warn('[sync] push 失败，保留队列稍后重试:', error.message)
            return { ok: false, remaining: await outboxCount() }
          }
        }
        await db.outbox.delete(entry.seq)
      }
    }
    return { ok: true, remaining: 0 }
  } finally {
    flushing = false
  }
}

export async function outboxCount() {
  return await db.outbox.count()
}

/**
 * 增量拉取云端数据合入本地。
 * merge 规则：本地若还有该记录未推送的改动（outbox 里挂着），跳过覆盖，
 * 让本地稍后推送"新者胜"。
 */
export async function pullAll(force = false) {
  if (!cloudEnabled) return
  const state = (await getMeta('lastPull', {})) || {}
  const pendingIds = new Set()
  const entries = await db.outbox.toArray()
  for (const e of entries) if (e.record && e.record.id) pendingIds.add(e.record.id)

  for (const table of SYNC_TABLES) {
    const cursorKey = `pull_${table}`
    let gt = force ? 0 : state[cursorKey] || 0
    let saw = gt
    for (let page = 0; page < 50; page++) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gt('updatedAt', gt)
        .order('updatedAt', { ascending: true })
        .limit(500)
      if (error) throw new Error(`拉取 ${table} 失败: ${error.message}`)
      if (!data.length) break
      const rows = data.filter((r) => !pendingIds.has(r.id))
      if (rows.length) await db.table(table).bulkPut(rows)
      gt = data[data.length - 1].updatedAt
      saw = Math.max(saw, gt)
      if (data.length < 500) break
    }
    state[cursorKey] = Math.max(state[cursorKey] || 0, saw)
  }
  await setMeta('lastPull', state)
}

/** 登录后的全量初始化同步 */
export async function initialSync() {
  await flushOutbox()
  await pullAll(true)
}
