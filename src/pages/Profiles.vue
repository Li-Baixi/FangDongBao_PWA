<script setup>
/**
 * 登录页：
 * - 本地模式：选择/创建本机档案（可选 PIN 密码）
 * - 云模式：邮箱密码登录 / 注册（第一个注册的自动成为管理员）
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog, showLoadingToast } from 'vant'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const isCloud = computed(() => session.isCloud)
const profiles = computed(() => data.landlords)

// ---- 本地模式 ----
const showCreate = ref(false)
const newName = ref('')
const newPin = ref('')
const pinFor = ref(null) // 正在解锁的档案
const pinInput = ref('')

async function openProfile(p) {
  if (p.pinHash) {
    pinFor.value = p
    pinInput.value = ''
    return
  }
  await doSwitch(p.id, '')
}

async function doSwitch(id, pin) {
  const ok = showLoadingToast({ message: '进入中…', forbidClick: true, duration: 0 })
  try {
    await session.localSwitch(id, pin)
    await data.reload()
    ok.close()
    router.replace({ name: 'home' })
  } catch (e) {
    ok.close()
    showToast(e.message || '进入失败')
  }
}

async function createProfile() {
  const name = newName.value.trim()
  if (!name) return showToast('请填写名字')
  if (newPin.value && !/^\d{4,6}$/.test(newPin.value)) return showToast('密码为 4-6 位数字，可留空')
  await session.localCreateProfile(name, newPin.value || '')
  await data.reload()
  showCreate.value = false
  newName.value = ''
  newPin.value = ''
  router.replace({ name: 'home' })
}

// ---- 云模式 ----
const email = ref('')
const password = ref('')
const regName = ref('')
const isRegister = ref(false)

async function submit() {
  if (!email.value || !password.value) return showToast('请填写邮箱和密码')
  const loading = showLoadingToast({ message: '请稍候…', forbidClick: true, duration: 0 })
  try {
    if (isRegister.value) {
      await session.cloudSignup(email.value.trim(), password.value, regName.value.trim())
      loading.close()
      await showConfirmDialog({
        title: '注册成功',
        message: '请查收邮箱完成验证后（若项目要求），再用该邮箱登录。',
      })
      isRegister.value = false
    } else {
      await session.cloudLogin(email.value.trim(), password.value)
      await data.reload()
      loading.close()
      router.replace({ name: 'home' })
    }
  } catch (e) {
    loading.close()
    showToast(e.message || '操作失败')
  }
}
</script>

<template>
  <div class="fdb-page profiles">
    <div class="profiles__hero">
      <div class="profiles__logo">房东宝</div>
      <div class="profiles__sub">收租记账，一本清账</div>
    </div>

    <!-- 云模式：邮箱登录 -->
    <div v-if="isCloud" class="fdb-card">
      <template v-if="!isRegister">
        <van-field v-model="email" type="email" label="邮箱" placeholder="用户各自的账号" />
        <van-field v-model="password" type="password" label="密码" placeholder="输入密码" />
        <div style="margin-top: 14px">
          <van-button round block type="primary" @click="submit">登录</van-button>
        </div>
        <div class="profiles__links">
          <a @click="isRegister = true">没有账号？注册一个</a>
        </div>
      </template>
      <template v-else>
        <van-field v-model="regName" label="称呼" placeholder="怎么称呼你（如：妈妈、老李）" />
        <van-field v-model="email" type="email" label="邮箱" placeholder="用于登录" />
        <van-field v-model="password" type="password" label="密码" placeholder="至少 6 位" />
        <div style="margin-top: 14px">
          <van-button round block type="primary" @click="submit">注册</van-button>
        </div>
        <div class="profiles__links">
          <a @click="isRegister = false">已有账号？去登录</a>
        </div>
      </template>
    </div>

    <!-- 本地模式：档案列表 -->
    <div v-else>
      <div class="fdb-card" v-if="profiles.length">
        <div class="fdb-card-title">选择你的档案</div>
        <van-cell
          v-for="p in profiles"
          :key="p.id"
          :title="p.name"
          is-link
          :label="p.role === 'admin' ? '管理员' : '成员'"
          @click="openProfile(p)"
        >
          <template #icon>
            <van-icon name="manager-o" style="font-size: 20px; margin-right: 8px; color: var(--fdb-primary)" />
          </template>
        </van-cell>
      </div>
      <div class="fdb-card" v-else>
        <div class="fdb-empty">还没有档案，创建一个开始记账</div>
      </div>

      <div class="fdb-card">
        <van-button round block type="primary" plain @click="showCreate = true">+ 新建档案</van-button>
        <div class="profiles__tip">提示：第一个创建的档案是管理员，可以查看全部用户的数据。</div>
      </div>

      <!-- 新建档案 -->
      <van-dialog
        v-model:show="showCreate"
        title="新建档案"
        show-cancel-button
        @confirm="createProfile"
      >
        <van-field v-model="newName" label="名字" placeholder="如：爸爸、妈妈" />
        <van-field v-model="newPin" type="digit" label="密码" placeholder="4-6 位数字，可留空" />
      </van-dialog>

      <!-- PIN 解锁 -->
      <van-dialog
        :show="!!pinFor"
        :title="`${pinFor?.name || ''} 的密码`"
        show-cancel-button
        @confirm="doSwitch(pinFor.id, pinInput)"
        @cancel="pinFor = null"
      >
        <van-field v-model="pinInput" type="password" label="密码" placeholder="输入档案密码" />
      </van-dialog>
    </div>
  </div>
</template>

<style scoped>
.profiles__hero {
  padding: 64px 0 28px;
  text-align: center;
}
.profiles__logo {
  font-size: 34px;
  font-weight: 700;
  color: var(--fdb-primary);
  letter-spacing: 3px;
}
.profiles__sub {
  margin-top: 8px;
  font-size: 13px;
  color: #969799;
}
.profiles__links {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--fdb-primary);
}
.profiles__links a {
  cursor: pointer;
}
.profiles__tip {
  margin-top: 10px;
  font-size: 12px;
  color: #969799;
  text-align: center;
}
</style>
