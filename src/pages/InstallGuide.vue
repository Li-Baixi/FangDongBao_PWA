<script setup>
/** 安装到手机桌面 + 开通知 的图文步骤（安卓/iPhone 分别说明） */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const tab = ref('android')
</script>

<template>
  <div class="fdb-page guide">
    <van-nav-bar title="装到手机 & 开提醒" left-arrow @click-left="router.back()" />

    <div class="fdb-card">
      <van-tabs v-model:active="tab">
        <van-tab title="安卓手机" name="android">
          <div class="guide__step">
            <div class="guide__n">1</div>
            <div>用 <b>Chrome 浏览器</b>（或小米/华为/三星浏览器）打开房东宝的网址，登录自己的账号。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">2</div>
            <div>点浏览器右上角「⋮」三个点，找到「<b>添加到主屏幕</b>」或「安装应用」，点确认。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">3</div>
            <div>桌面会出现「房东宝」图标，以后从桌面打开，和普通 App 一样，没有浏览器地址栏。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">4</div>
            <div>开提醒：打开应用 →「我的」→「收租推送提醒」，允许通知。首次开启后建议<b>完全关掉应用再重开一次</b>。</div>
          </div>
          <div class="guide__note">
            ⚠️ 如果收不到提醒：手机设置 → 应用 → Chrome → 通知，确认允许；并确认浏览器没被手机管家"省电冻结"。
          </div>
        </van-tab>

        <van-tab title="iPhone" name="ios">
          <div class="guide__step">
            <div class="guide__n">1</div>
            <div>用 <b>Safari 浏览器</b>打开房东宝的网址，登录自己的账号（必须 Safari，微信里打开不行）。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">2</div>
            <div>点 Safari 底部中间的「<b>分享</b>」按钮（一个带箭头的方框），往上滑找到「<b>添加到主屏幕</b>」，点"添加"。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">3</div>
            <div>桌面出现「房东宝」图标，以后从桌面打开使用。</div>
          </div>
          <div class="guide__step">
            <div class="guide__n">4</div>
            <div>开提醒（需要 iOS 16.4 以上）：<b>必须从桌面图标打开</b>应用 →「我的」→「收租推送提醒」→ 允许。<br />
            开启后还要去 <b> iPhone 设置 → 通知 → 房东宝</b> 里允许通知。</div>
          </div>
          <div class="guide__note">
            ⚠️ iPhone 的规则：只有"添加到主屏幕"后，网页应用才有资格发通知；从 Safari 网页里是开不了的。
          </div>
        </van-tab>
      </van-tabs>
    </div>

    <div class="fdb-card">
      <div class="fdb-card-title"><span>日常怎么用（给家人的三句话）</span></div>
      <div class="guide__usage">
        <p>1️⃣ 到收租日，打开房东宝，首页会显示"今天该收租"的人，点「去收租」。</p>
        <p>2️⃣ 拍电表水表照片、看表输入数字，账单自动算好，核对一下点确认。</p>
        <p>3️⃣ 对方给了多少钱就记多少，分几次给就分几次记，系统自己算还差多少。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide__step {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  font-size: 14px;
  color: #323233;
  line-height: 1.7;
}
.guide__n {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--fdb-primary);
  color: #fff;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.guide__note {
  margin-top: 8px;
  background: #fff8e8;
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  color: #b26a00;
  line-height: 1.6;
}
.guide__usage p {
  font-size: 13px;
  color: #323233;
  line-height: 1.8;
  margin: 4px 0;
}
</style>
