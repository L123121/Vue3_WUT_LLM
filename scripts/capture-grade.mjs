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

  // 找到教务系统页面
  const jwPage = pages.find(p =>
    p.url().includes('jwxt.whut') || p.url().includes('jwapp')
  )

  if (!jwPage) {
    console.log('❌ 未找到教务系统页面')
    return
  }

  console.log(`✅ 页面: ${jwPage.url()}\n`)

  // 拦截后续所有请求
  const captured = []
  jwPage.on('response', async (response) => {
    const url = response.url()
    if (url.includes('.do') || url.includes('/api/')) {
      try {
        const request = response.request()
        const body = await response.text()
        captured.push({
          url,
          method: request.method(),
          postData: request.postData() || null,
          status: response.status(),
          headers: request.headers(),
          body: body.substring(0, 3000),
        })
        console.log(`📡 [${request.method()}] ${url}`)
        console.log(`   状态: ${response.status()}`)
        if (request.postData()) console.log(`   参数: ${request.postData()}`)
        console.log(`   响应: ${body.substring(0, 300)}\n`)
      } catch {}
    }
  })

  // 同时尝试从当前页面获取成绩数据
  console.log('📊 尝试从当前页面获取成绩数据...\n')

  const pageData = await jwPage.evaluate(() => {
    // 检查页面中是否有成绩数据（可能是 Vue/React 渲染的）
    const results = {
      url: window.location.href,
      title: document.title,
      // 检查 localStorage 中是否有数据
      localStorage: {},
      // 检查页面文本内容
      bodyText: document.body?.innerText?.substring(0, 3000) || '',
      // 检查是否有 iframe
      iframes: [...document.querySelectorAll('iframe')].map(f => f.src),
    }

    // 检查 localStorage 中的成绩相关数据
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key.includes('cj') || key.includes('grade') || key.includes('score') ||
          key.includes('cjd') || key.includes('xscj')) {
        results.localStorage[key] = localStorage.getItem(key)?.substring(0, 1000)
      }
    }

    // 检查 sessionStorage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key.includes('cj') || key.includes('grade') || key.includes('score')) {
        results.localStorage[`session:${key}`] = sessionStorage.getItem(key)?.substring(0, 1000)
      }
    }

    return results
  })

  console.log(`📍 当前 URL: ${pageData.url}`)
  console.log(`📄 标题: ${pageData.title}\n`)

  if (Object.keys(pageData.localStorage).length > 0) {
    console.log('💾 找到本地存储数据:')
    for (const [k, v] of Object.entries(pageData.localStorage)) {
      console.log(`  ${k}: ${v}`)
    }
    console.log('')
  }

  if (pageData.iframes.length > 0) {
    console.log(`🖼️ 发现 ${pageData.iframes.length} 个 iframe:`)
    for (const src of pageData.iframes) {
      console.log(`  ${src}`)
    }
    console.log('')
  }

  // 打印页面文本摘要
  console.log('📝 页面内容摘要:')
  console.log(pageData.bodyText.substring(0, 1500))
  console.log('...')

  // 保存结果
  writeFileSync('scripts/grade-page-data.json', JSON.stringify({
    pageData,
    capturedRequests: captured,
  }, null, 2))

  console.log(`\n✅ 数据已保存到 scripts/grade-page-data.json`)

  if (captured.length > 0) {
    console.log(`\n📡 共捕获 ${captured.length} 个 API 请求`)
  } else {
    console.log('\n💡 未捕获到新请求，请在 Edge 中刷新成绩页面')
  }
}

main().catch(e => {
  console.error('错误:', e.message)
  process.exit(1)
})
