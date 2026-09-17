<script setup>
/**
 * 我的：档案信息、楼栋管理、家庭成员（管理员）、推送提醒、备份、安装指南。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog, showLoadingToast } from 'vant'
import { db } from '@/db/dexie'
import repo from '@/db/repo'
import { supabase, vapidPublicKey } from '@/db/supabase'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { dataUrlToBlob } from '@/utils/image'
import { urlBase64ToUint8Array } from '@/utils/push'
import { uid, nowTs } from '@/utils/id'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

// __BUILD_TIME__ 由 vite 构建时注入（vite.config.js define），用来对照线上新旧版本
const version = __APP_VERSION__
const buildTime = __BUILD_TIME__

// 隐秘管理员入口：连点版本行 5 次（1.5 秒内）出现"平台管理"入口。
// 权限仍由账号 role 决定，这里只是不把入口亮给家里人。
const versionTaps = ref({ count: 0, timer: null })
function onTapVersion() {
  const st = versionTaps.value
  st.count += 1
  clearTimeout(st.timer)
  st.timer = setTimeout(() => (st.count = 0), 1500)
  if (st.count >= 5) {
    st.count = 0
    if (session.isAdmin) {
      showAdminEntry.value = true
      showToast('已显示管理员入口')
    }
  }
}
const showAdminEntry = ref(false)

const myFamily = computed(() => data.familyGroups.find((g) => g.id === session.current?.familyGroupId) || null)

const pushSupported = computed(
  () => session.isCloud && vapidPublicKey && 'serviceWorker' in navigator && 'PushManager' in window
)

async function enablePush() {
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      showToast('通知权限没打开：去手机系统设置里允许本应用通知')
      return
    }
    const loading = showLoadingToast({ message: '开启中…', forbidClick: true, duration: 0 })
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
    }
    const json = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      authUid: session.cloudUser.id,
      landlordId: session.current.id,
      landlordName: session.current.name,
      keys: json.keys,
      updatedAt: nowTs(),
    })
    loading.close()
    showToast('提醒已开启，收租日早上会通知你')
  } catch (e) {
    showToast(`开启失败：${e.message || e}`)
  }
}

// ===== 备份导出 / 导入 =====
const includePhotos = ref(true)

async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.readAsDataURL(blob)
  })
}

async function exportBackup() {
  const loading = showLoadingToast({ message: '打包中…照片多会慢一些', forbidClick: true, duration: 0 })
  try {
    const dump = {
      app: 'fangdongbao',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        landlords: await db.landlords.toArray(),
        buildings: await db.buildings.toArray(),
        tenants: await db.tenants.toArray(),
        meterReadings: await db.meterReadings.toArray(),
        bills: await db.bills.toArray(),
        payments: await db.payments.toArray(),
      },
    }
    if (includePhotos.value) {
      const photos = await db.photos.toArray()
      dump.photos = []
      for (const p of photos) {
        dump.photos.push({ ...p, blob: undefined, dataUrl: await blobToDataUrl(p.blob) })
      }
    }
    const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `房东宝备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    loading.close()
    showToast('已导出，注意保存到电脑/网盘')
  } catch (e) {
    loading.close()
    showToast(`导出失败：${e.message || e}`)
  }
}

const fileInput = ref(null)

async function importBackup(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const dump = JSON.parse(text)
    if (dump.app !== 'fangdongbao') throw new Error('不是房东宝的备份文件')
    const counts = Object.fromEntries(Object.entries(dump.data || {}).filter(([k]) => k !== 'landlords').map(([k, v]) => [k, v.length]))
    await showConfirmDialog({
      title: '导入备份？',
      message: `包含：${Object.entries(counts).map(([k, n]) => `${k} ${n} 条`).join('、')}${dump.photos ? `、照片 ${dump.photos.length} 张` : ''}。\n导入的数据会记在当前档案（${session.current?.name || ''}）名下，重复记录不会重复导入。`,
    })
  } catch (err) {
    if (err && err.message && err.message.includes('cancel')) return
    showToast(err.message || '文件读不了')
    e.target.value = ''
    return
  }
  const loading = showLoadingToast({ message: '导入中…', forbidClick: true, duration: 0 })
  try {
    const d = dump.data || {}
    // 导入的数据一律归到当前登录的档案名下（跨设备/迁移语义最清晰）
    const me = session.current?.id
    for (const b of d.buildings || []) await repo.saveBuilding({ ...b, ownerId: me })
    for (const t of d.tenants || []) await repo.saveTenant({ ...t, ownerId: me })
    for (const r of d.meterReadings || []) await repo.saveReading({ ...r, ownerId: me })
    for (const b of d.bills || []) await repo.saveBill({ ...b, ownerId: me })
    for (const p of d.payments || []) await repo.savePayment({ ...p, ownerId: me })
    for (const ph of dump.photos || []) {
      await repo.savePhoto({ ...ph, ownerId: me, blob: dataUrlToBlob(ph.dataUrl) })
    }
    await data.reload()
    loading.close()
    showToast('导入完成')
  } catch (e) {
    loading.close()
    showToast(`导入出错：${e.message || e}`)
  } finally {
    e.target.value = ''
  }
}

async function manualSync() {
  const loading = showLoadingToast({ message: '同步中…', forbidClick: true, duration: 0 })
  try {
    await session.backgroundSync()
    await data.reload()
    loading.close()
    showToast(session.lastError ? session.lastError : '已是最新')
  } catch (e) {
    loading.close()
    showToast('同步失败，检查网络')
  }
}

async function signOut() {
  try {
    await showConfirmDialog({ title: '退出当前档案？', message: '数据都保存在本机和云端，随时可以再登录。' })
  } catch {
    return
  }
  if (session.isCloud) await session.cloudLogout()
  else await session.localSignOut()
  await data.reload()
  router.replace({ name: 'profiles' })
}
</script>

<template>
  <div class="fdb-page mine">
    <van-nav-bar title="我的" />

    <!-- 档案卡 -->
    <div class="fdb-card">
      <div class="mine__profile">
        <div class="mine__avatar">{{ (session.current?.name || '?').slice(0, 1) }}</div>
        <div>
          <div class="mine__name">
            {{ session.current?.name }}
            <span class="fdb-tag" :class="session.isAdmin ? 'fdb-tag--paid' : 'fdb-tag--pending'">
              {{ session.isAdmin ? '管理员' : '成员' }}
            </span>
          </div>
          <div class="mine__sub">
            {{ session.isCloud ? `☁ 已连云账号（${session.cloudUser?.email || ''}）` : '📱 本机单机模式' }}
          </div>
        </div>
      </div>
      <van-cell-group inset style="margin-top: 10px" v-if="session.isCloud">
        <van-cell title="待同步" :value="session.pendingSync > 0 ? `${session.pendingSync} 条` : '全部已同步'" />
        <van-cell title="立即同步" is-link @click="manualSync" />
      </van-cell-group>
    </div>

    <!-- 功能 -->
    <van-cell-group inset title="日常">
      <van-cell title="楼栋管理" icon="shop-o" is-link @click="router.push({ name: 'buildings' })" />
      <van-cell
        title="家庭组"
        icon="friends-o"
        is-link
        :value="myFamily ? myFamily.name : '未加入'"
        @click="router.push({ name: 'family' })"
      />
      <van-cell
        v-if="showAdminEntry && session.isAdmin"
        title="平台管理"
        icon="setting-o"
        is-link
        @click="router.push({ name: 'admin' })"
      />
    </van-cell-group>

    <van-cell-group inset title="提醒">
      <van-cell title="收租推送提醒" icon="bell" is-link @click="enablePush" v-if="pushSupported" />
      <van-cell v-else title="收租推送提醒" icon="bell" :value="session.isCloud ? '未配置' : '仅云模式'" />
      <van-cell title="怎么装到手机桌面" icon="apps-o" is-link @click="router.push({ name: 'installGuide' })" />
    </van-cell-group>

    <van-cell-group inset title="数据安全（建议每月备份一次）">
      <van-cell title="导出备份文件" icon="down" is-link @click="exportBackup" />
      <van-cell title="从备份恢复 / 导入" icon="replay" is-link @click="fileInput && fileInput.click()" />
      <van-cell title="包含拍照原图" center>
        <template #right-icon>
          <van-switch v-model="includePhotos" size="20" />
        </template>
      </van-cell>
    </van-cell-group>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="importBackup" />

    <van-cell-group inset title="关于">
      <van-cell title="版本" :value="`v${version}（${buildTime}）`" @click="onTapVersion" />
      <van-cell title="使用说明" icon="question-o" is-link @click="router.push({ name: 'installGuide' })" />
    </van-cell-group>

    <div style="padding: 20px">
      <van-button round block plain type="danger" @click="signOut">退出登录</van-button>
    </div>
    <div style="height: 24px"></div>
  </div>
</template>

<style scoped>
.mine__profile {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mine__avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--fdb-primary);
  color: #fff;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mine__name {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mine__sub {
  font-size: 12px;
  color: #969799;
  margin-top: 3px;
}
</style>
