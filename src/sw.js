/**
 * 房东宝 Service Worker：
 * - 预缓存应用外壳（离线可打开）
 * - OCR 识别资源用一次缓存一次（离线也能识别）
 * - 接收收租提醒推送
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const BASE = self.registration.scope

// OCR 资源（wasm/字库，首次使用后离线可用）
registerRoute(
  ({ request, url }) => url.href.startsWith(`${BASE}ocr/`) || url.pathname.includes('/ocr/'),
  new CacheFirst({
    cacheName: 'ocr-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 365 * 24 * 3600 }),
    ],
  })
)

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
