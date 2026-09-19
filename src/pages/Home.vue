<script setup>
/**
 * 首页·今日待办：打开即见"今天该收谁的租、谁逾期了、本月收了多少"。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import dayjs from 'dayjs'
import { useSessionStore } from '@/stores/session'
import {
  useDataStore,
  billView,
  inScope,
  dueTodayList,
  upcomingWithinDays,
  overdueBills,
  overdueUnbilledRent,
} from '@/stores/data'
import { formatFen } from '@/utils/money'
import { today, daysBetween, periodOf } from '@/utils/dates'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const refreshing = ref(false)

const tStr = today()
const overdue = computed(() => overdueBills(data.bills, data.paidByBill, session, tStr))
const overdueUnbilled = computed(() => overdueUnbilledRent(data.tenants, data.bills, session, tStr))
const dueToday = computed(() => dueTodayList(data.tenants, data.bills, data.paidByBill, session, tStr))
const upcoming = computed(() => upcomingWithinDays(data.tenants, session, 7))

/** 没建账单时的预估金额：房租+网费+包干项 */
function estimate(t) {
  let sum = t.monthlyRent || 0
  if ((t.internet || 0) > 0) sum += t.internet
  for (const u of ['electric', 'water']) {
    if (t[u]?.mode === 'flat') sum += t[u].flatAmount || 0
  }
  return sum
}

function tenantName(id) {
  return data.tenantsById[id]?.name || '租客'
}

function roomLabel(t) {
  return t.room ? `${t.room} · ` : ''
}

function overdueDays(b) {
  return Math.max(0, daysBetween(tStr, b.dueDate))
}

// 本月概览
const monthStat = computed(() => {
  const period = periodOf()
  let receivable = 0
  let received = 0
  let count = 0
  for (const b of data.bills) {
    if (b.period !== period || !inScope(b, session)) continue
    const v = billView(b, data.paidByBill, tStr)
    receivable += v.total
    received += v.paid
    count++
  }
  return { receivable, received, unpaid: receivable - received, count }
})

// 查看范围切换（管理员）：我的 / 全部 / 各用户
const viewingOptions = computed(() => {
  if (!session.isAdmin) return []
  const opts = [{ text: `我的（${session.current?.name || ''}）`, value: 'self' }, { text: '全部', value: 'all' }]
  for (const l of data.landlords) {
    if (l.id !== session.current?.id) opts.push({ text: l.name, value: l.id })
  }
  return opts
})
const viewingValue = ref('self')
function onViewingChange(v) {
  session.setViewing(v)
}

async function onRefresh() {
  refreshing.value = true
  try {
    await session.backgroundSync()
    await data.reload()
  } finally {
    refreshing.value = false
  }
}

function goCollect(tenantId) {
  router.push({ name: 'collect', params: { tenantId: tenantId || '' } })
}

/** 近7天列表：今天的一键去收租，其余看租客详情 */
function onUpcomingClick(u) {
  if (u.inDays === 0) goCollect(u.tenant.id)
  else router.push({ name: 'tenant', params: { id: u.tenant.id } })
}
</script>

<template>
  <div class="fdb-page home">
    <!-- 顶栏 -->
    <van-sticky>
      <div class="home__header">
        <div class="home__title">房东宝</div>
        <div class="home__actions">
          <span v-if="session.pendingSync > 0" class="home__sync" @click="onRefresh">
            <van-icon name="replay" /> 待同步 {{ session.pendingSync }}
          </span>
          <van-dropdown-menu v-if="session.isAdmin" :active-color="'var(--fdb-primary)'" class="home__dropdown">
            <van-dropdown-item v-model="viewingValue" :options="viewingOptions" @change="onViewingChange" />
          </van-dropdown-menu>
          <span v-else class="home__viewing">{{ session.current?.name }}</span>
        </div>
      </div>
    </van-sticky>

    <van-notice-bar v-if="session.lastError" left-icon="info-o" :text="session.lastError" />

    <van-pull-refresh :model-value="refreshing" @refresh="onRefresh" success-text="已刷新">
      <!-- 逾期未收 -->
      <div class="fdb-card home__overdue" v-if="overdue.length">
        <div class="fdb-card-title">
          <span><van-icon name="warning-o" color="#ee0a24" /> 逾期未收清</span>
          <span class="fdb-money fdb-money--danger">{{ formatFen(overdue.reduce((s, b) => s + b.remaining, 0), { comma: true }) }} 元</span>
        </div>
        <div
          class="home__row home__row--danger"
          v-for="b in overdue.slice(0, 8)"
          :key="b.id"
          @click="router.push({ name: 'tenant', params: { id: b.tenantId } })"
        >
          <div class="home__row-main">
            <div>{{ tenantName(b.tenantId) }} · {{ b.period }}</div>
            <div class="home__row-sub">已逾期 {{ overdueDays(b) }} 天</div>
          </div>
          <div class="fdb-money fdb-money--danger">欠 {{ formatFen(b.remaining, { comma: true }) }}</div>
        </div>
        <div class="home__more" v-if="overdue.length > 8" @click="router.push({ name: 'stats' })">
          还有 {{ overdue.length - 8 }} 笔，去统计页看全部
        </div>
      </div>

      <!-- 已过收租日、还没建账（漏收预警） -->
      <div class="fdb-card home__overdue" v-if="overdueUnbilled.length">
        <div class="fdb-card-title">
          <span><van-icon name="underway-o" color="#ff8c42" /> 已过收租日，还没抄表建账</span>
        </div>
        <div
          class="home__row home__row--warn"
          v-for="u in overdueUnbilled.slice(0, 8)"
          :key="u.tenant.id"
          @click="goCollect(u.tenant.id)"
        >
          <div class="home__row-main">
            <div>{{ roomLabel(u.tenant) }}{{ u.tenant.name }}</div>
            <div class="home__row-sub">每月{{ u.tenant.rentDay }}号收租，已过 {{ u.overdueDays }} 天</div>
          </div>
          <van-button size="small" type="warning" round style="margin-top: 0">去补收</van-button>
        </div>
        <div class="home__more" v-if="overdueUnbilled.length > 8">
          还有 {{ overdueUnbilled.length - 8 }} 户
        </div>
      </div>

      <!-- 今日待收 -->
      <div class="fdb-card" v-if="dueToday.length">
        <div class="fdb-card-title">
          <span><van-icon name="clock-o" color="#0f766e" /> 今天该收租</span>
        </div>
        <div class="home__row" v-for="d in dueToday" :key="d.tenant.id" @click="goCollect(d.tenant.id)">
          <div class="home__row-main">
            <div>{{ roomLabel(d.tenant) }}{{ d.tenant.name }}</div>
            <div class="home__row-sub">
              {{ d.bill ? '本期账单已建，尚未收齐' : '本期还没抄表建账' }}
            </div>
          </div>
          <div style="text-align: right">
            <div class="fdb-money">{{ formatFen(d.bill ? d.bill.total : estimate(d.tenant), { comma: true }) }}</div>
            <van-button size="small" type="primary" round style="margin-top: 4px">去收租</van-button>
          </div>
        </div>
      </div>

      <!-- 近 7 日收租日 -->
      <div class="fdb-card" v-if="upcoming.length">
        <div class="fdb-card-title">
          <span><van-icon name="calendar-o" /> 近 7 天收租日</span>
        </div>
        <div
          :class="['home__row', { 'home__row--today': u.inDays === 0 }]"
          v-for="u in upcoming"
          :key="u.tenant.id"
          @click="onUpcomingClick(u)"
        >
          <div class="home__row-main">
            <div>{{ roomLabel(u.tenant) }}{{ u.tenant.name }}</div>
          </div>
          <span v-if="u.inDays === 0" class="home__today-text">今天</span>
          <div v-else class="home__soon">{{ u.inDays === 1 ? '明天' : `${u.inDays} 天后` }}（每月{{ u.tenant.rentDay }}号）</div>
        </div>
      </div>

      <!-- 本月概览 -->
      <div class="fdb-card">
        <div class="fdb-card-title">
          <span>{{ dayjs().format('YYYY年M月') }} 收租概览</span>
        </div>
        <div class="home__stat" v-if="monthStat.count">
          <div class="home__stat-item">
            <div class="home__stat-num">{{ formatFen(monthStat.receivable, { comma: true }) }}</div>
            <div class="home__stat-label">应收（元）</div>
          </div>
          <div class="home__stat-item">
            <div class="home__stat-num" style="color: var(--fdb-success)">{{ formatFen(monthStat.received, { comma: true }) }}</div>
            <div class="home__stat-label">已收（元）</div>
          </div>
          <div class="home__stat-item">
            <div class="home__stat-num" :style="{ color: monthStat.unpaid > 0 ? '#ff8c42' : '#969799' }">
              {{ formatFen(monthStat.unpaid, { comma: true }) }}
            </div>
            <div class="home__stat-label">未收（元）</div>
          </div>
        </div>
        <van-progress
          v-if="monthStat.receivable > 0"
          :percentage="Math.min(100, Math.round((monthStat.received / monthStat.receivable) * 100))"
          color="#0f766e"
          stroke-width="8"
          style="margin-top: 12px"
        />
        <div v-else class="fdb-empty">本月还没有账单，点下面"开始收租"</div>
      </div>

      <div style="height: 72px"></div>
    </van-pull-refresh>

    <!-- 开始收租大按钮 -->
    <div class="home__fab">
      <van-button round block type="primary" size="large" icon="edit" @click="goCollect()">
        开始收租
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.home__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.home__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--fdb-primary);
}
.home__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.home__sync {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b6b6b;
  background: #f2f3f5;
  border-radius: 999px;
  padding: 5px 10px;
  cursor: pointer;
}
.home__sync .van-icon {
  vertical-align: middle;
}
.home__viewing {
  font-size: 13px;
  color: #323233;
  background: #f2f3f5;
  border-radius: 999px;
  padding: 5px 12px;
}
.home__dropdown {
  height: 30px;
  border-radius: 999px;
  box-shadow: none;
  background: #f2f3f5;
  border: 1px solid #ebedf0;
  overflow: hidden;
}
/* 去掉 Vant 自带的下拉小箭头（它挤在文字右侧导致视觉偏移），让标题真正居中 */
.home__dropdown :deep(.van-dropdown-menu__title) {
  padding: 0 12px;
  font-size: 13px;
  color: #323233;
}
.home__dropdown :deep(.van-dropdown-menu__title::after) {
  display: none;
}
.home__dropdown :deep(.van-dropdown-menu__item) {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.home__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f5f6f7;
  cursor: pointer;
}
.home__row:last-child {
  border-bottom: none;
}
.home__row--danger .home__row-main > div:first-child {
  color: #323233;
}
.home__row-main {
  font-size: 14px;
  color: #323233;
}
.home__row-sub {
  font-size: 12px;
  color: #969799;
  margin-top: 2px;
}
.home__overdue {
  border: 1px solid #ffe0e0;
}
.home__more {
  padding-top: 8px;
  font-size: 12px;
  color: var(--fdb-primary);
  cursor: pointer;
}
.home__soon {
  font-size: 12px;
  color: #969799;
}
.home__row--today {
  background: #eef6f4;
  border-radius: 8px;
  padding-left: 8px;
  padding-right: 8px;
}
/* 今天的标识：纯文字着色（不做胶囊，避免像按钮诱导点击） */
.home__today-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--fdb-primary);
}
.home__row--warn {
  cursor: pointer;
}
.home__stat {
  display: flex;
  text-align: center;
}
.home__stat-item {
  flex: 1;
}
.home__stat-num {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.home__stat-label {
  font-size: 11px;
  color: #969799;
  margin-top: 2px;
}
.home__fab {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(66px + env(safe-area-inset-bottom));
}
</style>
