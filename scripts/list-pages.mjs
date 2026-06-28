import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })

  const pages = await browser.pages()
  console.log(`📑 共 ${pages.length} 个标签页:\n`)

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const url = p.url()
    const title = await p.title()

    console.log(`[${i}] ${title}`)
    console.log(`    URL: ${url}`)

    // 如果是教务系统页面，尝试获取内容
    if (url.includes('jwxt.whut') || url.includes('jwapp')) {
      const data = await p.evaluate(() => {
        return {
          bodyText: document.body?.innerText?.substring(0, 500) || '',
          iframes: [...document.querySelectorAll('iframe')].map(f => ({
            src: f.src,
            id: f.id,
            name: f.name,
          })),
        }
      })
      console.log(`    内容: ${data.bodyText.substring(0, 200)}`)
      if (data.iframes.length > 0) {
        console.log(`    iframe: ${JSON.stringify(data.iframes)}`)
      }
    }
    console.log('')
  }

  // 检查是否有成绩相关的页面
  const gradePage = pages.find(async p => {
    const url = p.url()
    const title = await p.title()
    return url.includes('cj') || url.includes('grade') ||
           title.includes('成绩') || title.includes('cj')
  })

  if (gradePage) {
    console.log(`\n📊 找到成绩页面: ${gradePage.url()}`)
  }
}

main().catch(console.error)
