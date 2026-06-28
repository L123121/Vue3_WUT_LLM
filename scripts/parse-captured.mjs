import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'fs'

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  })

  const pages = await browser.pages()
  const jwPage = pages.find(p => p.url().includes('homeapp'))
  if (!jwPage) { console.log('❌ 未找到教务页面'); return }

  console.log('📊 直接请求课表和考试 API...\n')

  // 1. 查询学生课表
  console.log('=== 1. 学生课表 ===\n')
  const scheduleResult = await jwPage.evaluate(async () => {
    const res = await fetch('/jwapp/sys/kcbcxby/modules/xskcb/cxxskcb.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'XNXQDM=2025-2026-2&XH=1024002524'
    })
    return await res.text()
  })

  try {
    const json = JSON.parse(scheduleResult)
    const rows = json.datas?.cxxskcb?.rows || []
    console.log(`✅ 课表数据: ${rows.length} 条\n`)

    if (rows.length > 0) {
      // 打印第一条看字段
      console.log('第一条数据字段:')
      for (const [k, v] of Object.entries(rows[0])) {
        if (v !== null && v !== '' && v !== 0) {
          console.log(`  ${k}: ${v}`)
        }
      }

      // 保存完整数据
      writeFileSync('scripts/schedule-data.json', JSON.stringify(rows, null, 2))
      console.log('\n✅ 课表数据已保存到 scripts/schedule-data.json')
    }
  } catch (e) {
    console.log('解析失败:', e.message)
    console.log(scheduleResult.substring(0, 500))
  }

  // 2. 查询考试安排
  console.log('\n\n=== 2. 考试安排 ===\n')
  const examResult = await jwPage.evaluate(async () => {
    const res = await fetch('/jwapp/sys/wdkwapp/api/wdks/queryMyExamArrangeMent.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'XNXQDM=2025-2026-2'
    })
    return await res.text()
  })

  try {
    const json = JSON.parse(examResult)
    const rows = json.datas?.queryMyExamArrangeMent?.rows || json.datas?.rows || []
    console.log(`✅ 考试数据: ${rows.length} 条\n`)

    if (rows.length > 0) {
      console.log('第一条数据字段:')
      for (const [k, v] of Object.entries(rows[0])) {
        if (v !== null && v !== '' && v !== 0) {
          console.log(`  ${k}: ${v}`)
        }
      }

      writeFileSync('scripts/exam-data.json', JSON.stringify(rows, null, 2))
      console.log('\n✅ 考试数据已保存到 scripts/exam-data.json')
    } else {
      console.log('无考试数据，打印原始响应:')
      console.log(examResult.substring(0, 1000))
    }
  } catch (e) {
    console.log('解析失败:', e.message)
    console.log(examResult.substring(0, 500))
  }

  // 3. 查询当前周次
  console.log('\n\n=== 3. 当前周次 ===\n')
  const weekResult = await jwPage.evaluate(async () => {
    const res = await fetch('/jwapp/sys/kcbcxby/modules/bjkcb/dqzc.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'XN=2025-2026&XQ=2&RQ=2026-6-24'
    })
    return await res.text()
  })

  try {
    const json = JSON.parse(weekResult)
    console.log('周次数据:', JSON.stringify(json, null, 2))
  } catch (e) {
    console.log(weekResult.substring(0, 500))
  }

  console.log('\n\n完成！')
}

main().catch(console.error)
