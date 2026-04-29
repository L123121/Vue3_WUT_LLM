/**
 * 知识库文档导入脚本
 * 使用方法：node scripts/import-docs.js
 */

const fs = require('fs');
const path = require('path');

// API 地址
const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * 添加单个文档
 */
async function addDocument(doc) {
  try {
    const response = await fetch(`${API_URL}/api/rag/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });

    const result = await response.json();
    if (result.success) {
      console.log(`✅ 添加成功: ${doc.title}`);
      return result.data;
    } else {
      console.error(`❌ 添加失败: ${doc.title} - ${result.message}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ 请求失败: ${doc.title} - ${error.message}`);
    return null;
  }
}

/**
 * 批量添加文档
 */
async function addDocuments(docs) {
  console.log(`\n📚 开始导入 ${docs.length} 个文档...\n`);

  const results = [];
  for (const doc of docs) {
    const result = await addDocument(doc);
    results.push(result);
    // 添加延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const success = results.filter(r => r !== null).length;
  console.log(`\n🎉 导入完成: ${success}/${docs.length} 成功\n`);

  return results;
}

/**
 * 从 JSON 文件导入
 */
async function importFromFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ 文件不存在: ${absolutePath}`);
    return;
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const data = JSON.parse(content);

  const docs = Array.isArray(data) ? data : data.documents || [data];
  return addDocuments(docs);
}

/**
 * 从文本文件导入（每段用空行分隔）
 */
async function importFromTextFile(filePath, category = 'general') {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ 文件不存在: ${absolutePath}`);
    return;
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

  const docs = paragraphs.map((p, index) => ({
    title: `文档 ${index + 1}`,
    content: p.trim(),
    category
  }));

  return addDocuments(docs);
}

// 示例文档数据
const sampleDocs = [
  {
    title: "武汉理工大学简介",
    content: `武汉理工大学是教育部直属全国重点大学，是首批列入国家"211工程"和"双一流"建设高校，是教育部和交通运输部等部委共建高校。

学校现有马房山校区、余家头校区和南湖校区，占地4000余亩。设有25个学院，开设100余个本科专业，拥有博士后科研流动站17个，一级学科博士点22个，一级学科硕士点45个。`,
    category: "school_info"
  },
  {
    title: "计算机学院介绍",
    content: `武汉理工大学计算机科学与技术学院成立于2000年，是学校重点建设的学院之一。

学院现有计算机科学与技术、软件工程、物联网工程、数据科学与大数据技术4个本科专业。拥有计算机科学与技术一级学科博士点、博士后科研流动站。

主要研究方向：人工智能、大数据、云计算、网络安全、智能交通等。`,
    category: "cs_info"
  },
  {
    title: "图书馆服务",
    content: `武汉理工大学图书馆由马房山校区图书馆、余家头校区图书馆组成，总建筑面积约6万平方米。

开放时间：周一至周日 8:00-22:00（节假日除外）

服务内容：
- 图书借阅：本科生可借10册，借期30天
- 电子资源：可访问知网、万方、IEEE等数据库
- 自习室：各楼层设有自习区域
- 研讨室：可在线预约使用`,
    category: "library"
  },
  {
    title: "选课指南",
    content: `选课系统：教务管理系统 (jwxt.whut.edu.cn)

选课时间：
- 第一轮选课：学期第16-17周
- 第二轮选课：学期第18周
- 补退选：开学前两周

选课建议：
1. 优先选择必修课和专业核心课
2. 注意课程时间冲突
3. 通识选修课建议分散在不同学期
4. 关注课程容量和已选人数`,
    category: "academic"
  },
  {
    title: "实验室安全规范",
    content: `进入实验室必须遵守以下安全规范：

1. 必须经过安全培训并考核合格
2. 穿着实验服，长发需扎起
3. 了解实验室内安全设施位置（灭火器、洗眼器等）
4. 实验操作严格按照规程进行
5. 危险化学品使用需登记
6. 实验结束后清理台面，关闭水电
7. 发现安全隐患及时报告`,
    category: "safety"
  }
];

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'sample':
      // 导入示例文档
      await addDocuments(sampleDocs);
      break;

    case 'file':
      // 从 JSON 文件导入
      if (!args[1]) {
        console.log('用法: node import-docs.js file <文件路径>');
        return;
      }
      await importFromFile(args[1]);
      break;

    case 'text':
      // 从文本文件导入
      if (!args[1]) {
        console.log('用法: node import-docs.js text <文件路径> [分类]');
        return;
      }
      await importFromTextFile(args[1], args[2] || 'general');
      break;

    default:
      console.log(`
📚 知识库文档导入工具

用法:
  node import-docs.js sample         导入示例文档
  node import-docs.js file <路径>    从 JSON 文件导入
  node import-docs.js text <路径> [分类]  从文本文件导入

JSON 文件格式:
  [
    { "title": "标题", "content": "内容", "category": "分类" }
  ]

示例:
  node import-docs.js sample
  node import-docs.js file ./docs.json
  node import-docs.js text ./notes.txt school_info
      `);
  }
}

main().catch(console.error);
