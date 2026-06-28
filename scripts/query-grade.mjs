import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'
import https from 'https'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 忽略自签名证书
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

async function main() {
  console.log('🔗 连接 Edge 浏览器...\n')

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })

  const pages = await browser.pages()
  console.log(`📑 共 ${pages.length} 个标签页\n`)

  // 找到教务系统页面
  const jwPage = pages.find(p =>
    p.url().includes('jwxt.whut') || p.url().includes('jwapp')
  )

  if (!jwPage) {
    console.log('❌ 未找到教务系统页面，请在 Edge 中打开教务系统')
    return
  }

  console.log(`✅ 教务页面: ${jwPage.url()}\n`)

  // 提取所有 Cookie
  const cookies = await jwPage.cookies()
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  console.log(`🍪 提取到 ${cookies.length} 个 Cookie:`)
  for (const c of cookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 30)}...`)
  }

  // 保存 Cookie
  writeFileSync('scripts/jw-cookies.json', JSON.stringify(cookies, null, 2))
  console.log('\n✅ Cookie 已保存到 scripts/jw-cookies.json\n')

  // 尝试查询成绩 API
  console.log('📊 尝试查询成绩...\n')

  // 金智教务系统常见的成绩接口
  const gradeUrls = [
    'https://jwxt.whut.edu.cn/jwapp/sys/cjcx/api/cjcx/queryCjByXnAndXq.do',
    'https://jwxt.whut.edu.cn/jwapp/sys/cjcx/cjcx.do',
    'https://jwxt.whut.edu.cn/jwapp/sys/cjcxapp/cjcx/xscjcx.do',
  ]

  // 方法 1: 通过页面内 fetch 请求
  console.log('--- 方法 1: 页面内 fetch ---\n')
  try {
    const result = await jwPage.evaluate(async () => {
      // 尝试常见的成绩接口
      const urls = [
        '/jwapp/sys/cjcx/api/cjcx/queryCjByXnAndXq.do',
        '/jwapp/sys/cjcx/cjcx.do',
        '/jwapp/sys/cjcxapp/cjcx/xscjcx.do',
      ]

      const results = []
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'XNXQDM=&JXB_ID=',
          })
          const text = await res.text()
          results.push({ url, status: res.status, body: text.substring(0, 2000) })
        } catch (e) {
          results.push({ url, error: e.message })
        }
      }
      return results
    })

    for (const r of result) {
      console.log(`[${r.status || 'ERR'}] ${r.url}`)
      if (r.body) {
        console.log(`  响应: ${r.body.substring(0, 500)}`)
      }
      if (r.error) {
        console.log(`  错误: ${r.error}`)
      }
      console.log('')
    }
  } catch (e) {
    console.log(`fetch 方法失败: ${e.message}\n`)
  }

  // 方法 2: 拦截页面导航到成绩页面的请求
  console.log('--- 方法 2: 导航到成绩页面 ---\n')

  // 在页面中监听所有请求
  const capturedRequests = []
  jwPage.on('response', async (response) => {
    const url = response.url()
    if (url.includes('.do') || url.includes('/api/')) {
      try {
        const request = response.request()
        const body = await response.text()
        capturedRequests.push({
          url,
          method: request.method(),
          postData: request.postData() || null,
          body: body.substring(0, 2000),
        })
        console.log(`📡 捕获: ${url}`)
      } catch {}
    }
  })

  // 尝试在页面中点击成绩菜单
  console.log('正在尝试导航到成绩页面...\n')
  const clicked = await jwPage.evaluate(() => {
    const links = [...document.querySelectorAll('a, button, div, li, span')]
    const cjLink = links.find(el =>
      el.textContent.includes('成绩') ||
      el.textContent.includes('成绩查询')
    )
    if (cjLink) {
      cjLink.click()
      return cjLink.textContent.trim()
    }
    return null
  })

  if (clicked) {
    console.log(`✅ 点击了: "${clicked}"`)
    await sleep(5000)
  } else {
    console.log('⚠️ 未找到成绩菜单')
    console.log('请手动在 Edge 中点击"成绩查询"，然后告诉我\n')
  }

  // 保存结果
  if (capturedRequests.length > 0) {
    writeFileSync('scripts/grade-api.json', JSON.stringify(capturedRequests, null, 2))
    console.log(`\n✅ 捕获到 ${capturedRequests.length} 个请求，已保存到 scripts/grade-api.json`)
  }

  console.log('\n完成！请告诉我结果')
}

main().catch(e => {
  console.error('错误:', e.message)
  process.exit(1)
})
