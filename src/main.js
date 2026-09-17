import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Vant from 'vant'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'vant/lib/index.css'

import App from './App.vue'
import router from './router'
import { registerSW } from 'virtual:pwa-register'
import './styles/app.css'

dayjs.locale('zh-cn')

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(Vant)
app.mount('#app')

// 注册 Service Worker（PWA 离线能力 + 推送通知）
registerSW({ immediate: true })
