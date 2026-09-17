<script setup>
/**
 * 家庭组：自愿把几位房东的楼组成一组，组内共享数据、合并统计。
 * 不想组就各自单机用，互不影响。邀请码 6 位，家人输码即可加入。
 */
import { ref, computed } from 'vue'
import { showToast, showConfirmDialog, showLoadingToast } from 'vant'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const session = useSessionStore()
const data = useDataStore()

const myGroup = computed(() => data.familyGroups.find((g) => g.id === session.current?.familyGroupId) || null)
const members = computed(() => data.landlords.filter((l) => l.familyGroupId === myGroup.value?.id && !l.deletedAt))
const isOwner = computed(() => myGroup.value && myGroup.value.ownerId === session.current?.id)

// 创建
const newName = ref('')
const showCreate = ref(false)
async function createGroup() {
  if (!newName.value.trim()) return showToast('给家庭组起个名字，比如"李家出租屋"')
  const loading = showLoadingToast({ message: '创建中…', forbidClick: true, duration: 0 })
  try {
    await session.createFamily(newName.value.trim())
    showCreate.value = false
    newName.value = ''
    showToast('家庭组已创建')
  } catch (e) {
    showToast(e.message || '创建失败')
  } finally {
    loading.close()
  }
}

// 加入
const inviteCode = ref('')
async function joinGroup() {
  const code = inviteCode.value.trim().toUpperCase()
  if (code.length !== 6) return showToast('邀请码是 6 位')
  const loading = showLoadingToast({ message: '加入中…', forbidClick: true, duration: 0 })
  try {
    const g = await session.joinFamily(code)
    inviteCode.value = ''
    showToast(`已加入「${g.name}」`)
  } catch (e) {
    showToast(e.message || '加入失败')
  } finally {
    loading.close()
  }
}

async function leaveGroup() {
  try {
    await showConfirmDialog({
      title: '退出家庭组？',
      message: '退出后看不到家人的数据，自己的数据不受影响；随时可以再凭邀请码加入。',
    })
  } catch {
    return
  }
  await session.leaveFamily()
  showToast('已退出')
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(myGroup.value.inviteCode)
    showToast('邀请码已复制')
  } catch {
    showToast(`邀请码：${myGroup.value.inviteCode}`)
  }
}
</script>

<template>
  <div class="fdb-page">
    <van-nav-bar title="家庭组" left-arrow @click-left="$router.back()" />

    <!-- 本地模式：家庭组是云功能 -->
    <div v-if="!session.isCloud" class="fdb-card">
      <div class="fdb-empty">
        家庭组需要云账号（家人各自注册、数据互相同步）。<br />
        当前是本机单机模式，数据只存在这台手机上。
      </div>
    </div>

    <template v-else>
      <!-- 已入组 -->
      <template v-if="myGroup">
        <div class="fdb-card">
          <div class="fdb-card-title">
            <span>👪 {{ myGroup.name }}</span>
            <span class="fg__count">{{ members.length }} 位成员</span>
          </div>
          <div class="fg__row" v-for="m in members" :key="m.id">
            <div class="fg__avatar">{{ (m.name || '?').slice(0, 1) }}</div>
            <div class="fg__name">
              {{ m.name }}
              <span v-if="m.id === session.current?.id" class="fdb-tag fdb-tag--paid">我</span>
              <span v-else-if="m.role === 'admin'" class="fdb-tag fdb-tag--pending">管理员</span>
            </div>
          </div>
        </div>

        <div class="fdb-card">
          <div class="fdb-card-title"><span>邀请码</span></div>
          <div class="fg__code" @click="copyCode">
            {{ myGroup.inviteCode }}
          </div>
          <div class="fg__tip">家人注册后，在「我的 → 家庭组」输入这串码即可加入。点击可复制。</div>
        </div>

        <div class="fdb-card" v-if="isOwner">
          <div class="fdb-card-title"><span>组内数据说明</span></div>
          <div class="fg__tip">
            组内成员可以看到彼此的楼、租客和账单，统计合并计算。首页右上角可切换"我的 / 家庭组"视角。
          </div>
        </div>

        <div style="padding: 12px 16px">
          <van-button round block plain type="danger" @click="leaveGroup">退出家庭组</van-button>
        </div>
      </template>

      <!-- 未入组 -->
      <template v-else>
        <div class="fdb-card">
          <div class="fdb-card-title"><span>组建家庭组</span></div>
          <div class="fg__tip">
            例如：奶奶、妈妈、你各管自己的楼。组成一组后，互相看得见数据、统计自动合并；
            不组也不影响各自使用。
          </div>
          <van-field
            v-model="newName"
            label="组名"
            placeholder="如：李家出租屋"
            maxlength="20"
            style="margin-top: 8px"
          />
          <div style="padding: 12px 4px 4px">
            <van-button round block type="primary" @click="createGroup">创建并生成邀请码</van-button>
          </div>
        </div>

        <div class="fdb-card">
          <div class="fdb-card-title"><span>加入家人的组</span></div>
          <van-field v-model="inviteCode" label="邀请码" placeholder="6 位" maxlength="6" style="margin-top: 8px" />
          <div style="padding: 12px 4px 4px">
            <van-button round block plain type="primary" @click="joinGroup">加入</van-button>
          </div>
        </div>
      </template>
    </template>

    <div style="height: 24px"></div>
  </div>
</template>

<style scoped>
.fg__count {
  font-size: 12px;
  color: #969799;
  font-weight: 400;
}
.fg__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f5f6f7;
}
.fg__row:last-child {
  border-bottom: none;
}
.fg__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--fdb-primary);
  color: #fff;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fg__name {
  font-size: 14px;
  color: #323233;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fg__code {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 10px;
  text-align: center;
  color: var(--fdb-primary);
  padding: 14px 0 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  user-select: all;
}
.fg__tip {
  font-size: 12px;
  color: #969799;
  line-height: 1.7;
}
</style>
