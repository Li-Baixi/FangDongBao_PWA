/**
 * 水电表读数识别（本地 OCR，完全免费、离线可用）。
 * 使用 Tesseract.js，只识别数字和小数点（电表水表读数场景）。
 * 识别结果只作为"预填建议"，最终数字一定由人工确认后才保存。
 */
let workerPromise = null

async function getWorker() {
  const { createWorker } = await import('tesseract.js')
  const base = import.meta.env.BASE_URL || '/'
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/core`,
      langPath: `${base}ocr/lang`,
      logger: () => {},
    }).catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/** 识别图片里的读数，返回字符串（失败返回 ''） */
export async function ocrDigits(imageSource) {
  const worker = await getWorker()
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789.',
    tessedit_pageseg_mode: '6',
  })
  const { data } = await worker.recognize(imageSource)
  const m = (data.text || '').replace(/\s/g, '').match(/\d+(?:\.\d+)?/)
  return m ? m[0] : ''
}
