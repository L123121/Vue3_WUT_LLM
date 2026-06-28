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

  // 找到教务系统主页（Tab 5）
  const jwPage = pages.find(p =>
    p.url().includes('jwxt.whut') &&
    p.url().includes('homeapp')
  )

  if (!jwPage) {
    console.log('❌ 未找到教务系统页面')
    return
  }

  console.log(`✅ 教务主页: ${jwPage.url()}\n`)

  // 方法 1: 在主页中找到 iframe 并操作
  console.log('📊 方法 1: 通过 iframe 操作...\n')

  const iframeData = await jwPage.evaluate(async () => {
    const iframes = document.querySelectorAll('iframe')
    const results = []

    for (const iframe of iframes) {
      try {
        // 尝试访问 iframe 内容
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
        const iframeWin = iframe.contentWindow

        results.push({
          src: iframe.src,
          title: iframeDoc.title,
          bodyText: iframeDoc.body?.innerText?.substring(0, 2000) || '',
          // 尝试获取 iframe 中的数据
          url: iframeWin.location.href,
        })
      } catch (e) {
        results.push({
          src: iframe.src,
          error: e.message,
        })
      }
    }
    return results
  })

  console.log('iframe 信息:')
  for (const data of iframeData) {
    console.log(`  src: ${data.src}`)
    if (data.title) console.log(`  title: ${data.title}`)
    if (data.bodyText) console.log(`  内容: ${data.bodyText.substring(0, 500)}`)
    if (data.error) console.log(`  错误: ${data.error}`)
    console.log('')
  }

  // 方法 2: 在 iframe 内执行 fetch 请求
  console.log('📊 方法 2: 在 iframe 内请求成绩 API...\n')

  const gradeResult = await jwPage.evaluate(async () => {
    const iframe = document.querySelector('iframe[src*="cjcx"]')
    if (!iframe) return { error: '未找到成绩 iframe' }

    try {
      const iframeWin = iframe.contentWindow

      // 尝试在 iframe 中发请求
      const urls = [
        '/jwapp/sys/cjcx/api/cjcx/queryCjByXnAndXq.do',
        '/jwapp/sys/cjcx/api/cjcx/queryXscjcx.do',
        '/jwapp/sys/cjcx/api/xscjcx/queryXscjcx.do',
        '/jwapp/sys/cjcxapp/api/cjcx/queryCjByXnAndXq.do',
      ]

      const results = []
      for (const url of urls) {
        try {
          const res = await iframeWin.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: 'XNXQDM=&JXB_ID=&queryModel.showCount=50',
          })
          const text = await res.text()
          results.push({
            url,
            status: res.status,
            body: text.substring(0, 2000),
            isJson: text.startsWith('{') || text.startsWith('['),
          })
        } catch (e) {
          results.push({ url, error: e.message })
        }
      }
      return results
    } catch (e) {
      return { error: e.message }
    }
  })

  if (gradeResult.error) {
    console.log(`错误: ${gradeResult.error}\n`)
  } else {
    for (const r of gradeResult) {
      console.log(`[${r.status || 'ERR'}] ${r.url}`)
      if (r.isJson) {
        console.log(`  JSON 响应: ${r.body.substring(0, 500)}`)
      } else if (r.body) {
        console.log(`  响应: ${r.body.substring(0, 200)}`)
      }
      if (r.error) console.log(`  错误: ${r.error}`)
      console.log('')
    }
  }

  // 方法 3: 拦截 iframe 中的新请求
  console.log('📊 方法 3: 刷新 iframe 并拦截请求...\n')

  const capturedRequests = []

  // 监听所有响应（包括 iframe）
  jwPage.on('response', async (response) => {
    const url = response.url()
    if (url.includes('cjcx') || url.includes('grade')) {
      try {
        const request = response.request()
        const body = await response.text()
        capturedRequests.push({
          url,
          method: request.method(),
          postData: request.postData() || null,
          status: response.status(),
          body: body.substring(0, 3000),
        })
        console.log(`📡 [${request.method()}] ${url}`)
        console.log(`   状态: ${response.status()}`)
        console.log(`   响应: ${body.substring(0, 300)}\n`)
      } catch {}
    }
  })

  // 刷新 iframe
  console.log('正在刷新成绩 iframe...\n')
  await jwPage.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="cjcx"]')
    if (iframe) {
      iframe.src = iframe.src  // 刷新 iframe
    }
  })

  await sleep(5000)

  // 方法 4: 直接在新标签页打开成绩 URL
  console.log('\n📊 方法 4: 新标签页打开成绩页面...\n')

  const cjcxUrl = iframeData.find(d => d.src?.includes('cjcx'))?.src
  if (cjcxUrl) {
    console.log(`打开: ${cjcxUrl}\n`)

    const newPage = await browser.newPage()

    // 拦截新页面的所有请求
    newPage.on('response', async (response) => {
      const url = response.url()
      if (url.includes('.do') || url.includes('/api/')) {
        try {
          const request = response.request()
          const body = await response.text()
          capturedRequests.push({
            url,
            method: request.method(),
            postData: request.postData() || null,
            status: response.status(),
            body: body.substring(0, 3000),
          })
          console.log(`📡 [${request.method()}] ${url}`)
          console.log(`   参数: ${request.postData() || '无'}`)
          console.log(`   响应: ${body.substring(0, 500)}\n`)
        } catch {}
      }
    })

    await newPage.goto(cjcxUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    console.log(`✅ 新页面已打开: ${newPage.url()}\n`)

    // 等待页面加载
    await sleep(3000)

    // 尝试在新页面中发请求
    const newPageResult = await newPage.evaluate(async () => {
      const urls = [
        '/jwapp/sys/cjcx/api/cjcx/queryCjByXnAndXq.do',
        '/jwapp/sys/cjcx/api/cjcx/queryXscjcx.do',
      ]

      const results = []
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: 'XNXQDM=&JXB_ID=&queryModel.showCount=50',
          })
          const text = await res.text()
          results.push({ url, status: res.status, body: text.substring(0, 3000) })
        } catch (e) {
          results.push({ url, error: e.message })
        }
      }
      return results
    })

    for (const r of newPageResult) {
      console.log(`[${r.status || 'ERR'}] ${r.url}`)
      if (r.body) {
        try {
          const json = JSON.parse(r.body)
          console.log(`  ✅ JSON 数据:`, JSON.stringify(json, null, 2).substring(0, 1000))
        } catch {
          console.log(`  响应: ${r.body.substring(0, 300)}`)
        }
      }
      if (r.error) console.log(`  错误: ${r.error}`)
      console.log('')
    }
  }

  // 保存所有结果
  writeFileSync('scripts/grade-api.json', JSON.stringify(capturedRequests, null, 2))
  console.log(`\n✅ 共捕获 ${capturedRequests.length} 个请求，已保存到 scripts/grade-api.json`)
}

main().catch(e => {
  console.error('错误:', e.message)
  process.exit(1)
})
