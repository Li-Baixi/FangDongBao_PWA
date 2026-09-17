import { db, getMeta, setMeta } from './dexie'
import { cloudEnabled, SYNC_TABLES } from './supabase'
import { scheduleFlush, outboxCount } from './sync'
import { uid, nowTs } from '@/utils/id'

/**
 * 统一数据访问层：界面只跟 repo 打交道，不直接碰数据库。
 * 写入路径：内存对象 -> 本地 IndexedDB（立即持久化，离线可用）
 *          -> 若云模式，同时进 outbox 队列，后台推送到 Supabase。
 */

const SYNCED = new Set(SYNC_TABLES)
const listeners = new Set()

/** 订阅数据变化（data store 用来刷新内存缓存） */
export function onRepoChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emitChange(topic) {
  for (const fn of listeners) {
    try {
      fn(topic)
    } catch (e) {
      console.error(e)
    }
  }
}

function stripLocalOnly(rec) {
  // pinHash 只在本地有意义，不上云
  const { pinHash, ...rest } = rec
  return rest
}

/** 底层写入：盖时间戳 -> 存本地 -> （云模式）入同步队列 */
async function persist(table, record, { notify = true } = {}) {
  const rec = { ...record, updatedAt: nowTs() }
  await db.table(table).put(rec)
  if (cloudEnabled && SYNCED.has(table)) {
    await db.outbox.add({ table, record: stripLocalOnly(rec), ts: nowTs() })
    scheduleFlush()
  }
  if (notify) emitChange(table)
  return rec
}

/** 软删除（保留历史与同步轨迹） */
async function softDelete(table, id) {
  const rec = await db.table(table).get(id)
  if (!rec) return
  await persist(table, { ...rec, deletedAt: nowTs() })
}

// ============ 房东档案（家庭成员） ============

export async function listLandlords() {
  const rows = await db.landlords.toArray()
  return rows
    .filter((r) => !r.deletedAt)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function saveLandlord(data) {
  const existing = data.id ? await db.landlords.get(data.id) : null
  const rec = {
    ...existing,
    ...data,
    id: data.id || uid(),
    createdAt: existing?.createdAt || nowTs(),
  }
  return persist('landlords', rec)
}

export async function deleteLandlord(id) {
  await softDelete('landlords', id)
}

export async function hashPin(pin, salt) {
  if (!pin) return null
  const s = salt || uid()
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${s}:${pin}`))
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { hash, salt: s }
}

export async function verifyPin(landlord, pin) {
  if (!landlord.pinHash) return true // 没设密码的档案直接进入
  if (!pin) return false
  const { hash } = await hashPin(pin, landlord.pinSalt)
  return hash === landlord.pinHash
}

// ============ 楼栋 ============

export async function listBuildings() {
  const rows = await db.buildings.toArray()
  return rows.filter((r) => !r.deletedAt).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getBuilding(id) {
  const r = await db.buildings.get(id)
  return r && !r.deletedAt ? r : null
}

export async function saveBuilding(data) {
  const existing = data.id ? await db.buildings.get(data.id) : null
  return persist('buildings', {
    ...existing,
    ...data,
    id: data.id || uid(),
    createdAt: existing?.createdAt || nowTs(),
  })
}

export async function deleteBuilding(id) {
  await softDelete('buildings', id)
}

// ============ 租客 ============

export async function listTenants() {
  const rows = await db.tenants.toArray()
  return rows.filter((r) => !r.deletedAt).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getTenant(id) {
  const r = await db.tenants.get(id)
  return r && !r.deletedAt ? r : null
}

/**
 * 保存租客（新建/编辑）。退租只改 status，不删数据，历史账单永久保留。
 */
export async function saveTenant(data) {
  const existing = data.id ? await db.tenants.get(data.id) : null
  return persist('tenants', {
    ...existing,
    ...data,
    id: data.id || uid(),
    ownerId: data.ownerId || existing?.ownerId,
    createdAt: existing?.createdAt || nowTs(),
  })
}

/** 彻底移入回收站（软删除）。常规退租请用 markTenantLeft。 */
export async function deleteTenant(id) {
  await softDelete('tenants', id)
}

export async function markTenantLeft(id, date) {
  const t = await getTenant(id)
  if (!t) return
  await persist('tenants', { ...t, status: 'left', movedOutAt: date || nowTs() })
}

export async function markTenantActive(id) {
  const t = await getTenant(id)
  if (!t) return
  await persist('tenants', { ...t, status: 'active', movedOutAt: null })
}

// ============ 抄表记录 ============

export async function listReadingsByTenant(tenantId) {
  const rows = await db.meterReadings.where('tenantId').equals(tenantId).toArray()
  return rows.filter((r) => !r.deletedAt).sort((a, b) => (a.readingDate > b.readingDate ? -1 : 1))
}

/** 每个表种的最新一次读数（收租向导自动带出"上次读数"） */
export async function latestReadings(tenantId) {
  const rows = await listReadingsByTenant(tenantId)
  const out = {}
  for (const util of ['electric', 'water']) {
    const r = rows.find((x) => x.utility === util)
    if (r) out[util] = r
  }
  return out
}

export async function saveReading(data) {
  const existing = data.id ? await db.meterReadings.get(data.id) : null
  return persist('meterReadings', {
    ...existing,
    ...data,
    id: data.id || uid(),
    createdAt: existing?.createdAt || nowTs(),
  })
}

// ============ 账单 ============

export async function listBills() {
  const rows = await db.bills.toArray()
  return rows.filter((r) => !r.deletedAt).sort((a, b) => (a.period > b.period ? -1 : 1))
}

export async function getBill(id) {
  const r = await db.bills.get(id)
  return r && !r.deletedAt ? r : null
}

export async function findBill(tenantId, period) {
  const rows = await db.bills.where('tenantId').equals(tenantId).and((r) => !r.deletedAt && r.period === period).toArray()
  return rows[0] || null
}

export async function saveBill(data) {
  const existing = data.id ? await db.bills.get(data.id) : null
  return persist('bills', {
    ...existing,
    ...data,
    id: data.id || uid(),
    createdAt: existing?.createdAt || nowTs(),
  })
}

export async function deleteBill(id) {
  await softDelete('bills', id)
}

// ============ 收款记录（支持分次交租） ============

export async function listPayments() {
  const rows = await db.payments.toArray()
  return rows.filter((r) => !r.deletedAt).sort((a, b) => (a.paidDate > b.paidDate ? 1 : -1))
}

export async function savePayment(data) {
  const existing = data.id ? await db.payments.get(data.id) : null
  return persist('payments', {
    ...existing,
    ...data,
    id: data.id || uid(),
    createdAt: existing?.createdAt || nowTs(),
  })
}

export async function deletePayment(id) {
  await softDelete('payments', id)
}

// ============ 拍照（只存本地） ============

export async function savePhoto(data) {
  const rec = { ...data, id: data.id || uid(), createdAt: nowTs() }
  await db.photos.put(rec)
  return rec
}

export async function getPhoto(id) {
  return await db.photos.get(id)
}

// ============ 会话与杂项 ============

export async function getSessionLandlordId() {
  return await getMeta('sessionLandlordId', null)
}

export async function setSessionLandlordId(id) {
  await setMeta('sessionLandlordId', id)
}

export async function getPendingSyncCount() {
  if (!cloudEnabled) return 0
  return outboxCount()
}

const repo = {
  cloudEnabled,
  onRepoChange,
  // landlords
  listLandlords,
  saveLandlord,
  deleteLandlord,
  hashPin,
  verifyPin,
  // buildings
  listBuildings,
  getBuilding,
  saveBuilding,
  deleteBuilding,
  // tenants
  listTenants,
  getTenant,
  saveTenant,
  deleteTenant,
  markTenantLeft,
  markTenantActive,
  // readings
  listReadingsByTenant,
  latestReadings,
  saveReading,
  // bills
  listBills,
  getBill,
  findBill,
  saveBill,
  deleteBill,
  // payments
  listPayments,
  savePayment,
  deletePayment,
  // photos
  savePhoto,
  getPhoto,
  // session
  getSessionLandlordId,
  setSessionLandlordId,
  getPendingSyncCount,
}

export default repo
