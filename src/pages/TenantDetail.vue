<script setup>
/**
 * 租客详情：资料卡 + 历史账单时间线（可展开看明细/收款/抄表照片）。
 */
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import dayjs from 'dayjs'
import repo from '@/db/repo'
import { useDataStore, billView, tenantDebt } from '@/stores/data'
import { STATUS_META } from '@/db/billing'
import { formatFen } from '@/utils/money'
import { today, daysBetween } from '@/utils/dates'
import TenantForm from '@/components/TenantForm.vue'

const route = useRoute()
const router = useRouter()
const data = useDataStore()

const tStr = today()
const tenant = computed(() => data.tenantsById[route.params.id])
const buildingName = computed(() => data.buildingsById[tenant.value?.buildingId]?.name || '')

const bills = computed(() =>
  data.bills
    .filter((b) => b.tenantId === tenant.value?.id)
    .map((b) => billView(b, data.paidByBill, tStr))
    .sort((a, b) => (a.period < b.period ? 1 : -1))
)

const debt = computed(() => tenantDebt(tenant.value?.id, data.bills, data.paidByBill, tStr))
const expandBill = ref(null)
const showEdit = ref(false)
const thumbs = ref({}) // `${billId}:${utility}` -> 缩略图 dataURL

// 展开账单时，从抄表记录里带出表照片缩略图
watch(
  expandBill,
  async (billId) => {
    if (!billId || !tenant.value) return
    const rows = await repo.listReadingsByTenant(tenant.value.id)
    const next = {}
    for (const r of rows) {
      if (r.billId === billId && r.thumb) next[`${billId}:${r.utility}`] = r.thumb
    }
    thumbs.value = { ...thumbs.value, ...next }
  }
)

function paymentsOf(billId) {
  return data.payments.filter((p) => p.billId === billId)
}

function readingsOf(bill) {
  // 从账单项里带出抄表明细（含缩略图）
  return (bill.items || []).filter((i) => i.type === 'electric' || i.type === 'water')
}

function utilLabel(t) {
  return t === 'electric' ? '⚡ 电' : '💧 水'
}

async function markLeft() {
  const t = tenant.value
  if (!t) return
  try {
    await showConfirmDialog({
      title: '确认退租？',
      message: `${t.name} 标记为已退租后不再出现在收租列表，但历史账单永久保留。`,
    })
  } catch {
    return
  }
  await repo.markTenantLeft(t.id)
  showToast('已标记退租')
}

async function markActive() {
  const t = tenant.value
  if (!t) return
  await repo.markTenantActive(t.id)
  showToast('已恢复在租')
}

function goCollect() {
  router.push({ name: 'collect', params: { tenantId: tenant.value.id } })
}

function previewThumb(dataUrl) {
  // 简易大图预览
  const overlay = document.createElement('div')
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;'
  const img = document.createElement('img')
  img.src = dataUrl
  img.style.cssText = 'max-width:96vw;max-height:96vh;'
  overlay.appendChild(img)
  overlay.addEventListener('click', () => overlay.remove())
  document.body.appendChild(overlay)
}
</script>

<template>
  <div class="fdb-page td" v-if="tenant">
    <van-nav-bar :title="tenant.name" left-arrow @click-left="router.back()" />

    <!-- 资料卡 -->
    <div class="fdb-card">
      <div class="td__head">
        <div>
          <div class="td__name">
            {{ tenant.room ? tenant.room + ' · ' : '' }}{{ tenant.name }}
            <span v-if="tenant.status === 'left'" class="fdb-tag fdb-tag--pending">已退租</span>
            <span v-else-if="debt > 0" class="fdb-tag fdb-tag--overdue">欠款中</span>
            <span v-else class="fdb-tag fdb-tag--paid">不欠款</span>
          </div>
          <div class="td__sub">
            {{ buildingName || '未分组' }} · 月租 {{ formatFen(tenant.monthlyRent, { comma: true }) }} 元 · 每月{{ tenant.rentDay }}号收租
          </div>
          <div class="td__sub" v-if="tenant.phone">📞 {{ tenant.phone }}</div>
        </div>
        <div class="td__debt" v-if="debt > 0">
          <div class="fdb-money fdb-money--danger fdb-money--lg">{{ formatFen(debt, { comma: true }) }}</div>
          <div class="td__debt-label">当前欠款（元）</div>
        </div>
      </div>

      <div class="td__tags">
        <span v-if="tenant.deposit" class="td__tag">押金 {{ formatFen(tenant.deposit) }}</span>
        <span v-if="tenant.electric?.mode === 'metered'" class="td__tag">电 {{ (tenant.electric.price / 100).toFixed(2) }} 元/度</span>
        <span v-else-if="tenant.electric?.mode === 'flat'" class="td__tag">电包干 {{ formatFen(tenant.electric.flatAmount) }}/月</span>
        <span v-if="tenant.water?.mode === 'metered'" class="td__tag">水 {{ (tenant.water.price / 100).toFixed(2) }} 元/吨</span>
        <span v-else-if="tenant.water?.mode === 'flat'" class="td__tag">水包干 {{ formatFen(tenant.water.flatAmount) }}/月</span>
        <span v-if="tenant.internet" class="td__tag">网费 {{ formatFen(tenant.internet) }}/月</span>
      </div>
      <div class="td__note" v-if="tenant.note">📝 {{ tenant.note }}</div>

      <div class="td__actions">
        <van-button size="small" round type="primary" icon="gold-coin-o" @click="goCollect">收租</van-button>
        <van-button size="small" round plain icon="edit" @click="showEdit = true">编辑</van-button>
        <van-button v-if="tenant.status === 'active'" size="small" round plain type="danger" @click="markLeft">退租</van-button>
        <van-button v-else size="small" round plain type="primary" @click="markActive">恢复在租</van-button>
      </div>
    </div>

    <!-- 账单时间线 -->
    <div class="fdb-card" v-if="bills.length">
      <div class="fdb-card-title">
        <span>历史账单（{{ bills.length }} 期）</span>
      </div>
      <div class="td__bill" v-for="b in bills" :key="b.id">
        <div class="td__bill-head" @click="expandBill = expandBill === b.id ? null : b.id">
          <div>
            <span class="td__period">{{ b.period }}</span>
            <span class="fdb-tag" :class="STATUS_META[b.status].cls">{{ STATUS_META[b.status].label }}</span>
            <span v-if="b.status === 'overdue'" class="td__od">逾期 {{ Math.max(0, daysBetween(tStr, b.dueDate)) }} 天</span>
          </div>
          <div class="td__bill-money">
            <span class="fdb-money">{{ formatFen(b.total, { comma: true }) }}</span>
            <van-icon :name="expandBill === b.id ? 'arrow-up' : 'arrow-down'" color="#c8c9cc" />
          </div>
        </div>

        <div v-if="expandBill === b.id" class="td__bill-body">
          <div class="td__line" v-for="(i, idx) in b.items" :key="idx">
            <span>{{ i.name }}</span>
            <span :style="{ color: i.amount < 0 ? '#07c160' : '' }">{{ formatFen(i.amount) }}</span>
          </div>
          <div class="td__line td__line--sum">
            <span>合计</span>
            <span class="fdb-money">{{ formatFen(b.total) }}</span>
          </div>
          <div class="td__line" v-if="b.paid > 0">
            <span>已收</span>
            <span style="color: #07c160">{{ formatFen(b.paid) }}（{{ paymentsOf(b.id).length }} 笔）</span>
          </div>
          <div class="td__line" v-if="b.remaining > 0">
            <span>未收</span>
            <span style="color: #ff8c42">{{ formatFen(b.remaining) }}</span>
          </div>

          <!-- 收款记录 -->
          <div v-for="p in paymentsOf(b.id)" :key="p.id" class="td__pay">
            <span>💵 {{ p.paidDate }} · {{ p.method }}</span>
            <span class="fdb-money fdb-money--success">{{ formatFen(p.amount) }}</span>
          </div>

          <!-- 抄表照片 -->
          <div class="td__photos">
            <div v-for="r in readingsOf(b)" :key="r.type" class="td__photo-item">
              <img
                v-if="thumbs[`${b.id}:${r.type}`]"
                :src="thumbs[`${b.id}:${r.type}`]"
                alt="表的照片"
                @click="previewThumb(thumbs[`${b.id}:${r.type}`])"
              />
              <div class="td__photo-label">
                {{ utilLabel(r.type) }}：{{ r.detail?.prev ?? '?' }} → {{ r.detail?.cur ?? '?' }}
                <template v-if="r.detail?.usage != null">（用量 {{ r.detail.usage }}）</template>
              </div>
            </div>
          </div>

          <div class="td__note" v-if="b.note">📝 {{ b.note }}</div>

          <van-button size="small" round plain type="primary" block style="margin-top: 8px" @click="goCollect">
            {{ b.status === 'paid' ? '补记 / 修改' : '继续收这期' }}
          </van-button>
        </div>
      </div>
    </div>
    <div class="fdb-card" v-else>
      <div class="fdb-empty">还没有账单，点上面"收租"开始第一期</div>
    </div>
    <div style="height: 24px"></div>

    <TenantForm v-model:show="showEdit" :tenant="tenant" />
  </div>
  <div v-else class="fdb-page">
    <van-nav-bar title="租客" left-arrow @click-left="router.back()" />
    <div class="fdb-empty">租客不存在或已删除</div>
  </div>
</template>

<style scoped>
.td__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.td__name {
  font-size: 17px;
  font-weight: 700;
  color: #323233;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.td__sub {
  font-size: 12px;
  color: #969799;
  margin-top: 4px;
}
.td__debt {
  text-align: right;
  flex-shrink: 0;
}
.td__debt-label {
  font-size: 11px;
  color: #969799;
}
.td__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.td__tag {
  font-size: 11px;
  background: #f0faf8;
  color: #0f766e;
  border-radius: 4px;
  padding: 3px 6px;
}
.td__note {
  font-size: 12px;
  color: #969799;
  margin-top: 8px;
}
.td__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.td__bill {
  border-bottom: 1px solid #f5f6f7;
  padding: 10px 0;
}
.td__bill:last-child {
  border-bottom: none;
}
.td__bill-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}
.td__period {
  font-size: 14px;
  font-weight: 600;
  margin-right: 6px;
}
.td__od {
  font-size: 11px;
  color: #ee0a24;
  margin-left: 6px;
}
.td__bill-money {
  display: flex;
  align-items: center;
  gap: 6px;
}
.td__bill-body {
  margin-top: 8px;
  background: #fafafa;
  border-radius: 8px;
  padding: 10px;
}
.td__line {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #323233;
  padding: 3px 0;
}
.td__line--sum {
  border-top: 1px dashed #e5e6e8;
  margin-top: 4px;
  padding-top: 6px;
}
.td__pay {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #646566;
  padding: 3px 0;
}
.td__photos {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.td__photo-item {
  width: 48%;
}
.td__photo-item img {
  width: 100%;
  border-radius: 6px;
  display: block;
  background: #f0f0f0;
  min-height: 60px;
}
.td__photo-label {
  font-size: 11px;
  color: #969799;
  margin-top: 3px;
}
</style>
