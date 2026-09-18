import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { RELEASE_NOTES } from './src/release-notes.js'

// GitHub Pages 部署在 https://li-baixi.github.io/FangDongBao_PWA/ 子路径下
const BASE = '/FangDongBao_PWA/'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// 构建时把版本信息写成 version.json（不进 SW 预缓存，应用内更新检查用）
function versionJsonPlugin() {
  return {
    name: 'write-version-json',
    closeBundle() {
      const dir = fileURLToPath(new URL('./dist', import.meta.url))
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'version.json'),
        JSON.stringify(
          {
            version: pkg.version,
            buildTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
            notes: RELEASE_NOTES[pkg.version] || '',
            // 带上全部历史更新说明：落后多个版本的用户一次看全跳过了什么
            history: RELEASE_NOTES,
          },
          null,
          2
        )
      )
    },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [
    versionJsonPlugin(),
    vue(),
    // 把 tesseract.js 的离线识别资源复制到 dist/ocr/（自托管，不依赖 CDN）
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/tesseract.js/dist/worker.min.js',
          dest: 'ocr',
          rename: { name: 'worker.min.js', stripBase: true },
        },
        {
          src: 'node_modules/tesseract.js-core/*',
          dest: 'ocr/core',
          rename: { stripBase: true },
        },
      ],
    }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      manifest: {
        name: '房东宝 · 收租管理',
        short_name: '房东宝',
        description: '家庭房屋收租管理：抄表拍照、自动算费、分次收款、逾期提醒、年度统计',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f8fa',
        theme_color: '#0f766e',
        lang: 'zh-CN',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 排除 OCR 大文件（wasm/字库约 10MB+），它们走运行时缓存：用过一次后离线可用
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    // 构建时注入版本信息，"我的"页展示，用来判断线上跑的是不是最新版
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    ),
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
