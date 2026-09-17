import Dexie from 'dexie'

/**
 * 本地数据库（IndexedDB，浏览器自带，免费、离线可用）。
 * 所有表带 id（客户端生成 UUID）+ updatedAt（毫秒时间戳）+ deletedAt（软删除标记）。
 * 软删除：退租/删单后历史账仍可追溯，也避免云同步误删。
 */
export const db = new Dexie('fangdongbao')

db.version(1).stores({
  landlords: 'id, updatedAt',
  buildings: 'id, ownerId, updatedAt',
  tenants: 'id, ownerId, buildingId, status, updatedAt',
  meterReadings: 'id, tenantId, utility, period, readingDate',
  bills: 'id, tenantId, period, dueDate',
  payments: 'id, billId, tenantId, paidDate',
  photos: 'id, tenantId, createdAt', // 拍照原图（只存本机，不上云）
  outbox: '++seq, ts', // 云模式：待同步队列（本地写完先入队，联网后推送）
  meta: 'key', // 杂项键值：当前档案、同步游标等
})

export async function getMeta(key, def = null) {
  const row = await db.meta.get(key)
  return row ? row.value : def
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value })
}

/** 过滤掉已软删除的记录 */
export function alive(rows) {
  return (rows || []).filter((r) => !r.deletedAt)
}
