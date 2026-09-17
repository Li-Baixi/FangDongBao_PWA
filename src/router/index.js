import { createRouter, createWebHashHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const routes = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue'), meta: { tab: 'home' } },
  { path: '/tenants', name: 'tenants', component: () => import('@/pages/Tenants.vue'), meta: { tab: 'tenants' } },
  { path: '/tenant/:id', name: 'tenant', component: () => import('@/pages/TenantDetail.vue') },
  { path: '/collect/:tenantId?', name: 'collect', component: () => import('@/pages/Collect.vue') },
  { path: '/stats', name: 'stats', component: () => import('@/pages/Stats.vue'), meta: { tab: 'stats' } },
  { path: '/mine', name: 'mine', component: () => import('@/pages/Mine.vue'), meta: { tab: 'mine' } },
  { path: '/buildings', name: 'buildings', component: () => import('@/pages/Buildings.vue') },
  { path: '/admin', name: 'admin', component: () => import('@/pages/Admin.vue') },
  { path: '/profiles', name: 'profiles', component: () => import('@/pages/Profiles.vue') },
  { path: '/install-guide', name: 'installGuide', component: () => import('@/pages/InstallGuide.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// 守卫：应用启动后，未进入任何档案/账号时先到登录页
router.beforeEach(async (to) => {
  const session = useSessionStore()
  const data = useDataStore()
  data.bind()
  if (!session.ready) {
    await session.init()
    await data.reload()
  }
  if (!session.current && to.name !== 'profiles') {
    return { name: 'profiles' }
  }
})

export default router
