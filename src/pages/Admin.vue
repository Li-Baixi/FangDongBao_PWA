<script setup>
/**
 * 用户管理（仅管理员）：
 * - 查看每位用户的数据量，快速切换查看范围
 * - 改名、设置/取消管理员（云模式）、档案密码（本地模式）
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import repo from '@/db/repo'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const list = computed(() => data.landlords)

function statsOf(l) {
  const tenants = data.tenants.filter((t) => t.ownerId === l.id && t.status === 'active').length
  const bills = data.bills.filter((b) => b.ownerId === l.id).length
  return { tenants, bills }
}

const showRename = ref(false)
const renameTarget = ref(null)
const renameValue = ref('')

function openRename(l) {
  renameTarget.value = l
  renameValue.value = l.name
  showRename.value = true
}
async function doRename() {
  if (!renameValue.value.trim()) return showToast('填个名字')
  await repo.saveLandlord({ ...renameTarget.value, name: renameValue.value.trim() })
  await data.reload()
  showRename.value = false
}

async function toggleRole(l) {
  if (!session.isAdmin) return
  const to = l.role === 'admin' ? 'member' : 'admin'
  // 安全闸：不能取消最后一个管理员，否则没人能管理
  if (to === 'member' && list.value.filter((x) => x.role === 'admin').length <= 1) {
    showToast('这是最后一位管理员，不能取消（先设别人为管理员）')
    return
  }
  try {
    await showConfirmDialog({
      title: to === 'admin' ? `把 ${l.name} 设为管理员？` : `取消 ${l.name} 的管理员？`,
      message: '管理员能看到并编辑所有用户的数据。',
    })
  } catch {
    return
  }
  await repo.saveLandlord({ ...l, role: to })
  await data.reload()
  showToast('已更新')
}

const showPin = ref(false)
const pinTarget = ref(null)
const pinValue = ref('')

function openPin(l) {
  pinTarget.value = l
  pinValue.value = ''
  showPin.value = true
}
async function doPin() {
  const l = pinTarget.value
  if (!l) return
  if (pinValue.value && !/^\d{4,6}$/.test(pinValue.value)) return showToast('4-6 位数字，或留空取消密码')
  if (pinValue.value) {
    const h = await repo.hashPin(pinValue.value)
    await repo.saveLandlord({ ...l, pinHash: h.hash, pinSalt: h.salt })
  } else {
    await repo.saveLandlord({ ...l, pinHash: null, pinSalt: null })
  }
  showPin.value = false
  showToast('已保存')
}
</script>

<template>
  <div class="fdb-page" v-if="session.isAdmin">
    <van-nav-bar title="用户管理" left-arrow @click-left="router.back()" />

    <div class="fdb-card">
      <div class="fdb-card-title">
        <span>全部用户（{{ list.length }} 人）</span>
      </div>
      <div class="adm__row" v-for="l in list" :key="l.id">
        <div class="adm__main">
          <div class="adm__name">
            {{ l.name }}
            <span class="fdb-tag" :class="l.role === 'admin' ? 'fdb-tag--paid' : 'fdb-tag--pending'">
              {{ l.role === 'admin' ? '管理员' : '成员' }}
            </span>
            <span v-if="l.id === session.current?.id" class="adm__me">（我）</span>
          </div>
          <div class="adm__sub">在租 {{ statsOf(l).tenants }} 户 · 累计 {{ statsOf(l).bills }} 期账单</div>
        </div>
        <div class="adm__ops">
          <van-icon name="edit" size="16" color="#969799" @click="openRename(l)" />
          <van-icon name="shield-o" size="16" color="#969799" style="margin-left: 12px" @click="toggleRole(l)" />
          <van-icon v-if="!session.isCloud" name="lock" size="16" color="#969799" style="margin-left: 12px" @click="openPin(l)" />
        </div>
      </div>
      <div class="adm__tip">
        首页右上角可以随时切换"看我自己 / 看全部 / 看某位用户"的数据。
      </div>
    </div>

    <van-dialog v-model:show="showRename" title="改名字" show-cancel-button @confirm="doRename">
      <van-field v-model="renameValue" label="名字" placeholder="怎么称呼" />
    </van-dialog>
    <van-dialog v-model:show="showPin" title="设置档案密码" show-cancel-button @confirm="doPin">
      <van-field v-model="pinValue" type="digit" label="密码" placeholder="4-6 位数字，留空=取消密码" />
    </van-dialog>
  </div>
  <div class="fdb-page" v-else>
    <van-nav-bar title="用户管理" left-arrow @click-left="router.back()" />
    <div class="fdb-empty">只有管理员能进入这里</div>
  </div>
</template>

<style scoped>
.adm__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f5f6f7;
}
.adm__row:last-child {
  border-bottom: none;
}
.adm__name {
  font-size: 15px;
  color: #323233;
  display: flex;
  align-items: center;
  gap: 6px;
}
.adm__me {
  font-size: 12px;
  color: #969799;
}
.adm__sub {
  font-size: 12px;
  color: #969799;
  margin-top: 3px;
}
.adm__ops {
  display: flex;
  align-items: center;
}
.adm__tip {
  font-size: 12px;
  color: #969799;
  padding-top: 10px;
  line-height: 1.6;
}
</style>
