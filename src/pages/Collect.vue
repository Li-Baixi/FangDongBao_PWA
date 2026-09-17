<script setup>
/**
 * 收租向导（应用的核心流程）：
 *   1. 选租客（可从首页带参直达）
 *   2. 逐个抄表：拍照 + 上次读数自动带出 + 输入本次读数（可 OCR 预填）
 *   3. 账单确认：房租/水电/包干自动算好，每一项都能改，能加杂费/减免
 *   4. 记收款：全额 / 部分分次 / 暂不收
 * 若本期账单已存在则进入"补录/编辑"模式，可改数、补收款。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showLoadingToast, showConfirmDialog } from 'vant'
import dayjs from 'dayjs'
import repo from '@/db/repo'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { buildBillDraft, sumItems } from '@/db/billing'
import { formatFen, yuanToFen, calcUsage } from '@/utils/money'
import { today, dueDateFor, periodOf } from '@/utils/dates'
import MeterPhotoStep from '@/components/MeterPhotoStep.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const phase = ref('pick') // pick | meter | bill | pay | done
const meterQueue = ref([]) // 需要抄表的表种，如 ['electric','water']
const meterIndex = ref(0)

const tenant = ref(null)
const period = ref(periodOf())
const showPeriodPicker = ref(false)
const showMethodPicker = ref(false)
const showDatePicker = ref(false)

// 抄表状态
const meters = ref({
  electric: { prev: '', cur: '', photo: null, photoId: null, thumb: null, readingId: null },
  water: { prev: '', cur: '', photo: null, photoId: null, thumb: null, readingId: null },
})

// 账单
const items = ref([])
const note = ref('')
const existingBill = ref(null)
const existingPayments = ref([])
const existingTotalPaid = ref(0)

// 收款
const payMode = ref('full') // full | partial | none
const payAmountYuan = ref('')
const payMethod = ref('现金')
const payDate = ref(today())
const methodOptions = ['现金', '微信', '支付宝', '银行转账']

const curUtil = computed(() => meterQueue.value[meterIndex.value])
const UTIL_NAME = { electric: '电表', water: '水表' }
const UTIL_UNIT = { electric: '度', water: '吨' }
const UTIL_ICON = { electric: '⚡', water: '💧' }

function utilPrice(util) {
  return tenant.value?.[util]?.price || 0
}

// ============ 选租客 ============
const search = ref('')
const pickList = computed(() => {
  const kw = search.value.trim()
  return data.tenants
    .filter((t) => t.status === 'active' && (session.isAdmin || t.ownerId === session.current?.id))
    .filter((t) => !kw || t.name.includes(kw) || (t.room || '').includes(kw))
    .sort((a, b) => (a.name > b.name ? 1 : -1))
})

async function selectTenant(t) {
  tenant.value = t
  await loadTenantState()
  const queue = []
  if (t.electric?.mode === 'metered') queue.push('electric')
  if (t.water?.mode === 'metered') queue.push('water')
  meterQueue.value = queue
  meterIndex.value = 0
  phase.value = queue.length ? 'meter' : 'bill'
  if (!queue.length) buildItems()
}

/** 载入上次读数、本期已有账单（编辑模式） */
async function loadTenantState() {
  const t = tenant.value
  const latest = await repo.latestReadings(t.id)
  const bill = await repo.findBill(t.id, period.value)
  existingBill.value = bill || null
  existingPayments.value = []
  existingTotalPaid.value = 0
  items.value = []
  note.value = ''

  for (const util of ['electric', 'water']) {
    const m = meters.value[util]
    m.cur = ''
    m.photo = null
    m.photoId = null
    m.thumb = null
    m.readingId = null
    // 上次读数：优先取本期账单里记录的 prev，否则取最新一次读数
    const billItem = bill?.items?.find((i) => i.type === util)
    if (billItem?.detail?.prev != null) {
      m.prev = String(billItem.detail.prev)
    } else if (latest[util]) {
      m.prev = String(latest[util].value)
    } else {
      m.prev = ''
    }
    // 编辑模式：带出本期已有读数与照片
    if (bill) {
      const rows = await repo.listReadingsByTenant(t.id)
      const r = rows.find((x) => x.utility === util && x.period === period.value)
      if (r) {
        m.readingId = r.id
        m.cur = String(r.value)
        m.prev = String(r.prevValue ?? m.prev)
        m.photoId = r.photoId || null
        m.thumb = r.thumb || null
        if (r.photoId) {
          const ph = await repo.getPhoto(r.photoId)
          if (ph) m.photo = ph.blob
        }
      }
    }
  }

  if (bill) {
    items.value = (bill.items || []).map((i) => ({ ...i }))
    note.value = bill.note || ''
    existingPayments.value = data.payments.filter((p) => p.billId === bill.id)
    existingTotalPaid.value = existingPayments.value.reduce((s, p) => s + (p.amount || 0), 0)
  }
}

async function changePeriod(p) {
  period.value = p
  showPeriodPicker.value = false
  if (tenant.value) await loadTenantState()
}

// ============ 抄表 ============
function onPhoto(util, { blob, thumb }) {
  const m = meters.value[util]
  m.photo = blob
  m.thumb = thumb
  m.photoId = null // 拍了新照片，稍后统一保存
}

function nextMeter() {
  if (meterIndex.value < meterQueue.value.length - 1) {
    meterIndex.value++
  } else {
    buildItems()
    phase.value = 'bill'
  }
}

/** 根据租客配置 + 抄表数据生成账单项（保留用户已加的杂费/减免行） */
function buildItems() {
  const t = tenant.value
  const readings = {}
  for (const util of meterQueue.value) {
    const m = meters.value[util]
    readings[util] = {
      prev: m.prev === '' ? 0 : Number(m.prev),
      cur: m.cur === '' ? null : Number(m.cur),
    }
  }
  const draft = buildBillDraft(t, period.value, readings)
  // 保留杂费/减免行（回到上一步改了读数再回来时，用户加过的行不丢）
  const kept = items.value.filter((i) => i.type === 'misc')
  items.value = [...draft.items, ...kept]
}

// ============ 账单确认 ============
const total = computed(() => sumItems(items.value))

const editingItem = ref(null)
const editAmountYuan = ref('')

function startEditItem(item) {
  editingItem.value = item
  editAmountYuan.value = (item.amount / 100).toFixed(2)
}
function confirmEditItem() {
  if (editingItem.value) {
    editingItem.value.amount = yuanToFen(editAmountYuan.value)
  }
  editingItem.value = null
}

const showMisc = ref(false)
const miscName = ref('')
const miscAmount = ref('')

function openMisc(preset) {
  miscName.value = preset || ''
  miscAmount.value = ''
  showMisc.value = true
}
function addMisc() {
  const name = miscName.value.trim()
  if (!name) {
    showToast('填个名称（如：卫生费）')
    return
  }
  let amount = yuanToFen(miscAmount.value)
  if (name.includes('减免')) amount = -Math.abs(amount) // 减免自动记为负数
  items.value.push({ type: 'misc', name, amount })
  showMisc.value = false
}
function removeItem(idx) {
  items.value.splice(idx, 1)
}

function itemDetailText(item) {
  if (item.detail?.mode === 'metered') {
    const { prev, cur, usage, unitPrice } = item.detail
    return `${prev ?? '?'} → ${cur ?? '?'}，用量 ${usage} × ${(unitPrice / 100).toFixed(2)} 元`
  }
  if (item.detail?.mode === 'flat') return '包干价'
  return ''
}

// ============ 收款 ============
function enterPay() {
  const remaining = total.value - existingTotalPaid.value
  payMode.value = remaining <= 0 ? 'none' : 'full'
  payAmountYuan.value = (Math.max(0, remaining) / 100).toFixed(2)
  phase.value = 'pay'
}

const remainingFen = computed(() => Math.max(0, total.value - existingTotalPaid.value))

async function deleteOldPayment(p) {
  try {
    await showConfirmDialog({ title: '删除这笔收款？', message: `${formatFen(p.amount)} 元（${p.paidDate}）` })
  } catch {
    return
  }
  await repo.deletePayment(p.id)
  existingPayments.value = existingPayments.value.filter((x) => x.id !== p.id)
  existingTotalPaid.value = existingPayments.value.reduce((s, x) => s + (x.amount || 0), 0)
}

// ============ 保存 ============
async function finish() {
  let payFen = 0
  if (payMode.value === 'full') payFen = remainingFen.value
  if (payMode.value === 'partial') {
    payFen = yuanToFen(payAmountYuan.value)
    if (payFen <= 0) {
      showToast('请填写本次收款金额')
      return
    }
    if (payFen > remainingFen.value) {
      try {
        await showConfirmDialog({
          title: '收款超过本期欠款',
          message: `本期还差 ${formatFen(remainingFen.value)} 元，你要记 ${formatFen(payFen)} 元？`,
        })
      } catch {
        return
      }
    }
  }

  const loading = showLoadingToast({ message: '保存中…', forbidClick: true, duration: 0 })
  try {
    const t = tenant.value
    const ownerId = t.ownerId || session.current?.id
    // 1. 账单
    const bill = await repo.saveBill({
      id: existingBill.value?.id,
      ownerId,
      tenantId: t.id,
      tenantName: t.name,
      period: period.value,
      dueDate: dueDateFor(period.value, t.rentDay || 1),
      items: items.value.map((i) => ({ ...i })),
      total: total.value,
      note: note.value.trim() || null,
    })
    // 2. 抄表记录 + 照片（照片拍下时就已存本地，这里建立关联）
    for (const util of meterQueue.value) {
      const m = meters.value[util]
      if (m.cur === '' || m.cur === null) continue
      let photoId = m.photoId
      if (m.photo && !photoId) {
        const ph = await repo.savePhoto({
          ownerId,
          tenantId: t.id,
          utility: util,
          period: period.value,
          blob: m.photo,
        })
        photoId = ph.id
      }
      await repo.saveReading({
        id: m.readingId || undefined,
        ownerId,
        tenantId: t.id,
        utility: util,
        period: period.value,
        readingDate: today(),
        prevValue: m.prev === '' ? null : Number(m.prev),
        value: Number(m.cur),
        usage: calcUsage(m.prev === '' ? 0 : Number(m.prev), Number(m.cur)),
        photoId,
        thumb: m.thumb || null,
        billId: bill.id,
        source: 'manual',
      })
    }
    // 3. 收款
    if (payFen > 0) {
      await repo.savePayment({
        ownerId,
        tenantId: t.id,
        billId: bill.id,
        amount: payFen,
        paidDate: payDate.value,
        method: payMethod.value,
      })
    }
    loading.close()
    phase.value = 'done'
    session.refreshPending()
  } catch (e) {
    loading.close()
    showToast(e.message || '保存失败，请重试')
  }
}

function resetAll() {
  tenant.value = null
  phase.value = 'pick'
  meterIndex.value = 0
  items.value = []
  note.value = ''
  existingBill.value = null
  existingTotalPaid.value = 0
  existingPayments.value = []
}

// 期号选择（近 18 个月）
const periodOptions = computed(() => {
  const arr = []
  const now = dayjs()
  for (let i = 0; i < 18; i++) {
    const p = now.subtract(i, 'month')
    arr.push({ text: p.format('YYYY年M月') + (i === 0 ? '（本月）' : ''), value: p.format('YYYY-MM') })
  }
  return arr
})

function fmtCalendarDate(d) {
  return dayjs(d).format('YYYY-MM-DD')
}

function goBackFromBill() {
  if (meterQueue.value.length) {
    meterIndex.value = 0
    phase.value = 'meter'
  } else {
    phase.value = 'pick'
  }
}

onMounted(() => {
  const id = route.params.tenantId
  const t = id ? data.tenantsById[id] : null
  if (t) selectTenant(t)
})
</script>

<template>
  <div class="fdb-page collect">
    <!-- ===== 第0步：选租客 ===== -->
    <template v-if="phase === 'pick'">
      <van-nav-bar title="开始收租" left-arrow @click-left="router.back()" />
      <van-search v-model="search" placeholder="搜索租客姓名 / 房号" />
      <div class="fdb-card" v-if="pickList.length">
        <div class="collect__tenant" v-for="t in pickList" :key="t.id" @click="selectTenant(t)">
          <div>
            <div class="collect__tname">{{ t.room ? t.room + ' · ' : '' }}{{ t.name }}</div>
            <div class="collect__tsub">
              月租 {{ formatFen(t.monthlyRent, { comma: true }) }} 元 · 每月{{ t.rentDay }}号收租
            </div>
          </div>
          <van-icon name="arrow" color="#c8c9cc" />
        </div>
      </div>
      <div class="fdb-card" v-else>
        <div class="fdb-empty">没有在租的租客，先去"租客"页添加</div>
      </div>
    </template>

    <!-- ===== 抄表 ===== -->
    <template v-else-if="phase === 'meter'">
      <van-nav-bar :title="`收租 · ${tenant.name}`" left-arrow @click-left="router.back()" />
      <van-steps :active="meterIndex" active-color="#0f766e">
        <van-step v-for="u in meterQueue" :key="u">{{ UTIL_NAME[u] }}</van-step>
        <van-step>账单</van-step>
        <van-step>收款</van-step>
      </van-steps>

      <div class="fdb-card">
        <div class="collect__period" @click="showPeriodPicker = true">
          <span>收租月份：<b>{{ period }}</b></span>
          <van-icon name="arrow-down" />
        </div>
        <MeterPhotoStep
          :title="`${UTIL_ICON[curUtil]} ${UTIL_NAME[curUtil]}`"
          :unit="UTIL_UNIT[curUtil]"
          :price-fen="utilPrice(curUtil)"
          v-model:modelPrev="meters[curUtil].prev"
          v-model:modelCur="meters[curUtil].cur"
          :photoBlob="meters[curUtil].photo"
          @photo="(p) => onPhoto(curUtil, p)"
        />
        <div style="display: flex; gap: 10px; margin-top: 14px">
          <van-button block round plain @click="router.back()">取消</van-button>
          <van-button block round type="primary" @click="nextMeter">
            {{ meterIndex < meterQueue.length - 1 ? '下一步' : '去确认账单' }}
          </van-button>
        </div>
      </div>
    </template>

    <!-- ===== 账单确认 ===== -->
    <template v-else-if="phase === 'bill'">
      <van-nav-bar title="确认账单" left-arrow @click-left="goBackFromBill" />
      <div class="fdb-card">
        <div class="fdb-card-title">
          <span>{{ tenant.room ? tenant.room + ' · ' : '' }}{{ tenant.name }} · {{ period }}</span>
        </div>

        <div class="collect__item" v-for="(item, idx) in items" :key="idx">
          <div class="collect__item-main" @click="startEditItem(item)">
            <div class="collect__item-name">
              {{ item.name }}
              <van-icon name="edit" size="12" color="#969799" />
            </div>
            <div class="collect__item-detail">{{ itemDetailText(item) }}</div>
          </div>
          <div class="collect__item-side">
            <div class="fdb-money" :style="{ color: item.amount < 0 ? '#07c160' : '' }">
              {{ formatFen(item.amount) }}
            </div>
            <van-icon v-if="item.type === 'misc'" name="delete-o" color="#ee0a24" @click.stop="removeItem(idx)" />
          </div>
        </div>

        <div class="collect__add">
          <van-button size="small" plain round icon="add-o" @click="openMisc('')">加杂费</van-button>
          <van-button size="small" plain round icon="minus" style="margin-left: 8px" @click="openMisc('减免')">
            记减免
          </van-button>
        </div>

        <van-field v-model="note" label="备注" placeholder="选填（如：延迟交租、补上月差额）" />

        <div class="collect__total">
          <span>本期应收</span>
          <span class="fdb-money fdb-money--lg">
            {{ formatFen(total, { comma: true }) }} <small>元</small>
          </span>
        </div>
        <div class="collect__duedate">收租截止日：{{ dueDateFor(period, tenant.rentDay || 1) }}</div>
        <div style="display: flex; gap: 10px; margin-top: 8px">
          <van-button block round plain @click="goBackFromBill">上一步</van-button>
          <van-button block round type="primary" @click="enterPay">去记收款</van-button>
        </div>
      </div>
    </template>

    <!-- ===== 收款 ===== -->
    <template v-else-if="phase === 'pay'">
      <van-nav-bar title="记收款" left-arrow @click-left="phase = 'bill'" />
      <div class="fdb-card">
        <div class="fdb-card-title">
          <span>{{ tenant.name }} · {{ period }}</span>
          <span>应收 <b class="fdb-money">{{ formatFen(total, { comma: true }) }}</b> 元</span>
        </div>

        <!-- 已有收款（编辑模式） -->
        <div v-if="existingPayments.length" class="collect__paid-list">
          <div class="collect__paid-title">已收记录（可分次）</div>
          <div class="collect__paid-row" v-for="p in existingPayments" :key="p.id">
            <span>{{ p.paidDate }} · {{ p.method }}</span>
            <span>
              <b class="fdb-money fdb-money--success">{{ formatFen(p.amount) }}</b> 元
              <van-icon name="delete-o" color="#ee0a24" style="margin-left: 6px" @click="deleteOldPayment(p)" />
            </span>
          </div>
          <div class="collect__paid-sum">
            已收 {{ formatFen(existingTotalPaid) }} 元，还差
            <b :style="{ color: remainingFen > 0 ? '#ff8c42' : '#07c160' }">{{ formatFen(remainingFen) }}</b> 元
          </div>
        </div>

        <van-radio-group v-model="payMode" v-if="remainingFen > 0">
          <van-cell-group inset>
            <van-cell title="这次收齐" clickable @click="payMode = 'full'">
              <template #right-icon><van-radio name="full" /></template>
            </van-cell>
            <van-cell title="部分收款（分次交）" clickable @click="payMode = 'partial'">
              <template #right-icon><van-radio name="partial" /></template>
            </van-cell>
            <van-cell title="暂不收款（只记账单）" clickable @click="payMode = 'none'">
              <template #right-icon><van-radio name="none" /></template>
            </van-cell>
          </van-cell-group>
        </van-radio-group>
        <div v-else class="fdb-empty">本期已收齐 🎉</div>

        <van-field
          v-if="payMode === 'partial'"
          v-model="payAmountYuan"
          type="number"
          label="本次收款"
          placeholder="元"
        >
          <template #right-icon>元</template>
        </van-field>

        <template v-if="payMode !== 'none' && remainingFen > 0">
          <van-field :model-value="payMethod" is-link readonly label="收款方式" @click="showMethodPicker = true" />
          <van-field :model-value="payDate" is-link readonly label="收款日期" @click="showDatePicker = true" />
        </template>

        <div style="display: flex; gap: 10px; margin-top: 14px">
          <van-button block round plain @click="phase = 'bill'">上一步</van-button>
          <van-button block round type="primary" @click="finish">完成</van-button>
        </div>
      </div>
    </template>

    <!-- ===== 完成 ===== -->
    <template v-else-if="phase === 'done'">
      <div class="collect__done">
        <van-icon name="checked" size="64" color="#07c160" />
        <div class="collect__done-title">已记好！</div>
        <div class="collect__done-sub">{{ tenant.name }} · {{ period }} 账单已保存</div>
        <div style="display: flex; gap: 10px; margin-top: 24px; width: 80%">
          <van-button block round plain @click="resetAll">再收一家</van-button>
          <van-button block round type="primary" @click="router.replace({ name: 'home' })">回首页</van-button>
        </div>
      </div>
    </template>

    <!-- 期号选择 -->
    <van-popup :show="showPeriodPicker" position="bottom" round @close="showPeriodPicker = false">
      <van-picker
        title="选择收租月份"
        :columns="periodOptions"
        @confirm="(e) => changePeriod(e.selectedValues[0])"
        @cancel="showPeriodPicker = false"
      />
    </van-popup>

    <!-- 改金额 -->
    <van-dialog
      :show="!!editingItem"
      title="修改金额（元）"
      show-cancel-button
      @confirm="confirmEditItem"
      @cancel="editingItem = null"
    >
      <van-field v-model="editAmountYuan" type="number" label="金额" placeholder="元" />
    </van-dialog>

    <!-- 加杂费 / 减免 -->
    <van-dialog
      v-model:show="showMisc"
      :title="miscName.includes('减免') ? '记减免' : '加一笔杂费'"
      show-cancel-button
      @confirm="addMisc"
    >
      <van-field v-model="miscName" label="名称" placeholder="如：卫生费 / 换锁 / 减免" />
      <van-field v-model="miscAmount" type="number" label="金额" placeholder="减免填正数，自动记为扣减">
        <template #right-icon>元</template>
      </van-field>
    </van-dialog>

    <!-- 收款方式 -->
    <van-action-sheet
      :show="showMethodPicker"
      :actions="methodOptions.map((m) => ({ name: m }))"
      @select="(a) => { payMethod = a.name; showMethodPicker = false }"
      @close="showMethodPicker = false"
    />

    <!-- 日期 -->
    <van-calendar
      :show="showDatePicker"
      @confirm="(d) => { payDate = fmtCalendarDate(d); showDatePicker = false }"
      @close="showDatePicker = false"
      :min-date="new Date(Date.now() - 180 * 86400000)"
      :max-date="new Date()"
    />
  </div>
</template>

<style scoped>
.collect__tenant {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f5f6f7;
  cursor: pointer;
}
.collect__tenant:last-child {
  border-bottom: none;
}
.collect__tname {
  font-size: 15px;
  color: #323233;
}
.collect__tsub {
  font-size: 12px;
  color: #969799;
  margin-top: 2px;
}
.collect__period {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #646566;
  margin-bottom: 10px;
  cursor: pointer;
}
.collect__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f5f6f7;
}
.collect__item-name {
  font-size: 14px;
  color: #323233;
}
.collect__item-detail {
  font-size: 11px;
  color: #969799;
  margin-top: 2px;
}
.collect__item-side {
  display: flex;
  align-items: center;
  gap: 8px;
}
.collect__add {
  padding: 10px 0;
}
.collect__total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0 4px;
  border-top: 1px solid #ebedf0;
  margin-top: 6px;
  font-size: 14px;
}
.collect__total small {
  font-size: 12px;
}
.collect__duedate {
  font-size: 12px;
  color: #969799;
  margin-bottom: 8px;
}
.collect__paid-title {
  font-size: 13px;
  color: #646566;
  margin-bottom: 6px;
}
.collect__paid-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 6px 0;
  color: #323233;
}
.collect__paid-sum {
  font-size: 13px;
  padding: 8px 0;
  background: #f7f8fa;
  border-radius: 8px;
  text-align: center;
  margin-bottom: 10px;
}
.collect__done {
  height: 80vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.collect__done-title {
  font-size: 22px;
  font-weight: 700;
  margin-top: 16px;
}
.collect__done-sub {
  font-size: 13px;
  color: #969799;
  margin-top: 6px;
}
</style>
