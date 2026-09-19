import { defineStore } from 'pinia'
import repo from '@/db/repo'
import { supabase, cloudEnabled } from '@/db/supabase'
import { initialSync, pullAll, flushOutbox } from '@/db/sync'
import { db } from '@/db/dexie'
import { uid, nowTs } from '@/utils/id'

/**
 * 会话：当前用谁的档案在看数据。
 * - 本地模式：应用内多档案（可选 PIN 密码），第一个创建的档案即管理员。
 * - 云模式：邮箱密码登录 Supabase，每人一个账号；第一个注册的自动成为管理员。
 * viewing：管理员可切换查看范围 —— 'self' 自己 / 'all' 全部 / 某位用户的 landlordId。
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    ready: false,
    mode: cloudEnabled ? 'cloud' : 'local',
    current: null, // 当前房东档案
    cloudUser: null, // 云模式登录用户
    viewing: 'self',
    pendingSync: 0,
    lastError: '',
  }),
  getters: {
    isAdmin: (s) => s.current?.role === 'admin',
    isCloud: (s) => s.mode === 'cloud',
  },
  actions: {
    async init() {
      if (this._initPromise) return this._initPromise
      this._initPromise = this._doInit()
      return this._initPromise
    },
    async _doInit() {
      try {
        if (cloudEnabled) {
          const { data } = await supabase.auth.getSession()
          this.cloudUser = data?.session?.user || null
          if (this.cloudUser) {
            await this.ensureLandlordRow()
            await this.loadCurrent()
            // 首次同步放后台跑，不阻塞打开速度（本地 Dexie 里已有缓存数据）
            initialSync()
              .then(() => this.refreshPending())
              .catch((e) => {
                this.lastError = `云同步暂不可用（${e.message || e}），稍后自动重试`
              })
          }
        } else {
          await this.loadCurrent()
        }
      } catch (e) {
        this.lastError = e.message || String(e)
      }
      this.ready = true
      await this.refreshPending()
      // 联网/回到前台时自动同步
      window.addEventListener('online', () => this.backgroundSync())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.backgroundSync()
      })
    },

    async loadCurrent() {
      const id = await repo.getSessionLandlordId()
      if (id) {
        this.current = (await repo.listLandlords()).find((l) => l.id === id) || null
      }
    },

    async backgroundSync() {
      if (!cloudEnabled || !this.cloudUser) return
      try {
        await flushOutbox()
        await pullAll(false)
        await this.refreshPending()
      } catch {
        /* 离线等场景静默失败，下次再试 */
      }
    },

    async refreshPending() {
      this.pendingSync = await repo.getPendingSyncCount()
    },

    /** 云模式：首次登录自动创建房东档案（第一个注册的是管理员） */
    async ensureLandlordRow() {
      if (!this.cloudUser) return
      const { data, error } = await supabase
        .from('landlords')
        .select('*')
        .eq('authUid', this.cloudUser.id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (data) {
        await db.landlords.put(data)
        await repo.setSessionLandlordId(data.id)
        return
      }
      const { count } = await supabase.from('landlords').select('id', { count: 'exact', head: true })
      const row = {
        id: uid(),
        name: (this.cloudUser.email || '成员').split('@')[0],
        role: (count ?? 0) === 0 ? 'admin' : 'member',
        authUid: this.cloudUser.id,
        prefs: {},
        createdAt: nowTs(),
        updatedAt: nowTs(),
      }
      const { error: e2 } = await supabase.from('landlords').insert(row)
      if (e2 && e2.code !== '23505') throw new Error(e2.message)
      await db.landlords.put(row)
      await repo.setSessionLandlordId(row.id)
      await this.loadCurrent()
    },

    // ---------- 云模式 ----------
    async cloudSignup(email, password, name) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw new Error(error.message)
      return data
    },
    async cloudLogin(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      this.cloudUser = data.user
      this.lastError = ''
      await this.ensureLandlordRow()
      await this.loadCurrent()
      try {
        await initialSync()
      } catch (e) {
        this.lastError = `登录成功，但云同步暂不可用（${e.message}）`
      }
      await this.refreshPending()
    },
    async cloudLogout() {
      await supabase.auth.signOut()
      this.cloudUser = null
      this.current = null
      this.viewing = 'self'
      await repo.setSessionLandlordId(null)
    },

    // ---------- 本地模式 ----------
    async localCreateProfile(name, pin) {
      const list = await repo.listLandlords()
      const isFirst = list.length === 0
      let pinHash = null
      let pinSalt = null
      if (pin) {
        const h = await repo.hashPin(pin)
        pinHash = h.hash
        pinSalt = h.salt
      }
      const l = await repo.saveLandlord({
        id: uid(),
        name,
        role: isFirst ? 'admin' : 'member',
        pinHash,
        pinSalt,
        prefs: {},
      })
      await repo.setSessionLandlordId(l.id)
      this.current = l
      this.viewing = 'self'
    },
    async localSwitch(id, pin) {
      const l = (await repo.listLandlords()).find((x) => x.id === id)
      if (!l) throw new Error('档案不存在')
      if (!(await repo.verifyPin(l, pin))) throw new Error('密码不对，请重试')
      await repo.setSessionLandlordId(id)
      this.current = l
      this.viewing = 'self'
    },
    async localSignOut() {
      await repo.setSessionLandlordId(null)
      this.current = null
      this.viewing = 'self'
    },

    setViewing(v) {
      this.viewing = v
    },

    /**
     * 注销账号（危险操作，入口在"我的"页，带双重确认+身份验证）：
     * - 云模式：清空云端自己的全部数据 -> 调 Edge Function 删除登录账号 -> 清本机
     * - 本地模式：物理删除本机该档案的全部数据
     * 密码校验由入口页面先做，这里只管删。
     */
    async deleteAccount() {
      if (!this.current) return
      const ownerId = this.current.id
      if (cloudEnabled && this.cloudUser) {
        // 1. 清云端数据（RLS 只允许删自己的）
        for (const t of ['buildings', 'tenants', 'meterReadings', 'bills', 'payments']) {
          await supabase.from(t).delete().eq('ownerId', ownerId)
        }
        await supabase.from('landlords').delete().eq('id', ownerId)
        // 2. 删除登录账号本体（需要 service key，走 Edge Function）
        const { data: sess } = await supabase.auth.getSession()
        const token = sess?.session?.access_token
        let accountRemoved = false
        try {
          const { data: cfg } = await supabase.functions.invoke('delete-account', {
            headers: { Authorization: `Bearer ${token}` },
          })
          accountRemoved = !cfg?.error
        } catch {
          accountRemoved = false
        }
        // 3. 清本机并登出
        await repo.purgeLocalData(ownerId)
        await repo.setSessionLandlordId(null)
        await supabase.auth.signOut()
        this.current = null
        this.cloudUser = null
        this.viewing = 'self'
        if (!accountRemoved) {
          throw new Error('本机与云端数据已清空；登录账号删除服务未部署，账号名保留（不影响安全，密码也只你有）')
        }
      } else {
        await repo.purgeLocalData(ownerId)
        await repo.setSessionLandlordId(null)
        this.current = null
        this.viewing = 'self'
      }
    },
  },
})
