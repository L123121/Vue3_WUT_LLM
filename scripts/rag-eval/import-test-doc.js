/**
 * 导入本地 Markdown 测试文件到 RAG 知识库
 *
 * 默认导入 dataset/discrete-structure.md，也可以用 --file 指定其他文件。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { addDocument, BACKEND_URL, checkBackendHealth, loginForCookie } from './utils/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(__dirname, 'dataset/discrete-structure.md');
const RESULTS_DIR = resolve(__dirname, 'results');

mkdirSync(RESULTS_DIR, { recursive: true });

function parseArgs(argv = process.argv.slice(2)) {
  const getArgValue = (name, fallback = '') => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || fallback : fallback;
  };

  const file = resolve(getArgValue('--file', DEFAULT_FILE));
  const inferredTitle = basename(file, extname(file));

  return {
    file,
    title: getArgValue('--title', inferredTitle),
    category: getArgValue('--category', '离散结构'),
    skipHealthCheck: argv.includes('--skip-health-check'),
  };
}

export async function importTestDoc(options = {}) {
  const args = { ...parseArgs(), ...options };

  console.log('\n========================================');
  console.log('  RAG 测试文档导入');
  console.log('========================================\n');

  if (!existsSync(args.file)) {
    throw new Error(`测试文件不存在: ${args.file}`);
  }

  if (!args.skipHealthCheck) {
    const healthy = await checkBackendHealth();
    if (!healthy) {
      throw new Error(`后端服务不可用：${BACKEND_URL}\n请先启动后端: cd backend && npm start`);
    }
  }

  await loginForCookie();

  const content = readFileSync(args.file, 'utf-8').trim();
  if (!content) {
    throw new Error(`测试文件为空: ${args.file}`);
  }

  console.log(`📄 文件: ${args.file}`);
  console.log(`🏷️ 标题: ${args.title}`);
  console.log(`📁 分类: ${args.category}`);
  console.log(`🧩 内容长度: ${content.length} 字符`);

  const result = await addDocument({
    title: args.title,
    content,
    category: args.category,
    metadata: {
      sourceFile: basename(args.file),
      sourcePath: args.file,
      fileType: extname(args.file).toLowerCase(),
      purpose: 'ragas-test',
      importedAt: new Date().toISOString(),
    },
  });

  const output = {
    timestamp: new Date().toISOString(),
    input: args,
    document: result,
  };
  const outputPath = resolve(RESULTS_DIR, 'imported-test-doc.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('\n✅ 测试文档已导入知识库');
  console.log(`   docId: ${result.id || result.docId || '-'}`);
  console.log(`   chunks: ${result.chunkCount || '-'}`);
  console.log(`   result: ${outputPath}`);
  console.log('\n下一步可运行:');
  console.log('   npm run eval:ragas:discrete -- --sample 3');

  return output;
}

if (process.argv[1] && process.argv[1].includes('import-test-doc')) {
  importTestDoc().catch(err => {
    console.error(`\n❌ 导入失败: ${err.message}`);
    process.exit(1);
  });
}
