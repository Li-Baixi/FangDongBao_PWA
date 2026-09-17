/** 生成各尺寸应用图标（node scripts/gen-icons.js） */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const svg = fs.readFileSync(path.join(here, 'icon.svg'))
const outDir = path.join(here, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const t of targets) {
  await sharp(svg).resize(t.size, t.size).png().toFile(path.join(outDir, t.name))
  console.log('生成', t.name)
}
// favicon 用 SVG 原图
fs.copyFileSync(path.join(here, 'icon.svg'), path.join(outDir, 'icon.svg'))
console.log('生成 icon.svg')

// maskable：背景满幅渐变、圆角会被系统裁圆，此图本身适配
await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, 'maskable-512.png'))
console.log('生成 maskable-512.png')
console.log('全部图标生成完毕 ->', outDir)
