import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log('🔗 连接 Edge...\n')

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })

  const pages = await browser.pages()
  console.log(`📑 共 ${pages.length} 个标签页\n`)

  // 找到教务系统主页
  const jwPage = pages.find(p =>
    p.url().includes('homeapp') || p.url().includes('jwapp')
  )

  if (!jwPage) {
    console.log('❌ 未找到教务系统页面')
    return
  }

  console.log(`✅ 教务主页: ${jwPage.url()}\n`)

  // 收集所有请求
  const allRequests = []

  // 监听所有响应
  jwPage.on('response', async (response) => {
    const url = response.url()
    // 过滤静态资源
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
        url.includes('.jpg') || url.includes('.ico') || url.includes('.woff') ||
        url.includes('.svg') || url.includes('.gif') || url.includes('favicon')) return

    try {
      const request = response.request()
      const entry = {
        url,
        method: request.method(),
        postData: request.postData() || null,
        status: response.status(),
      }

      // 只记录 API 请求
      if (url.includes('.do') || url.includes('/api/')) {
        const body = await response.text()
        entry.body = body
        entry.bodyLength = body.length
        allRequests.push(entry)

        const shortUrl = url.replace('https://jwxt.whut.edu.cn', '')
        console.log(`📡 [${entry.method}] ${shortUrl}`)
        if (entry.postData) {
          console.log(`   参数: ${entry.postData.substring(0, 300)}`)
        }
        console.log(`   状态: ${entry.status} | 长度: ${body.length}`)
        console.log('')
      }
    } catch {}
  })

  console.log('📋 开始监听 API 请求...\n')
  console.log('请在 Edge 中依次操作：')
  console.log('  1. 点击"我的课表" 或 "课程表"')
  console.log('  2. 等页面加载完成')
  console.log('  3. 点击"考试安排" 或 "考试查询"')
  console.log('  4. 等页面加载完成')
  console.log('')
  console.log('操作完成后告诉我，我会自动保存结果\n')
  console.log('='.repeat(60) + '\n')

  // 定期打印状态
  let lastCount = 0
  const statusInterval = setInterval(() => {
    if (allRequests.length > lastCount) {
      console.log(`\n📊 已捕获 ${allRequests.length} 个 API 请求\n`)
      lastCount = allRequests.length
    }
  }, 5000)

  // 等待用户操作（10 分钟超时）
  await sleep(600000)

  clearInterval(statusInterval)
  saveResults(allRequests)
}

function saveResults(requests) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 共捕获 ${requests.length} 个 API 请求`)
  console.log('='.repeat(60))

  if (requests.length > 0) {
    writeFileSync('scripts/all-api-calls.json', JSON.stringify(requests, null, 2))
    console.log('\n✅ 已保存到 scripts/all-api-calls.json\n')

    // 按 URL 分类
    const categories = {}
    for (const r of requests) {
      const shortUrl = r.url.replace('https://jwxt.whut.edu.cn', '')
      const parts = shortUrl.split('/')
      const category = parts.slice(0, 5).join('/')
      if (!categories[category]) categories[category] = []
      categories[category].push(r)
    }

    console.log('📋 API 分类摘要:\n')
    for (const [cat, reqs] of Object.entries(categories)) {
      console.log(`  ${cat} (${reqs.length} 个)`)
      for (const r of reqs) {
        console.log(`    [${r.method}] ${r.url.split('?')[0]}`)
        if (r.postData) console.log(`      参数: ${r.postData.substring(0, 200)}`)
      }
      console.log('')
    }
  }
}

main().catch(console.error)
