<script setup>
/**
 * 抄表步骤组件：拍照/从相册选图 + 上次读数 + 本次读数 + OCR 识别。
 * 识别优先级：用户配置了大模型 Key 就用大模型（更准），失败自动降级本地 OCR。
 * 强调：OCR 只做预填，数字必须人工过目确认。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { showToast, showLoadingToast } from 'vant'
import { compressPhoto } from '@/utils/image'
import { ocrDigits } from '@/utils/ocr'
import { aiOcrDigits, getAiConfig } from '@/utils/aiocr'
import { fmtReading } from '@/utils/dates'

const props = defineProps({
  title: { type: String, required: true }, // "电表" / "水表"
  unit: { type: String, default: '度' }, // 度 / 吨
  utility: { type: String, default: 'electric' }, // electric | water
  priceFen: { type: Number, default: 0 }, // 单价（分）
  prev: { type: [Number, String], default: '' },
  modelPrev: { type: [Number, String], default: '' },
  modelCur: { type: [Number, String], default: '' },
  photoBlob: { type: [Blob, Object], default: null },
})
const emit = defineEmits(['update:modelPrev', 'update:modelCur', 'photo'])

const shotInput = ref(null) // 直接拍照
const pickInput = ref(null) // 从相册选
const previewUrl = ref('')
const ocrHint = ref('')

watch(
  () => props.photoBlob,
  (blob) => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = blob ? URL.createObjectURL(blob) : ''
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

async function onFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const loading = showLoadingToast({ message: '处理照片…', forbidClick: true, duration: 0 })
  try {
    const { blob, thumb } = await compressPhoto(file)
    emit('photo', { blob, thumb })
    ocrHint.value = ''
    loading.close()
    showToast('照片已存，可点"自动识别"辅助填数')
  } catch (err) {
    loading.close()
    showToast('照片处理失败，请重拍')
  } finally {
    e.target.value = ''
  }
}

async function runOcr() {
  if (!props.photoBlob) return showToast('先拍一张表的照片')
  // 优先大模型（用户在「我的 → 识别设置」配置过 Key 时）
  const cfg = await getAiConfig()
  if (cfg) {
    const loading = showLoadingToast({ message: 'AI 识别中…', forbidClick: true, duration: 0 })
    try {
      const digits = await aiOcrDigits(props.photoBlob, props.utility, cfg)
      loading.close()
      emit('update:modelCur', digits)
      ocrHint.value = `AI 识别为 ${digits}，请核对表盘无误后再继续`
      return
    } catch (e) {
      loading.close()
      showToast(`大模型识别失败（${(e.message || '').slice(0, 60)}），改用本地识别`)
    }
  }
  // 本地 OCR（免费、离线）
  const loading = showLoadingToast({ message: '本地识别中…可能要几秒', forbidClick: true, duration: 0 })
  try {
    const digits = await ocrDigits(props.photoBlob)
    loading.close()
    if (digits) {
      emit('update:modelCur', digits)
      ocrHint.value = `识别为 ${digits}，请核对表盘无误后再继续`
    } else {
      showToast('没认出来，请手动输入读数')
    }
  } catch (e) {
    loading.close()
    showToast('识别组件加载失败，请手动输入读数')
  }
}
</script>

<template>
  <div class="meter">
    <div class="meter__title">{{ title }}</div>

    <!-- 照片 -->
    <div class="meter__photo" @click="shotInput && shotInput.click()">
      <img v-if="previewUrl" :src="previewUrl" alt="表的照片" />
      <div v-else class="meter__photo-empty">
        <van-icon name="photograph" size="28" color="#969799" />
        <div>点击拍照，或点下方"相册"选已拍好的</div>
        <div class="meter__photo-tip">拍清楚数字区域，照片会存档作为凭据</div>
      </div>
    </div>
    <input ref="shotInput" type="file" accept="image/*" capture="environment" style="display: none" @change="onFile" />
    <input ref="pickInput" type="file" accept="image/*" style="display: none" @change="onFile" />

    <div class="meter__btns">
      <van-button size="small" plain round icon="photograph" @click="shotInput && shotInput.click()">重拍</van-button>
      <van-button size="small" plain round icon="photo-o" @click="pickInput && pickInput.click()">相册</van-button>
      <van-button size="small" plain round type="primary" icon="scan" @click="runOcr">自动识别</van-button>
    </div>
    <div v-if="ocrHint" class="meter__ocr-hint">🤖 {{ ocrHint }}</div>

    <!-- 读数 -->
    <div class="meter__fields">
      <div class="meter__field">
        <div class="meter__label">上次读数</div>
        <van-field
          :model-value="String(modelPrev ?? '')"
          type="number"
          placeholder="上次的读数"
          @update:model-value="(v) => emit('update:modelPrev', v)"
        />
        <div class="meter__sub">预填自上次抄表，如有误可修改</div>
      </div>
      <van-icon name="arrow" class="meter__arrow" />
      <div class="meter__field">
        <div class="meter__label">本次读数</div>
        <van-field
          :model-value="String(modelCur ?? '')"
          type="number"
          placeholder="看表输入"
          @update:model-value="(v) => emit('update:modelCur', v)"
        />
        <div class="meter__sub">{{ unit }}数</div>
      </div>
    </div>
    <div class="meter__calc" v-if="modelCur !== '' && modelCur !== null">
      <template v-if="Number(modelCur) >= Number(modelPrev || 0)">
        用量 {{ fmtReading(Number(modelCur) - Number(modelPrev || 0)) }} {{ unit }}
        <template v-if="priceFen > 0"> × {{ (priceFen / 100).toFixed(2) }} 元 = <b>{{ (((Number(modelCur) - Number(modelPrev || 0)) * priceFen) / 100).toFixed(2) }} 元</b></template>
      </template>
      <template v-else>
        <span class="meter__warn">⚠️ 本次读数比上次小，请核对（表清零/换表可继续）</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.meter__title {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
  margin: 6px 0 10px;
}
.meter__photo {
  border-radius: 12px;
  overflow: hidden;
  background: #f5f6f7;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.meter__photo img {
  width: 100%;
  max-height: 260px;
  object-fit: cover;
  display: block;
}
.meter__photo-empty {
  text-align: center;
  color: #969799;
  font-size: 13px;
  padding: 24px 0;
  line-height: 1.8;
}
.meter__photo-tip {
  font-size: 11px;
  color: #c8c9cc;
}
.meter__btns {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.meter__ocr-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--fdb-primary);
}
.meter__fields {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
}
.meter__field {
  flex: 1;
}
.meter__label {
  font-size: 12px;
  color: #646566;
  margin-bottom: 4px;
}
.meter__sub {
  font-size: 11px;
  color: #c8c9cc;
  padding: 0 8px;
}
.meter__arrow {
  margin-top: 34px;
  color: #c8c9cc;
}
.meter__calc {
  margin-top: 10px;
  background: #f0faf8;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  color: #0f766e;
}
.meter__calc b {
  font-size: 16px;
}
.meter__warn {
  color: #ee0a24;
  font-size: 13px;
}
</style>
