/**
 * 列出当前知识库文档 ID，辅助填写 dataset/campus-qa.json 的 relevant_doc_ids
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkBackendHealth, listDocuments, loginForCookie, BACKEND_URL } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');

mkdirSync(RESULTS_DIR, { recursive: true });

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function groupByCategory(documents) {
  return documents.reduce((groups, doc) => {
    const category = doc.category || 'general';
    if (!groups[category]) groups[category] = [];
    groups[category].push(doc);
    return groups;
  }, {});
}

function buildMarkdown(documents) {
  const grouped = groupByCategory(documents);
  let markdown = '# RAG 知识库文档 ID 对照表\n\n';
  markdown += `> 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
  markdown += '把下表中的 `id` 填到 `scripts/rag-eval/dataset/campus-qa.json` 对应样本的 `relevant_doc_ids`。\n\n';

  for (const [category, docs] of Object.entries(grouped)) {
    markdown += `## ${category}\n\n`;
    markdown += '| id | title | chunks | vectorStatus | createdAt |\n';
    markdown += '| --- | --- | --- | --- | --- |\n';
    for (const doc of docs) {
      markdown += `| ${doc.id} | ${doc.title || '-'} | ${doc.chunkCount || 0} | ${doc.vectorStatus || '-'} | ${formatDate(doc.createdAt)} |\n`;
    }
    markdown += '\n';
  }

  return markdown;
}

export async function runListDocs() {
  console.log('\n========================================');
  console.log('  RAG 文档 ID 导出');
  console.log('========================================\n');

  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.error(`❌ 后端服务不可用：${BACKEND_URL}`);
    console.error('   请先启动后端，再运行本脚本');
    return null;
  }

  await loginForCookie();
  const documents = await listDocuments();

  if (!documents.length) {
    console.log('⚠️  当前知识库没有文档，请先到 /knowledge 上传或录入文档');
    return { documents: [] };
  }

  const grouped = groupByCategory(documents);
  for (const [category, docs] of Object.entries(grouped)) {
    console.log(`\n📁 ${category} (${docs.length})`);
    for (const doc of docs) {
      console.log(`  - ${doc.id} | ${doc.title || '-'} | chunks=${doc.chunkCount || 0} | status=${doc.vectorStatus || '-'}`);
    }
  }

  const jsonPath = resolve(RESULTS_DIR, 'doc-id-map.json');
  const mdPath = resolve(RESULTS_DIR, 'doc-id-map.md');
  writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), documents }, null, 2));
  writeFileSync(mdPath, buildMarkdown(documents));

  console.log(`\n💾 JSON 已保存: ${jsonPath}`);
  console.log(`💾 Markdown 已保存: ${mdPath}`);
  console.log('\n下一步：把对应文档 id 填入 dataset/campus-qa.json 的 relevant_doc_ids。');

  return { documents, jsonPath, mdPath };
}

if (process.argv[1] && process.argv[1].includes('list-docs')) {
  runListDocs().catch(err => {
    console.error(`❌ 导出失败: ${err.message}`);
    process.exit(1);
  });
}
