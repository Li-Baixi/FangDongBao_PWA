<script setup>
/**
 * 租客资料表单（新增/编辑）。
 * 计费规则核心：房租、收租日、押金、电费模式、水费模式、网费。
 */
import { ref, watch, computed } from 'vue'
import { showToast, showConfirmDialog, showImagePreview, showLoadingToast } from 'vant'
import repo from '@/db/repo'
import { db } from '@/db/dexie'
import { uid } from '@/utils/id'
import { compressPhoto } from '@/utils/image'
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
// 电话位数提醒：手机 11 位；座机 7-8 位，带区号 10-12 位。填了但位数不像就提醒
const phoneDigits = computed(() => phone.value.replace(/\D/g, ''))
const phoneInvalid = computed(() => {
  const n = phoneDigits.value.length
  return n > 0 && n !== 11 && !(n >= 7 && n <= 12)
})
const phoneHint = computed(() => {
  const n = phoneDigits.value.length
  if (n === 0) return ''
  if (n < 7) return `才 ${n} 位，还没输完吧？`
  if (n > 12) return `超了，已输入 ${n} 位`
  if (n !== 11) return '这是座机号吗？手机号是 11 位'
  return ''
})
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

// ===== 证件与合同照片（折叠区，默认收起，不挡日常编辑视线） =====
const showDocs = ref(false)
const docs = ref([]) // [{id, kind:'idcard'|'contract', thumb}]
const removedIds = ref([]) // 本次删掉的旧照片（保存时清本地原图）
const newBlobs = {} // 新加照片的原图（点保存才真正入库，中途取消不残留）
const docInput = ref(null)
const pickKind = ref('contract')

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
    docs.value = ((t && t.docs) || []).map((d) => ({ ...d }))
    removedIds.value = []
    showDocs.value = false // 默认折叠
    for (const k of Object.keys(newBlobs)) delete newBlobs[k]
    snapshot = fieldsSnapshot() // 记住打开时的样子，用来判断"改了没保存"
  }
)

// ===== 未保存保护 =====
let snapshot = ''
function fieldsSnapshot() {
  return JSON.stringify([
    name.value, phone.value, room.value, buildingId.value, rentYuan.value, rentDay.value,
    depositYuan.value, internetYuan.value, note.value,
    electricMode.value, electricPriceYuan.value, electricFlatYuan.value,
    waterMode.value, waterPriceYuan.value, waterFlatYuan.value,
    docs.value.map((d) => d.id + ':' + d.kind).join(','),
  ])
}
const dirty = computed(() => fieldsSnapshot() !== snapshot)

/** 关闭弹窗前检查：有改动没保存就拦一道，防止手滑白改 */
function onCloseRequest(v) {
  if (!v && dirty.value) {
    showConfirmDialog({
      title: '有未保存的修改',
      message: '刚改的信息还没保存，确定退出吗？',
      confirmButtonText: '不保存退出',
      cancelButtonText: '继续编辑',
      confirmButtonColor: '#ee0a24',
    })
      .then(() => emit('update:show', false))
      .catch(() => {})
    return
  }
  emit('update:show', v)
}

// ===== 证件/合同照片操作 =====
function docsOf(kind) {
  return docs.value.filter((d) => d.kind === kind)
}

function pickDoc(kind) {
  pickKind.value = kind
  if (docInput.value) docInput.value.click()
}

async function onDocFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const loading = showLoadingToast({ message: '处理照片…', forbidClick: true, duration: 0 })
  try {
    const { blob, thumb } = await compressPhoto(file)
    const id = uid()
    newBlobs[id] = blob
    docs.value.push({ id, kind: pickKind.value, thumb, _new: true, _localUrl: URL.createObjectURL(blob) })
  } catch {
    showToast('照片处理失败，请重试')
  } finally {
    loading.close()
    e.target.value = ''
  }
}

function removeDoc(d) {
  if (d._new) {
    if (d._localUrl) URL.revokeObjectURL(d._localUrl)
    delete newBlobs[d.id]
  } else {
    removedIds.value.push(d.id)
  }
  docs.value = docs.value.filter((x) => x.id !== d.id)
}

async function previewDoc(d) {
  let url = d._localUrl || d.thumb
  try {
    const p = await repo.getPhoto(d.id)
    if (p && p.blob) url = URL.createObjectURL(p.blob)
  } catch {
    /* 本机没有原图就用同步来的缩略图 */
  }
  showImagePreview([url])
}

async function save() {
  if (!name.value.trim()) return showToast('请填写租客姓名')
  if (yuanToFen(rentYuan.value) <= 0) return showToast('请填写月房租')
  // 电话位数不对时提醒一次，允许坚持保存（座机等特殊情况）
  if (phoneInvalid.value) {
    try {
      await showConfirmDialog({ title: '电话位数好像不对', message: `${phoneHint.value}，确定这样保存吗？` })
    } catch {
      return
    }
  }
  const t = props.tenant
  const tid = t?.id || uid() // 新租客先生成 ID，照片才能挂上租客
  // 证件/合同照片：新加的把原图存进本机照片库，删掉的清掉
  for (const d of docs.value) {
    if (d._new && newBlobs[d.id]) {
      await repo.savePhoto({ id: d.id, ownerId: t?.ownerId || session.current?.id, tenantId: tid, blob: newBlobs[d.id] })
    }
  }
  for (const rid of removedIds.value) await db.photos.delete(rid)
  await repo.saveTenant({
    id: tid,
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
    docs: docs.value.map(({ id, kind, thumb }) => ({ id, kind, thumb })),
  })
  emit('update:show', false)
  emit('saved')
  showToast(t ? '已保存' : '已添加')
}
</script>

<template>
  <van-popup :show="show" position="bottom" round style="height: 88%" @update:show="onCloseRequest">
    <div class="tf">
      <div class="tf__title">{{ tenant ? '编辑租客' : '添加租客' }}</div>
      <div class="tf__body">

      <van-cell-group inset>
        <van-field v-model="name" label="姓名" placeholder="租客怎么称呼" required />
        <van-field
          v-model="phone"
          type="tel"
          label="电话"
          placeholder="选填，手机 11 位"
          maxlength="13"
          :error="phoneInvalid"
          :error-message="phoneHint"
        />
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

      <van-cell-group inset>
        <van-cell title="证件与合同" :value="docs.length ? `${docs.length} 张` : '选填'" is-link @click="showDocs = !showDocs">
          <template #right-icon>
            <van-icon :name="showDocs ? 'arrow-up' : 'arrow-down'" color="#969799" />
          </template>
        </van-cell>
        <div v-if="showDocs" class="tf__docs">
          <div class="tf__docs-label">身份证图片（正反面各拍一张）</div>
          <div class="tf__thumbs">
            <div v-for="d in docsOf('idcard')" :key="d.id" class="tf__thumb">
              <img :src="d._localUrl || d.thumb" @click="previewDoc(d)" />
              <van-icon name="clear" class="tf__thumb-del" @click.stop="removeDoc(d)" />
            </div>
            <div class="tf__thumb tf__thumb--add" @click="pickDoc('idcard')">
              <van-icon name="plus" size="16" />
              <span>添加</span>
            </div>
          </div>
          <div class="tf__docs-label">合同图片（多页就多拍几张）</div>
          <div class="tf__thumbs">
            <div v-for="d in docsOf('contract')" :key="d.id" class="tf__thumb">
              <img :src="d._localUrl || d.thumb" @click="previewDoc(d)" />
              <van-icon name="clear" class="tf__thumb-del" @click.stop="removeDoc(d)" />
            </div>
            <div class="tf__thumb tf__thumb--add" @click="pickDoc('contract')">
              <van-icon name="plus" size="16" />
              <span>添加</span>
            </div>
          </div>
          <div class="tf__docs-tip">原图只存这台手机（换手机前用「我的 → 导出备份」带走）；家里人看到的是同步的缩略图。</div>
        </div>
      </van-cell-group>
      </div>

      <input ref="docInput" type="file" accept="image/*" style="display: none" @change="onDocFile" />

      <div class="tf__footer">
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tf__title {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  padding: 14px 0 6px;
}
.tf__body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 12px;
}
.tf__footer {
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #f5f6f7;
  background: #fff;
}
.tf__docs {
  padding: 4px 16px 14px;
}
.tf__docs-label {
  font-size: 12px;
  color: #646566;
  margin: 10px 0 6px;
}
.tf__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tf__thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f6f7;
}
.tf__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tf__thumb-del {
  position: absolute;
  top: 3px;
  right: 3px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  padding: 2px;
  font-size: 14px;
}
.tf__thumb--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #969799;
  font-size: 11px;
  border: 1px dashed #dcdee0;
  cursor: pointer;
  box-sizing: border-box;
}
.tf__docs-tip {
  font-size: 11px;
  color: #c8c9cc;
  margin-top: 10px;
  line-height: 1.6;
}
</style>
