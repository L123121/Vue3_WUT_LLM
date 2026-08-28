/**
 * 上传 ragdata 目录中所有文档到知识库（统一用文件上传接口）
 * 用法: node upload-ragdata.js
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAGDATA_DIR = resolve(__dirname, '../../ragdata');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
// JWT 密钥：环境变量优先，其次读 backend/.env（与后端服务同一密钥）
const SECRET_ENV = resolve(__dirname, '../../backend/.env');
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (existsSync(SECRET_ENV) && readFileSync(SECRET_ENV, 'utf8').match(/^JWT_SECRET=(.+)$/m)?.[1].trim());
if (!JWT_SECRET) {
  console.error('未找到 JWT_SECRET：请设置环境变量 JWT_SECRET，或在 backend/.env 中配置');
  process.exit(1);
}

function makeJwt(payload, secret) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = b64({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = b64({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${sig}`;
}

const AUTH_TOKEN = makeJwt({ userId: 'admin', username: 'admin', role: 'admin' }, JWT_SECRET);
const COOKIE = `auth_token=${AUTH_TOKEN}`;

const CATEGORY_MAP = [
  ['武汉理工大学校园资料手册', '学校概况'],
  ['校园资料手册', '学校概况'],
  ['campus', '学校概况'],
  ['Agent学习笔记', 'AI学习'],
  ['CodeTop60', '面试刷题'],
  ['离散结构', '专业课程'],
  ['离散数学', '专业课程'],
  ['软件工程', '专业课程'],
  // 2026-08-24 新增知识库文件的分类映射
  ['武汉理工大学', '学校概况'],      // 体育场馆/医疗/交通等生活指南
  ['操作系统', '专业课程'],
  ['数据库', '专业课程'],
  ['面试', '面试刷题'],              // OS/数据库/前端高频面试题
  ['Python', '面试刷题'],
  ['RAG系统', 'AI学习'],
  ['Prompt工程', 'AI学习'],
];

function guessCategory(name) {
  for (const [kw, cat] of CATEGORY_MAP) {
    if (name.includes(kw)) return cat;
  }
  return 'general';
}

async function uploadFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const rawName = basename(filePath, ext);
  const title = rawName.replace(/[()（）《》]/g, '').trim();
  const category = guessCategory(rawName);
  const fileName = basename(filePath);

  console.log(`📤 ${fileName}`);
  console.log(`   标题: ${title}  分类: ${category}`);

  const fileBuffer = readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('title', title);
  form.append('category', category);

  const response = await fetch(`${BACKEND_URL}/api/rag/documents/upload`, {
    method: 'POST',
    headers: { Cookie: COOKIE },
    body: form,
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || JSON.stringify(result).substring(0, 200));
  }
  return result.data;
}

async function main() {
  const files = readdirSync(RAGDATA_DIR)
    .filter(f => {
      const fp = resolve(RAGDATA_DIR, f);
      return statSync(fp).isFile() && ['.md', '.docx', '.pptx', '.txt', '.pdf'].includes(extname(f).toLowerCase());
    })
    .sort();

  console.log(`📂 找到 ${files.length} 个文件\n`);

  for (const file of files) {
    const filePath = resolve(RAGDATA_DIR, file);
    try {
      const data = await uploadFile(filePath);
      console.log(`   ✅ id=${data.id}  chunks=${data.chunkCount ?? '?'}\n`);
    } catch (err) {
      console.error(`   ❌ ${err.message}\n`);
    }
  }

  // 验证
  console.log('─'.repeat(40));
  console.log('📋 验证知识库:');
  const response = await fetch(`${BACKEND_URL}/api/rag/documents`, {
    headers: { Cookie: COOKIE },
  });
  const list = await response.json();
  for (const doc of list.data?.documents || []) {
    console.log(`   ${doc.id.substring(0, 20)}...  ${doc.title.padEnd(24)} [${doc.category}]  chunks=${doc.chunkCount}  ${doc.vectorStatus}`);
  }

  // 等索引完成
  const docCount = list.data?.documents?.length || 0;
  if (docCount > 1) {
    console.log('\n⏳ 等待向量索引写入缓冲 (15s)...');
    await new Promise(r => setTimeout(r, 15000));
    console.log('✅ 可以开始测试');
  }
}

main().catch(err => { console.error(`\n💥 ${err.message}`); process.exit(1); });
