// 官方评测 runner：从 cookie jar 读取测试账号凭据，设置 env 后运行 eval-retrieval.js
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_JAR = process.env.EVAL_COOKIE_JAR || resolve(__dirname, '../../../tmp/eval_cookies.txt');

// 从 Netscape cookie jar 提取 auth_token
const jarText = readFileSync(COOKIE_JAR, 'utf-8');
const match = jarText.match(/^auth_token\s+(\S+)$/m) || jarText.match(/auth_token[\t ]+(\S+)/);
if (!match) throw new Error('cookie jar 中未找到 auth_token');
process.env.RAG_EVAL_COOKIE = `auth_token=${match[1]}`;
process.env.DATASET_PATH = 'dataset/full-coverage-qa.json';

// 动态 import：确保 env 在模块加载前设置（eval-retrieval.js 模块级读取 DATASET_PATH）
const { runRetrievalEval } = await import('./eval-retrieval.js');
await runRetrievalEval();
