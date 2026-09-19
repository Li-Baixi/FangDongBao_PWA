/**
 * 房东宝 Service Worker：
 * - 预缓存应用外壳（离线可打开）
 * - 接收收租提醒推送
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// 应用内更新：页面发来 SKIP_WAITING 就立刻接管（配合刷新拿最新版本）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

const BASE = self.registration.scope

// ===== 收租提醒推送 =====
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: '房东宝', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '房东宝', {
      body: data.body || '',
      tag: data.tag || 'fangdongbao',
      renotify: false,
      data: { url: data.url || './' },
      icon: new URL('icons/icon-192.png', BASE).href,
      badge: new URL('icons/icon-192.png', BASE).href,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          return
        }
      }
      await self.clients.openWindow((event.notification.data && event.notification.data.url) || './')
    })()
  )
})
