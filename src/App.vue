<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { checkUpdate, applyUpdate, newerVersions } from '@/utils/update'

const route = useRoute()
const session = useSessionStore()
const data = useDataStore()
data.bind()

const active = ref(0)
const showTabbar = computed(() => Boolean(route.meta.tab))

// ===== 应用内更新检查 =====
// 启动时和每次回到前台（间隔 >10 分钟）检查 version.json，发现新版本弹窗提示。
// 同一个版本一次会话只提示一次，用户点了「稍后」就不再烦人。
let lastCheck = 0
let checking = false

async function tryCheckUpdate() {
  if (checking) return
  checking = true
  try {
    const info = await checkUpdate()
    if (info && sessionStorage.getItem('fdb-update-prompted') !== info.version) {
      sessionStorage.setItem('fdb-update-prompted', info.version)
      // 很久没打开、落后好几个版本时：只弹一个窗，但把这期间
      // 每个版本更新了什么都列出来（最多 3 条，更早的去更新日志看），
      // 点一次直接升到最新，中间版本不会挨个补弹。
      const newer = newerVersions(__APP_VERSION__, info)
      const shown = newer.slice(0, 3)
      const message =
        shown.map((x) => `【v${x.version}】${x.note || '优化与修复'}`).join('\n\n') +
        (newer.length > shown.length
          ? `\n\n（更早还有 ${newer.length - shown.length} 个版本的更新，装好后可在「我的 → 更新日志」查看）`
          : '')
      try {
        await showConfirmDialog({
          title:
            newer.length > 1
              ? `发现新版本 v${info.version}（落后 ${newer.length} 个版本）`
              : `发现新版本 v${info.version}`,
          message,
          confirmButtonText: '一键更到最新',
          cancelButtonText: '稍后再说',
          confirmButtonColor: '#0f766e',
        })
        await applyUpdate()
      } catch {
        /* 用户点「稍后」，下次打开发版还会提示 */
      }
    }
  } finally {
    checking = false
    lastCheck = Date.now()
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible' && Date.now() - lastCheck > 10 * 60 * 1000) {
    tryCheckUpdate()
  }
}

onMounted(() => {
  // 等首次加载稳定后再查，避免和启动抢资源
  setTimeout(tryCheckUpdate, 3000)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <van-config-provider :theme-vars="{ primaryColor: '#0f766e' }">
    <router-view v-if="session.ready" />
    <div v-else class="fdb-launch">
      <div class="fdb-launch__logo">房东宝</div>
      <div class="fdb-launch__tip">正在打开…</div>
    </div>

    <van-tabbar v-if="showTabbar && session.ready" route safe-area-inset-bottom>
      <van-tabbar-item replace to="/" icon="wap-home-o">首页</van-tabbar-item>
      <van-tabbar-item replace to="/tenants" icon="friends-o">租客</van-tabbar-item>
      <van-tabbar-item replace to="/stats" icon="chart-trending-o">统计</van-tabbar-item>
      <van-tabbar-item replace to="/mine" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </van-config-provider>
</template>

<style scoped>
.fdb-launch {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.fdb-launch__logo {
  font-size: 28px;
  font-weight: 700;
  color: var(--fdb-primary);
  letter-spacing: 2px;
}
.fdb-launch__tip {
  font-size: 13px;
  color: #969799;
}
</style>
