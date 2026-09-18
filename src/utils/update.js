/**
 * 应用内更新：对比线上 version.json 与当前版本，提示用户一键更新。
 * version.json 由构建时生成（vite.config.js），不进 SW 预缓存，永远拿网络最新。
 */

/** 拉线上最新版本信息；拿不到（离线等）返回 null */
export async function fetchLatestVersion() {
  try {
    const res = await fetch(`version.json?v=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const info = await res.json()
    if (!info || !info.version) return null
    return info
  } catch {
    return null
  }
}

/** 当前版本落后于线上版本时返回最新信息，否则 null */
export async function checkUpdate() {
  const info = await fetchLatestVersion()
  if (!info || info.version === __APP_VERSION__) return null
  return info
}

/**
 * 立即更新：让后台待命的新 Service Worker 接管，然后刷新页面。
 * 没有新 SW 待命（比如 SW 已在后台换好）就直接刷新拿最新资源。
 */
export async function applyUpdate() {
  if (!('serviceWorker' in navigator)) {
    window.location.reload()
    return
  }
  let reloaded = false
  const doReload = () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      await reg.update().catch(() => {})
      if (reg.waiting) {
        navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true })
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        // 兜底：个别机型 controllerchange 不触发，3 秒后强制刷新
        setTimeout(doReload, 3000)
        return
      }
    }
  } catch {
    /* 出错就走普通刷新 */
  }
  doReload()
}
