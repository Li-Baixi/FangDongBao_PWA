/**
 * 图片工具：拍照/选图后压缩存本地，同时生成云端同步用的小缩略图。
 * 原图只存本机 IndexedDB（省云存储），缩略图（约 20-40KB）随账单同步。
 */

const MAX_EDGE = 1600 // 原图最长边
const THUMB_EDGE = 360 // 缩略图最长边

function loadBitmap(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function drawToBlob(img, maxEdge, quality, type = 'image/jpeg') {
  let { width, height } = img
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

/**
 * 压缩拍照原图：返回 { blob(原图压缩版), thumb(缩略图 dataURL) }
 */
export async function compressPhoto(file) {
  const img = await loadBitmap(file)
  const blob = await drawToBlob(img, MAX_EDGE, 0.85)
  const thumb = await drawToBlob(img, THUMB_EDGE, 0.7)
  const thumbDataUrl = await new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.readAsDataURL(thumb)
  })
  return { blob, thumb: thumbDataUrl }
}

/** dataURL -> Blob */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',')
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg'
  const bin = atob(body)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
