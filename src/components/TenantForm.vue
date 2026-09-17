<script setup>
/**
 * 租客资料表单（新增/编辑）。
 * 计费规则核心：房租、收租日、押金、电费模式、水费模式、网费。
 */
import { ref, watch, computed } from 'vue'
import { showToast } from 'vant'
import repo from '@/db/repo'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { yuanToFen } from '@/utils/money'

const props = defineProps({
  show: Boolean,
  tenant: { type: Object, default: null }, // null=新增
})
const emit = defineEmits(['update:show', 'saved'])

const session = useSessionStore()
const data = useDataStore()

const MODE_OPTIONS = [
  { text: '按表计量（抄表算钱）', value: 'metered' },
  { text: '包干（每月固定收）', value: 'flat' },
  { text: '全包（不单独收）', value: 'included' },
]

const name = ref('')
const phone = ref('')
const room = ref('')
const buildingId = ref('')
const rentYuan = ref('')
const rentDay = ref('5')
const depositYuan = ref('')
const internetYuan = ref('')
const note = ref('')
const electricMode = ref('metered')
const electricPriceYuan = ref('')
const electricFlatYuan = ref('')
const waterMode = ref('metered')
const waterPriceYuan = ref('')
const waterFlatYuan = ref('')

const showBuildingPicker = ref(false)
const showRentDayPicker = ref(false)
const showEModePicker = ref(false)
const showWModePicker = ref(false)

const buildingText = computed(() => data.buildingsById[buildingId.value]?.name || '未分组')
const eModeText = computed(() => MODE_OPTIONS.find((o) => o.value === electricMode.value)?.text || '')
const wModeText = computed(() => MODE_OPTIONS.find((o) => o.value === waterMode.value)?.text || '')

const rentDayColumns = Array.from({ length: 31 }, (_, i) => ({ text: `每月 ${i + 1} 号`, value: String(i + 1) }))
const buildingColumns = computed(() => [
  { text: '未分组', value: '' },
  ...data.buildings.filter((b) => session.isAdmin || b.ownerId === session.current?.id).map((b) => ({ text: b.name, value: b.id })),
])

watch(
  () => props.show,
  (v) => {
    if (!v) return
    const t = props.tenant
    name.value = t?.name || ''
    phone.value = t?.phone || ''
    room.value = t?.room || ''
    buildingId.value = t?.buildingId || ''
    rentYuan.value = t ? ((t.monthlyRent || 0) / 100).toFixed(2) : ''
    rentDay.value = String(t?.rentDay || 5)
    depositYuan.value = t?.deposit ? (t.deposit / 100).toFixed(2) : ''
    internetYuan.value = t?.internet ? (t.internet / 100).toFixed(2) : ''
    note.value = t?.note || ''
    electricMode.value = t?.electric?.mode || 'metered'
    electricPriceYuan.value = t?.electric?.price ? (t.electric.price / 100).toFixed(2) : ''
    electricFlatYuan.value = t?.electric?.flatAmount ? (t.electric.flatAmount / 100).toFixed(2) : ''
    waterMode.value = t?.water?.mode || 'metered'
    waterPriceYuan.value = t?.water?.price ? (t.water.price / 100).toFixed(2) : ''
    waterFlatYuan.value = t?.water?.flatAmount ? (t.water.flatAmount / 100).toFixed(2) : ''
  }
)

async function save() {
  if (!name.value.trim()) return showToast('请填写租客姓名')
  if (yuanToFen(rentYuan.value) <= 0) return showToast('请填写月房租')
  const t = props.tenant
  await repo.saveTenant({
    id: t?.id,
    ownerId: t?.ownerId || session.current?.id,
    buildingId: buildingId.value || null,
    name: name.value.trim(),
    phone: phone.value.trim() || null,
    room: room.value.trim() || null,
    status: t?.status || 'active',
    rentDay: Number(rentDay.value) || 1,
    monthlyRent: yuanToFen(rentYuan.value),
    deposit: yuanToFen(depositYuan.value),
    internet: yuanToFen(internetYuan.value),
    electric: {
      mode: electricMode.value,
      price: yuanToFen(electricPriceYuan.value),
      flatAmount: yuanToFen(electricFlatYuan.value),
    },
    water: {
      mode: waterMode.value,
      price: yuanToFen(waterPriceYuan.value),
      flatAmount: yuanToFen(waterFlatYuan.value),
    },
    note: note.value.trim() || null,
    movedInAt: t?.movedInAt || null,
  })
  emit('update:show', false)
  emit('saved')
  showToast(t ? '已保存' : '已添加')
}
</script>

<template>
  <van-popup :show="show" position="bottom" round style="height: 88%" @update:show="(v) => emit('update:show', v)">
    <div class="tf">
      <div class="tf__title">{{ tenant ? '编辑租客' : '添加租客' }}</div>

      <van-cell-group inset>
        <van-field v-model="name" label="姓名" placeholder="租客怎么称呼" required />
        <van-field v-model="phone" type="tel" label="电话" placeholder="选填" />
        <van-field v-model="room" label="房号" placeholder="如：302" />
        <van-field :model-value="buildingText" is-link readonly label="所在楼栋" @click="showBuildingPicker = true" />
      </van-cell-group>

      <van-cell-group inset title="收租约定">
        <van-field v-model="rentYuan" type="number" label="月房租" placeholder="元" required>
          <template #right-icon>元/月</template>
        </van-field>
        <van-field :model-value="`每月 ${rentDay} 号`" is-link readonly label="收租日" @click="showRentDayPicker = true" />
        <van-field v-model="depositYuan" type="number" label="押金" placeholder="选填">
          <template #right-icon>元</template>
        </van-field>
      </van-cell-group>

      <van-cell-group inset title="电费">
        <van-field :model-value="eModeText" is-link readonly label="计费方式" @click="showEModePicker = true" />
        <van-field v-if="electricMode === 'metered'" v-model="electricPriceYuan" type="number" label="单价" placeholder="如 1.2">
          <template #right-icon>元/度</template>
        </van-field>
        <van-field v-if="electricMode === 'flat'" v-model="electricFlatYuan" type="number" label="包干金额">
          <template #right-icon>元/月</template>
        </van-field>
      </van-cell-group>

      <van-cell-group inset title="水费">
        <van-field :model-value="wModeText" is-link readonly label="计费方式" @click="showWModePicker = true" />
        <van-field v-if="waterMode === 'metered'" v-model="waterPriceYuan" type="number" label="单价" placeholder="如 4">
          <template #right-icon>元/吨</template>
        </van-field>
        <van-field v-if="waterMode === 'flat'" v-model="waterFlatYuan" type="number" label="包干金额">
          <template #right-icon>元/月</template>
        </van-field>
      </van-cell-group>

      <van-cell-group inset title="其他">
        <van-field v-model="internetYuan" type="number" label="网费等固定费" placeholder="0 为无">
          <template #right-icon>元/月</template>
        </van-field>
        <van-field v-model="note" label="备注" placeholder="选填" type="textarea" rows="1" autosize />
      </van-cell-group>

      <div style="padding: 16px">
        <van-button round block type="primary" @click="save">保存</van-button>
      </div>

      <van-popup :show="showBuildingPicker" position="bottom" round @close="showBuildingPicker = false">
        <van-picker title="选择楼栋" :columns="buildingColumns" @confirm="(e) => { buildingId = e.selectedValues[0]; showBuildingPicker = false }" @cancel="showBuildingPicker = false" />
      </van-popup>
      <van-popup :show="showRentDayPicker" position="bottom" round @close="showRentDayPicker = false">
        <van-picker title="收租日" :columns="rentDayColumns" @confirm="(e) => { rentDay = e.selectedValues[0]; showRentDayPicker = false }" @cancel="showRentDayPicker = false" />
      </van-popup>
      <van-popup :show="showEModePicker" position="bottom" round @close="showEModePicker = false">
        <van-picker title="电费计费方式" :columns="MODE_OPTIONS" @confirm="(e) => { electricMode = e.selectedValues[0]; showEModePicker = false }" @cancel="showEModePicker = false" />
      </van-popup>
      <van-popup :show="showWModePicker" position="bottom" round @close="showWModePicker = false">
        <van-picker title="水费计费方式" :columns="MODE_OPTIONS" @confirm="(e) => { waterMode = e.selectedValues[0]; showWModePicker = false }" @cancel="showWModePicker = false" />
      </van-popup>
    </div>
  </van-popup>
</template>

<style scoped>
.tf {
  height: 100%;
  overflow-y: auto;
  padding-bottom: 24px;
}
.tf__title {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  padding: 14px 0 6px;
}
</style>
