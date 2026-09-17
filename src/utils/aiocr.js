/**
 * 大模型识别水电表读数（可选增强，用户在「我的 → 识别设置」自己填 Key）。
 * 走 OpenAI 兼容的 chat/completions 视觉接口，智谱 GLM / 通义 / Kimi / OpenAI 都适用。
 * - 预置智谱 glm-4v-flash：免费额度，家庭用量基本 0 成本
 * - Key 只存本机 IndexedDB（meta 表不参与云同步），不会上传到任何地方
 * - 识别结果同样只做预填建议，人工确认后才保存
 */
import { getMeta, setMeta } from '@/db/dexie'

/** 服务商预设（OpenAI 兼容 + 视觉模型） */
export const AI_PRESETS = [
  { name: '智谱 GLM（免费额度）', base: 'https://api.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
  { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-plus' },
  { name: 'Kimi（月之暗面）', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview' },
  { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '自定义', base: '', model: '' },
]

/** 读取配置（未配置返回 null） */
export async function getAiConfig() {
  const cfg = await getMeta('aiOcrConfig', null)
  if (!cfg || !cfg.base || !cfg.key || !cfg.model) return null
  return cfg
}

/** 保存配置；传 null 清除 */
export async function setAiConfig(cfg) {
  await setMeta('aiOcrConfig', cfg)
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('图片读取失败'))
    fr.readAsDataURL(blob)
  })
}

/** 从模型回复里抠出读数（纯数字，可含小数点） */
function extractDigits(text) {
  const m = String(text || '').replace(/[，,\s]/g, '').match(/\d+(?:\.\d+)?/)
  return m ? m[0] : ''
}

/**
 * 用大模型识别表读数。utility: 'electric' | 'water'
 * 返回数字字符串；识别不到抛错（调用方降级到本地 OCR）。
 */
export async function aiOcrDigits(blob, utility, cfg) {
  const { base, key, model } = cfg
  const dataUrl = await blobToDataUrl(blob)
  const what = utility === 'water' ? '水表' : '电表'
  const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            {
              type: 'text',
              text: `这是一张${what}的照片。请读出表上显示的累计读数数字（通常是整数位，若有明显的小数位（红色区）请忽略）。只回答这个数字本身，不要加任何其他文字、单位或解释。`,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 32,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`接口返回 ${res.status}${detail ? `：${detail.slice(0, 120)}` : ''}`)
  }
  const json = await res.json()
  const text = json?.choices?.[0]?.message?.content
  const digits = extractDigits(typeof text === 'string' ? text : (text || []).map((p) => p.text || '').join(''))
  if (!digits) throw new Error('模型没有给出数字')
  return digits
}

/** 连通性测试（「识别设置」里用）：发一句话，能回就说明地址/Key/模型都对 */
export async function testAiConfig(cfg) {
  const { base, key, model } = cfg
  const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '连通性测试，请只回复 OK' }],
      max_tokens: 8,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`返回 ${res.status}${detail ? `：${detail.slice(0, 120)}` : ''}`)
  }
  return true
}
