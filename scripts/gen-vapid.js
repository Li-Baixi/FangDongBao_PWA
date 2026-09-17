/** 生成推送通知的 VAPID 密钥对（只需运行一次）：npm run gen:vapid */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log('=== 推送密钥已生成（妥善保存，别截图发群里）===')
console.log('')
console.log('【公钥】放到两处：')
console.log('  1. 项目根目录 .env 文件里：VITE_VAPID_PUBLIC_KEY=' + publicKey)
console.log('  2. GitHub 仓库 Secrets 里：VITE_VAPID_PUBLIC_KEY')
console.log('  3. Supabase secrets 里：VAPID_PUBLIC_KEY（部署 Edge Function 时用）')
console.log('')
console.log('【私钥】只放 Supabase secrets（supabase secrets set VAPID_PRIVATE_KEY=...）：')
console.log('  ' + privateKey)
console.log('')
console.log('私钥绝不放进 .env / GitHub，谁拿到私钥谁就能给你的手机发通知。')
