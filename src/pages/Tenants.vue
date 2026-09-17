<script setup>
/**
 * 租客列表：按楼栋分组，显示月租、收租日、欠款。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { useSessionStore } from '@/stores/session'
import { useDataStore, tenantDebt, inScope, billView } from '@/stores/data'
import { formatFen } from '@/utils/money'
import { today, periodOf } from '@/utils/dates'
import TenantForm from '@/components/TenantForm.vue'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const search = ref('')
const showForm = ref(false)
const showLeft = ref(false)

const tStr = today()

const list = computed(() => {
  const kw = search.value.trim()
  return data.tenants
    .filter((t) => inScope(t, session))
    .filter((t) => (showLeft.value ? true : t.status === 'active'))
    .filter((t) => !kw || t.name.includes(kw) || (t.room || '').includes(kw) || (t.phone || '').includes(kw))
})

const groups = computed(() => {
  const map = new Map()
  for (const t of list.value) {
    const bName = data.buildingsById[t.buildingId]?.name || '未分组'
    if (!map.has(bName)) map.set(bName, [])
    map.get(bName).push(t)
  }
  return Array.from(map.entries()).map(([name, tenants]) => ({ name, tenants }))
})

function debtOf(t) {
  return tenantDebt(t.id, data.bills, data.paidByBill, tStr)
}

/** 本月账单是否已全部结清 */
function monthSettled(t) {
  const period = periodOf()
  const bills = data.bills.filter((b) => b.tenantId === t.id && b.period === period)
  return bills.length > 0 && bills.every((b) => billView(b, data.paidByBill, tStr).status === 'paid')
}

/** 距下次收租日还有几天（0=今天，收租日按月末钳位） */
function rentDaysAway(t) {
  const now = dayjs()
  const todayD = now.date()
  const thisLen = now.daysInMonth()
  const rd = Math.min(t.rentDay || 1, thisLen)
  let diff = rd - todayD
  if (diff < 0) {
    const nextLen = now.add(1, 'month').daysInMonth()
    diff = thisLen - todayD + Math.min(t.rentDay || 1, nextLen)
  }
  return diff
}

/**
 * 右侧状态标语：有欠款只显金额；无欠款时区分
 * "本月已收 / 今天收租 / 明天 / N天后 / 每月N号"，不再笼统显示"不欠"。
 */
function badgeOf(t) {
  if (t.status !== 'active') return null
  if (debtOf(t) > 0) return null
  if (monthSettled(t)) return { text: '本月已收', cls: 'ok' }
  const d = rentDaysAway(t)
  if (d === 0) return { text: '今天收租', cls: 'today' }
  if (d === 1) return { text: '明天收租', cls: 'soon' }
  if (d <= 3) return { text: `${d}天后收租`, cls: 'soon' }
  const clamped = Math.min(t.rentDay || 1, dayjs().daysInMonth())
  return { text: `每月${clamped}号收租`, cls: 'plain' }
}

function utilSummary(t) {
  const parts = []
  if (t.electric?.mode === 'metered') parts.push(`电 ${(t.electric.price / 100).toFixed(2)}元/度`)
  else if (t.electric?.mode === 'flat') parts.push(`电包干 ${(t.electric.flatAmount / 100).toFixed(0)}元`)
  if (t.water?.mode === 'metered') parts.push(`水 ${(t.water.price / 100).toFixed(2)}元/吨`)
  else if (t.water?.mode === 'flat') parts.push(`水包干 ${(t.water.flatAmount / 100).toFixed(0)}元`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="fdb-page tenants">
    <van-nav-bar title="租客">
      <template #right>
        <van-icon name="plus" size="20" color="#0f766e" @click="showForm = true" />
      </template>
    </van-nav-bar>

    <van-search v-model="search" placeholder="搜索姓名 / 房号 / 电话" />
    <div class="tenants__toggle">
      <van-checkbox v-model="showLeft" shape="square" icon-size="14px">显示已退租</van-checkbox>
    </div>

    <div class="fdb-card" v-for="g in groups" :key="g.name">
      <div class="fdb-card-title">
        <span>🏢 {{ g.name }}</span>
        <span class="tenants__count">{{ g.tenants.length }} 户</span>
      </div>
      <div
        class="tenants__row"
        v-for="t in g.tenants"
        :key="t.id"
        @click="router.push({ name: 'tenant', params: { id: t.id } })"
      >
        <div class="tenants__main">
          <div class="tenants__name">
            {{ t.room ? t.room + ' · ' : '' }}{{ t.name }}
            <span v-if="t.status === 'left'" class="fdb-tag fdb-tag--pending">已退租</span>
          </div>
          <div class="tenants__sub">
            月租 {{ formatFen(t.monthlyRent, { comma: true }) }} · 每月{{ t.rentDay }}号
            <template v-if="utilSummary(t)"> · {{ utilSummary(t) }}</template>
          </div>
        </div>
        <div class="tenants__side">
          <template v-if="debtOf(t) > 0">
            <div class="fdb-money fdb-money--danger">{{ formatFen(debtOf(t), { comma: true }) }}</div>
          </template>
          <span v-else-if="badgeOf(t)" :class="['tenants__badge', `tenants__badge--${badgeOf(t).cls}`]">
            {{ badgeOf(t).text }}
          </span>
          <van-icon name="arrow" color="#c8c9cc" />
        </div>
      </div>
    </div>

    <div class="fdb-card" v-if="!groups.length">
      <div class="fdb-empty">
        {{ list.length === 0 && !search ? '还没有租客，点右上角 + 添加' : '没有匹配的租客' }}
      </div>
    </div>
    <div style="height: 24px"></div>

    <TenantForm v-model:show="showForm" :tenant="null" />
  </div>
</template>

<style scoped>
.tenants__toggle {
  padding: 0 16px 8px;
  font-size: 12px;
  color: #969799;
}
.tenants__count {
  font-size: 12px;
  color: #969799;
  font-weight: 400;
}
.tenants__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f5f6f7;
  cursor: pointer;
}
.tenants__row:last-child {
  border-bottom: none;
}
.tenants__name {
  font-size: 15px;
  color: #323233;
}
.tenants__sub {
  font-size: 12px;
  color: #969799;
  margin-top: 3px;
}
.tenants__side {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.tenants__badge {
  font-size: 11px;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.tenants__badge--today {
  color: #fff;
  background: var(--fdb-primary);
  font-weight: 600;
}
.tenants__badge--soon {
  color: #b26205;
  background: #fff3e0;
}
.tenants__badge--ok {
  color: #07c160;
  background: #e8f8ef;
}
.tenants__badge--plain {
  color: #898781;
  background: #f2f3f5;
}
</style>
