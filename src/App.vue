<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const route = useRoute()
const session = useSessionStore()
const data = useDataStore()
data.bind()

const active = ref(0)
const showTabbar = computed(() => Boolean(route.meta.tab))
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
