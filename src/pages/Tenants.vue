<script setup>
/**
 * 租客列表：按楼栋分组，显示月租、收租日、欠款。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useDataStore, tenantDebt, inScope } from '@/stores/data'
import { formatFen } from '@/utils/money'
import { today } from '@/utils/dates'
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
          <div v-if="debtOf(t) > 0" class="fdb-money fdb-money--danger">{{ formatFen(debtOf(t), { comma: true }) }}</div>
          <div v-else-if="t.status === 'active'" style="color: #07c160; font-size: 12px">✔ 不欠</div>
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
</style>
