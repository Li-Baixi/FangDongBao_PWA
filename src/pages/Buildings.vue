<script setup>
/** 楼栋管理：增删改名（每个用户一般一栋，够用就好） */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import repo from '@/db/repo'
import { useSessionStore } from '@/stores/session'
import { useDataStore, inScope } from '@/stores/data'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const showForm = ref(false)
const editId = ref(null)
const name = ref('')
const address = ref('')

const list = computed(() => data.buildings.filter((b) => inScope(b, session)))

function openNew() {
  editId.value = null
  name.value = ''
  address.value = ''
  showForm.value = true
}
function openEdit(b) {
  editId.value = b.id
  name.value = b.name
  address.value = b.address || ''
  showForm.value = true
}

async function save() {
  if (!name.value.trim()) return showToast('请填写楼栋名称')
  await repo.saveBuilding({
    id: editId.value || undefined,
    ownerId: session.current?.id,
    name: name.value.trim(),
    address: address.value.trim() || null,
  })
  showForm.value = false
}

async function remove(b) {
  const count = data.tenants.filter((t) => t.buildingId === b.id && t.status === 'active').length
  try {
    await showConfirmDialog({
      title: `删除“${b.name}”？`,
      message: count ? `还有 ${count} 户在租租客挂在这栋楼，删除后他们会变成"未分组"。` : '历史账单不受影响。',
    })
  } catch {
    return
  }
  await repo.deleteBuilding(b.id)
}
</script>

<template>
  <div class="fdb-page">
    <van-nav-bar title="楼栋管理" left-arrow @click-left="router.back()">
      <template #right>
        <van-icon name="plus" size="20" color="#0f766e" @click="openNew" />
      </template>
    </van-nav-bar>

    <div class="fdb-card" v-if="list.length">
      <div class="bld__row" v-for="b in list" :key="b.id">
        <div>
          <div class="bld__name">🏢 {{ b.name }}</div>
          <div class="bld__sub" v-if="b.address">{{ b.address }}</div>
        </div>
        <div>
          <van-icon name="edit" color="#969799" size="16" style="margin-right: 12px" @click="openEdit(b)" />
          <van-icon name="delete-o" color="#ee0a24" size="16" @click="remove(b)" />
        </div>
      </div>
    </div>
    <div class="fdb-card" v-else>
      <div class="fdb-empty">还没有楼栋，点右上角 + 添加</div>
    </div>

    <van-dialog
      v-model:show="showForm"
      :title="editId ? '编辑楼栋' : '添加楼栋'"
      show-cancel-button
      @confirm="save"
    >
      <van-field v-model="name" label="名称" placeholder="如：东街 3 号楼" />
      <van-field v-model="address" label="地址" placeholder="选填" />
    </van-dialog>
  </div>
</template>

<style scoped>
.bld__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f5f6f7;
}
.bld__row:last-child {
  border-bottom: none;
}
.bld__name {
  font-size: 15px;
  color: #323233;
}
.bld__sub {
  font-size: 12px;
  color: #969799;
  margin-top: 2px;
}
</style>
