<script setup>
/**
 * 统计：按月/按季度/按年三种范围——KPI + 实收柱状图（按月视图看每日）+
 * 科目构成堆积图 + 楼栋汇总表 + 明细导出。配色为无障碍验证过的调色板（CVD 安全）。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { showToast } from 'vant'
import dayjs from 'dayjs'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useSessionStore } from '@/stores/session'
import { useDataStore, billView, inScope } from '@/stores/data'
import { STATUS_META } from '@/db/billing'
import { formatFen } from '@/utils/money'

echarts.use([BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer])

// 验证过的分类色（浅色表面，邻对 CVD ΔE≥9）
const C = { rent: '#2a78d6', electric: '#eb6834', water: '#1baf7a', internet: '#eda100', misc: '#e87ba4' }
const INK_MUTED = '#898781'
const INK_SECONDARY = '#52514e'
const GRID_LINE = '#e1e0d9'

const session = useSessionStore()
const data = useDataStore()

// ===== 统计范围：按月 / 按季度 / 按年 =====
const PTYPES = [
  { value: 'month', label: '按月' },
  { value: 'quarter', label: '按季度' },
  { value: 'year', label: '按年' },
]
const ptype = ref('year')
const year = ref(Number(dayjs().format('YYYY')))
const quarter = ref(Math.floor(dayjs().month() / 3) + 1)
const month = ref(dayjs().month() + 1)

const yearOptions = computed(() => {
  const ys = []
  for (const b of data.bills) {
    const y = Number(String(b.period).slice(0, 4))
    if (y && !ys.includes(y)) ys.push(y)
  }
  const cur = Number(dayjs().format('YYYY'))
  if (!ys.includes(cur)) ys.push(cur)
  return ys.sort((a, b) => b - a).map((y) => ({ text: `${y} 年`, value: y }))
})
const quarterOptions = [1, 2, 3, 4].map((q) => ({ text: `${'一二三四'[q - 1]}季度`, value: q }))
const monthOptions = Array.from({ length: 12 }, (_, i) => ({ text: `${i + 1}月`, value: i + 1 }))

const showRangePicker = ref(false)
// 多列选择器（数组的数组）：按范围类型给 1~2 列
const rangeColumns = computed(() => {
  if (ptype.value === 'quarter') return [yearOptions.value, quarterOptions]
  if (ptype.value === 'month') return [yearOptions.value, monthOptions]
  return [yearOptions.value]
})
const rangeValue = computed(() => {
  if (ptype.value === 'quarter') return [year.value, quarter.value]
  if (ptype.value === 'month') return [year.value, month.value]
  return [year.value]
})
function onRangeConfirm({ selectedValues }) {
  year.value = Number(selectedValues[0])
  if (ptype.value === 'quarter') quarter.value = Number(selectedValues[1])
  if (ptype.value === 'month') month.value = Number(selectedValues[1])
  showRangePicker.value = false
}

// 所选时间段覆盖的月份（1~12），所有统计都从它推导
const unitMonths = computed(() => {
  if (ptype.value === 'year') return Array.from({ length: 12 }, (_, i) => i + 1)
  if (ptype.value === 'quarter') return [(quarter.value - 1) * 3 + 1, (quarter.value - 1) * 3 + 2, quarter.value * 3]
  return [month.value]
})
const unitPrefixes = computed(() => unitMonths.value.map((m) => `${year.value}-${String(m).padStart(2, '0')}`))
const inUnitPeriod = (p) => unitPrefixes.value.includes(String(p))
const inUnitDate = (d) => unitPrefixes.value.some((p) => String(d).startsWith(p))
const unitLabel = computed(() => {
  if (ptype.value === 'quarter') return `${year.value} 年 ${'一二三四'[quarter.value - 1]}季度`
  if (ptype.value === 'month') return `${year.value} 年 ${month.value} 月`
  return `${year.value} 年`
})
// 导出文件名用（不带空格）
const unitFileTag = computed(() => {
  if (ptype.value === 'quarter') return `${year.value}年${quarter.value}季度`
  if (ptype.value === 'month') return `${year.value}年${month.value}月`
  return `${year.value}年`
})

// ===== 数据推导 =====
const scopedBills = computed(() => data.bills.filter((b) => inScope(b, session)))

const kpi = computed(() => {
  let receivable = 0
  let overdueCount = 0
  for (const b of scopedBills.value) {
    if (!inUnitPeriod(b.period)) continue
    receivable += b.total || 0
  }
  let received = 0
  for (const p of data.payments) {
    if (!inUnitDate(p.paidDate)) continue
    const bill = data.bills.find((b) => b.id === p.billId)
    if (bill && inScope(bill, session)) received += p.amount || 0
  }
  const t = dayjs().format('YYYY-MM-DD')
  for (const b of scopedBills.value) {
    if (!inUnitPeriod(b.period)) continue
    if (billView(b, data.paidByBill, t).status === 'overdue') overdueCount++
  }
  const rate = receivable > 0 ? Math.round((received / receivable) * 100) : null
  return { receivable, received, rate, overdueCount }
})

// 实收柱状图（按收款日期）：按年/季度看各月，按月看每天
const barData = computed(() => {
  if (ptype.value === 'month') {
    const ym = `${year.value}-${String(month.value).padStart(2, '0')}`
    const days = dayjs(`${ym}-01`).daysInMonth()
    const values = new Array(days).fill(0)
    for (const p of data.payments) {
      const ds = String(p.paidDate)
      if (!ds.startsWith(ym)) continue
      const bill = data.bills.find((b) => b.id === p.billId)
      if (bill && inScope(bill, session)) values[Number(ds.slice(8, 10)) - 1] += p.amount || 0
    }
    return { labels: values.map((_, i) => `${i + 1}日`), values }
  }
  const values = unitMonths.value.map(() => 0)
  for (const p of data.payments) {
    if (!inUnitDate(p.paidDate)) continue
    const bill = data.bills.find((b) => b.id === p.billId)
    if (bill && inScope(bill, session)) values[unitPrefixes.value.indexOf(String(p.paidDate).slice(0, 7))] += p.amount || 0
  }
  return { labels: unitMonths.value.map((m) => `${m}月`), values }
})

// 月度科目构成（按账单期号；杂费/减免归"杂费"）
const CATS = [
  { key: 'rent', name: '房租', color: C.rent },
  { key: 'electric', name: '电费', color: C.electric },
  { key: 'water', name: '水费', color: C.water },
  { key: 'internet', name: '网费', color: C.internet },
  { key: 'misc', name: '杂费/减免', color: C.misc },
]
// 科目构成堆积图（按账单期号归到各月；按月视图就是当月一根柱）
const stackData = computed(() => {
  const labels = ptype.value === 'month' ? [`${month.value}月`] : unitMonths.value.map((m) => `${m}月`)
  const series = Object.fromEntries(CATS.map((c) => [c.key, labels.map(() => 0)]))
  for (const b of scopedBills.value) {
    if (!inUnitPeriod(b.period)) continue
    const idx = ptype.value === 'month' ? 0 : unitPrefixes.value.indexOf(String(b.period))
    if (idx < 0) continue
    for (const item of b.items || []) {
      const key = CATS.some((c) => c.key === item.type) ? item.type : 'misc'
      series[key][idx] += item.amount || 0
    }
  }
  return { labels, series }
})

// 楼栋汇总
const byBuilding = computed(() => {
  const map = new Map()
  for (const b of scopedBills.value) {
    if (!inUnitPeriod(b.period)) continue
    const t = data.tenantsById[b.tenantId]
    const bName = data.buildingsById[t?.buildingId]?.name || '未分组'
    if (!map.has(bName)) map.set(bName, { bills: 0, receivable: 0 })
    const row = map.get(bName)
    row.bills++
    row.receivable += b.total || 0
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.receivable - a.receivable)
})

// 年度账单明细表（同时满足图表的"表格视图"无障碍要求）
const billRows = computed(() => {
  const t = dayjs().format('YYYY-MM-DD')
  return scopedBills.value
    .filter((b) => inUnitPeriod(b.period))
    .map((b) => {
      const v = billView(b, data.paidByBill, t)
      const tn = data.tenantsById[b.tenantId]
      return {
        ...v,
        tenantName: b.tenantName || tn?.name || '?',
        buildingName: data.buildingsById[tn?.buildingId]?.name || '未分组',
      }
    })
    .sort((a, b) => (a.period < b.period ? 1 : -1))
})

// ===== 图表 =====
const barEl = ref(null)
const stackEl = ref(null)
let barChart = null
let stackChart = null

function renderCharts() {
  if (!barEl.value || !stackEl.value) return
  if (!barChart) barChart = echarts.init(barEl.value)
  if (!stackChart) stackChart = echarts.init(stackEl.value)

  barChart.setOption({
    grid: { left: 8, right: 8, top: 16, bottom: 22, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const p = ps[0]
        return `${p.name}<br/>实收 <b>${formatFen(p.value, { comma: true })}</b> 元`
      },
      textStyle: { color: INK_SECONDARY },
    },
    xAxis: {
      type: 'category',
      data: barData.value.labels,
      axisLabel: { color: INK_MUTED, fontSize: 10 },
      axisLine: { lineStyle: { color: GRID_LINE } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: INK_MUTED, fontSize: 10, formatter: (v) => (v / 100).toFixed(0) },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    series: [
      {
        name: '实收',
        type: 'bar',
        data: barData.value.values,
        barWidth: '46%',
        itemStyle: { color: C.rent, borderRadius: [4, 4, 0, 0] },
      },
    ],
  })

  stackChart.setOption({
    grid: { left: 8, right: 8, top: 30, bottom: 22, containLabel: true },
    legend: {
      top: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: INK_SECONDARY, fontSize: 10 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const lines = ps
          .filter((p) => p.value !== 0)
          .map((p) => `${p.marker}${p.seriesName} ${formatFen(p.value, { comma: true })} 元`)
        return `${ps[0].name}<br/>` + (lines.length ? lines.join('<br/>') : '无')
      },
      textStyle: { color: INK_SECONDARY },
    },
    xAxis: {
      type: 'category',
      data: stackData.value.labels,
      axisLabel: { color: INK_MUTED, fontSize: 10 },
      axisLine: { lineStyle: { color: GRID_LINE } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: INK_MUTED, fontSize: 10, formatter: (v) => (v / 100).toFixed(0) },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    series: CATS.map((c, i) => ({
      name: c.name,
      type: 'bar',
      stack: 'total',
      data: stackData.value.series[c.key],
      barWidth: '46%',
      itemStyle: {
        color: c.color,
        borderColor: '#ffffff',
        borderWidth: 2, // 段间表面色缝隙
        borderRadius: i === CATS.length - 1 ? [4, 4, 0, 0] : 0,
      },
    })),
  })
}

watch([ptype, year, quarter, month, () => data.bills, () => data.payments], () => nextTick(renderCharts), { deep: false })

onMounted(() => nextTick(renderCharts))
onBeforeUnmount(() => {
  barChart?.dispose()
  stackChart?.dispose()
})

// ===== CSV 导出（Excel 友好，带 BOM） =====
function exportCsv() {
  const rows = [
    ['期号', '租客', '楼栋', '应收(元)', '已收(元)', '未收(元)', '状态', '收租截止日'],
    ...billRows.value.map((r) => [
      r.period,
      r.tenantName,
      r.buildingName,
      (r.total / 100).toFixed(2),
      (r.paid / 100).toFixed(2),
      (r.remaining / 100).toFixed(2),
      STATUS_META[r.status].label,
      r.dueDate,
    ]),
  ]
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `房东宝_${unitFileTag.value}账单.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('表格已导出（在"下载"里找，可用 Excel 打开）')
}
</script>

<template>
  <div class="fdb-page stats">
    <van-nav-bar title="统计">
      <template #right>
        <span class="stats__year" @click="showRangePicker = true">{{ unitLabel }} ▾</span>
      </template>
    </van-nav-bar>

    <!-- KPI -->
    <div class="fdb-card">
      <div class="stats__kpi">
        <div class="stats__kpi-item">
          <div class="stats__kpi-num">{{ formatFen(kpi.receivable, { comma: true }) }}</div>
          <div class="stats__kpi-label">本期应收（元）</div>
        </div>
        <div class="stats__kpi-item">
          <div class="stats__kpi-num stats__kpi-num--good">{{ formatFen(kpi.received, { comma: true }) }}</div>
          <div class="stats__kpi-label">本期实收（元）</div>
        </div>
        <div class="stats__kpi-item">
          <div class="stats__kpi-num">{{ kpi.rate == null ? '—' : kpi.rate + '%' }}</div>
          <div class="stats__kpi-label">收缴率</div>
        </div>
        <div class="stats__kpi-item">
          <div class="stats__kpi-num" :style="{ color: kpi.overdueCount ? '#ee0a24' : '#323233' }">{{ kpi.overdueCount }}</div>
          <div class="stats__kpi-label">逾期未清（笔）</div>
        </div>
      </div>
      <div class="stats__kpi-note">实收按所选时间内收款日期合计；应收按该时间各期账单合计。</div>
    </div>

    <!-- 实收柱状图 -->
    <div class="fdb-card">
      <div class="fdb-card-title">
        <span>{{ ptype === 'month' ? '每日实收' : ptype === 'quarter' ? '季度各月实收' : '月度实收' }}</span>
      </div>
      <div ref="barEl" class="stats__chart"></div>
    </div>

    <!-- 科目构成 -->
    <div class="fdb-card">
      <div class="fdb-card-title"><span>{{ ptype === 'month' ? '本月应收构成' : '各月应收构成' }}</span></div>
      <div ref="stackEl" class="stats__chart"></div>
    </div>

    <!-- 楼栋汇总 -->
    <div class="fdb-card" v-if="byBuilding.length">
      <div class="fdb-card-title"><span>楼栋汇总（应收）</span></div>
      <div class="stats__brow stats__brow--head">
        <span>楼栋</span><span>期数</span><span>应收（元）</span>
      </div>
      <div class="stats__brow" v-for="b in byBuilding" :key="b.name">
        <span>{{ b.name }}</span><span>{{ b.bills }}</span>
        <span class="fdb-money">{{ formatFen(b.receivable, { comma: true }) }}</span>
      </div>
    </div>

    <!-- 明细表 -->
    <div class="fdb-card">
      <div class="fdb-card-title">
        <span>{{ unitLabel }}账单明细（{{ billRows.length }} 期）</span>
        <a class="stats__export" @click="exportCsv">导出表格</a>
      </div>
      <div class="stats__table-wrap">
        <table class="stats__table">
          <thead>
            <tr><th>期号</th><th>租客</th><th>楼栋</th><th>状态</th><th>应收</th><th>未收</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in billRows" :key="r.id">
              <td>{{ r.period }}</td>
              <td>{{ r.tenantName }}</td>
              <td>{{ r.buildingName }}</td>
              <td><span class="fdb-tag" :class="STATUS_META[r.status].cls">{{ STATUS_META[r.status].label }}</span></td>
              <td class="stats__num">{{ formatFen(r.total) }}</td>
              <td class="stats__num" :style="{ color: r.remaining > 0 ? '#ff8c42' : '' }">{{ formatFen(r.remaining) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!billRows.length" class="fdb-empty">该时间段还没有账单</div>
    </div>
    <div style="height: 24px"></div>

    <!-- 统计范围选择：类型 + 时间 -->
    <van-popup :show="showRangePicker" position="bottom" round @close="showRangePicker = false">
      <div class="stats__ptype">
        <button
          v-for="t in PTYPES"
          :key="t.value"
          :class="['stats__ptype-btn', { 'stats__ptype-btn--on': ptype === t.value }]"
          @click="ptype = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <van-picker
        title="选择统计范围"
        :columns="rangeColumns"
        :model-value="rangeValue"
        @confirm="onRangeConfirm"
        @cancel="showRangePicker = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.stats__year {
  font-size: 14px;
  color: var(--fdb-primary);
  cursor: pointer;
}
.stats__ptype {
  display: flex;
  gap: 8px;
  padding: 14px 16px 6px;
}
.stats__ptype-btn {
  flex: 1;
  border: 1px solid var(--fdb-primary);
  background: #fff;
  color: var(--fdb-primary);
  border-radius: 8px;
  padding: 8px 0;
  font-size: 14px;
  cursor: pointer;
}
.stats__ptype-btn--on {
  background: var(--fdb-primary);
  color: #fff;
}
.stats__kpi {
  display: flex;
  text-align: center;
}
.stats__kpi-item {
  flex: 1;
}
.stats__kpi-num {
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.stats__kpi-num--good {
  color: var(--fdb-success);
}
.stats__kpi-label {
  font-size: 10px;
  color: #969799;
  margin-top: 3px;
}
.stats__kpi-note {
  font-size: 11px;
  color: #c8c9cc;
  margin-top: 10px;
  text-align: center;
}
.stats__chart {
  width: 100%;
  height: 200px;
}
.stats__brow {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 7px 0;
  color: #323233;
  border-bottom: 1px solid #f5f6f7;
}
.stats__brow--head {
  color: #969799;
  font-size: 12px;
}
.stats__brow span:nth-child(1) {
  flex: 2;
  text-align: left;
}
.stats__brow span:nth-child(2) {
  flex: 1;
  text-align: center;
}
.stats__brow span:nth-child(3) {
  flex: 1.5;
  text-align: right;
}
.stats__export {
  font-size: 12px;
  color: var(--fdb-primary);
  cursor: pointer;
}
.stats__table-wrap {
  overflow-x: auto;
}
.stats__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.stats__table th {
  text-align: left;
  color: #969799;
  font-weight: 500;
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid #ebedf0;
  white-space: nowrap;
}
.stats__table td {
  padding: 7px 8px 7px 0;
  border-bottom: 1px solid #f5f6f7;
  color: #323233;
  white-space: nowrap;
}
.stats__num {
  font-variant-numeric: tabular-nums;
}
</style>
