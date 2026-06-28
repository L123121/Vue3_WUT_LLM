import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log('🔗 连接到 Edge...\n')

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })

  const pages = await browser.pages()
  console.log(`📑 打开了 ${pages.length} 个标签页:\n`)

  // 列出所有标签页
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i].url()
    const title = await pages[i].title()
    console.log(`  [${i}] ${title} → ${url}`)
  }

  // 找到教务系统的标签页
  const jwPage = pages.find(p => p.url().includes('jwxt.whut') || p.url().includes('jwapp'))
  if (!jwPage) {
    console.log('\n❌ 未找到教务系统标签页')
    return
  }

  console.log(`\n✅ 使用标签: ${jwPage.url()}\n`)

  // 收集所有请求（不限 .do）
  const allRequests = []

  jwPage.on('response', async (response) => {
    const url = response.url()
    // 过滤掉静态资源
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
        url.includes('.jpg') || url.includes('.ico') || url.includes('.woff') ||
        url.includes('.svg') || url.includes('.gif')) return

    try {
      const request = response.request()
      const contentType = response.headers()['content-type'] || ''
      const entry = {
        url,
        method: request.method(),
        postData: request.postData() || null,
        status: response.status(),
        contentType,
      }

      // 只记录有实际内容的请求
      if (contentType.includes('json') || contentType.includes('text') || url.includes('.do')) {
        const body = await response.text()
        entry.responsePreview = body.substring(0, 3000)
      }

      allRequests.push(entry)
      const shortUrl = url.replace('https://jwxt.whut.edu.cn', '')
      console.log(`📡 [${entry.method}] ${shortUrl}`)
    } catch {}
  })

  console.log('📋 开始监听...\n')
  console.log('请在 Edge 中操作：')
  console.log('  1. 点击"我的课表"')
  console.log('  2. 点击"考试安排"')
  console.log('')
  console.log('完成后回来告诉我\n')

  // 持续运行
  process.on('SIGINT', () => {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 共捕获 ${allRequests.length} 个请求`)
    console.log('='.repeat(60))

    if (allRequests.length > 0) {
      writeFileSync('scripts/api-calls.json', JSON.stringify(allRequests, null, 2))
      console.log('\n✅ 已保存到 scripts/api-calls.json\n')

      // 打印关键请求
      const keyRequests = allRequests.filter(r =>
        r.url.includes('.do') || r.contentType?.includes('json')
      )
      console.log(`📋 关键 API 请求 (${keyRequests.length} 个):\n`)
      for (const r of keyRequests) {
        console.log(`  [${r.method}] ${r.url}`)
        if (r.postData) console.log(`    POST: ${r.postData.substring(0, 500)}`)
        if (r.responsePreview) console.log(`    响应: ${r.responsePreview.substring(0, 500)}`)
        console.log('')
      }
    }

    process.exit(0)
  })

  await new Promise(() => {})
}

main().catch(e => {
  console.error('错误:', e.message)
  process.exit(1)
})
