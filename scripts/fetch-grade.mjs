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

  console.log('📊 直接在页面中请求成绩数据...\n')

  const result = await jwPage.evaluate(async () => {
    // 构造查询参数（最近两学期，有效成绩）
    const querySetting = JSON.stringify([
      { name: "XNXQDM", value: "2025-2026-1,2025-2026-2", linkOpt: "and", builder: "m_value_equal" },
      { name: "SFYX", caption: "是否有效", linkOpt: "AND", builderList: "cbl_m_List", builder: "m_value_equal", value: "1", value_display: "是" },
      { name: "SHOWMAXCJ", caption: "显示最高成绩", linkOpt: "AND", builderList: "cbl_m_List", builder: "m_value_equal", value: "0", value_display: "否" }
    ])

    const body = `querySetting=${encodeURIComponent(querySetting)}&*order=-XNXQDM,-KCH,-KXH&pageSize=100&pageNumber=1`

    const res = await fetch('/jwapp/sys/cjcx/modules/cjcx/xscjcx.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    })

    const text = await res.text()
    return { status: res.status, body: text }
  })

  if (result.status === 200) {
    try {
      const json = JSON.parse(result.body)
      const rows = json.datas?.xscjcx?.rows || []
      const total = json.datas?.xscjcx?.totalSize || 0

      console.log(`✅ 共 ${total} 条成绩，获取到 ${rows.length} 条\n`)

      // 保存完整数据
      writeFileSync('scripts/grade-data.json', JSON.stringify(rows, null, 2))
      console.log('✅ 完整数据已保存到 scripts/grade-data.json\n')

      // 打印表格
      console.log('学期                          | 课程名                    | 成绩    | 学分 | 绩点')
      console.log('-'.repeat(90))
      for (const r of rows) {
        const semester = (r.XNXQDM_DISPLAY || '').padEnd(25)
        const course = (r.KCMC || r.XSKCMC || '').substring(0, 20).padEnd(20)
        const grade = (r.XSZCJMC || r.ZCJ || 'N/A').toString().padEnd(6)
        const credit = (r.XF || '').toString().padEnd(4)
        const gpa = (r.JD || 'N/A').toString()
        console.log(`${semester} | ${course} | ${grade} | ${credit} | ${gpa}`)
      }

      // 打印第一条完整数据看字段名
      if (rows.length > 0) {
        console.log('\n📋 第一条数据的完整字段:')
        for (const [k, v] of Object.entries(rows[0])) {
          if (v !== null && v !== '' && v !== 0) {
            console.log(`  ${k}: ${v}`)
          }
        }
      }
    } catch (e) {
      console.log('解析失败:', e.message)
      console.log(result.body.substring(0, 1000))
    }
  } else {
    console.log(`❌ 请求失败: ${result.status}`)
    console.log(result.body.substring(0, 500))
  }
}

main().catch(console.error)
