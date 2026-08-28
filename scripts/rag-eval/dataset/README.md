# RAG 评测数据集说明

本目录存放 RAG 检索与生成质量评测样本。当前数据集文件为 `campus-qa.json`，用于 `scripts/rag-eval/` 下的评测脚本。

---

## 文件结构

```text
scripts/rag-eval/
├── dataset/
│   ├── campus-qa.json      # 校园问答样本
│   └── README.md           # 本说明文件
├── eval-retrieval.js       # 检索质量评测
├── eval-ragas.js           # 生成质量评测
└── eval-run.js             # 统一评测入口
```

`campus-qa.json` 是 JSON 数组，每个元素代表一条评测样本。

---

## 样本格式

```json
{
  "id": "q001",
  "question": "武汉理工大学的校训是什么？",
  "ground_truth": "武汉理工大学的校训是厚德博学、追求卓越。",
  "category": "学校概况",
  "relevant_doc_ids": ["TODO_FILL_DOC_ID"],
  "difficulty": "easy"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 样本唯一标识，建议使用 `q001` 这类稳定编号 |
| `question` | `string` | 是 | 用户问题 |
| `ground_truth` | `string` | 是 | 人工标准答案，用于生成质量对比 |
| `category` | `string` | 是 | 知识分类，例如学校概况、计算机学院、图书馆、教务相关 |
| `relevant_doc_ids` | `string[]` | 是 | 该问题应命中的知识库文档 ID，用于计算召回率 |
| `difficulty` | `string` | 是 | 难度，取值 `easy`、`medium`、`hard` |

---

## 难度定义

- **easy**：答案能从单个文档中的明确句子直接得到。
- **medium**：需要理解文档内容并做简单归纳或筛选。
- **hard**：需要跨多个文档联合推理，或问题表达与原文差异较大。

---

## 文档 ID 填写流程

当前 `campus-qa.json` 中的 `TODO_FILL_DOC_ID` 是占位符，正式评测前需要替换为实际知识库文档 ID。

1. 启动后端：

   ```bash
   cd backend
   npm run dev
   ```

2. 登录前端并上传知识库文档，或调用 RAG 文档上传接口。
3. 获取文档列表：

   ```bash
   curl -b cookie.txt http://localhost:3000/api/rag/documents
   ```

   RAG 文档接口需要登录 cookie；也可以直接在前端知识库页面查看文档。

4. 将返回结果中的 `id` 填入对应样本的 `relevant_doc_ids`。
5. 如果问题是“无答案”场景，可保留空数组：`"relevant_doc_ids": []`。

---

## 运行评测

进入评测脚本目录：

```bash
cd scripts/rag-eval
npm install
```

按需运行：

```bash
npm run eval:retrieval  # 检索召回、命中等指标
npm run eval:ragas      # 生成质量指标
npm run eval            # 统一入口
```

评测脚本通常需要访问后端服务和模型服务，请确保后端已启动并正确配置环境变量。

---

## 编写建议

- 每个分类建议至少 5 条样本，整体保持 easy / medium / hard 难度分布。
- `ground_truth` 应简洁、确定、可验证，避免写成开放式长答案。
- `question` 应覆盖真实用户表达，可以适当加入同义词、口语化问法。
- `relevant_doc_ids` 尽量只填真正包含答案依据的文档，避免召回指标失真。
- 修改样本后保持 JSON 合法，可使用 `node -e "JSON.parse(require('fs').readFileSync('dataset/campus-qa.json','utf8'))"` 检查。
---

## 新增评测指标与 Bad Case 分类

`eval-retrieval.js` 除基础 `Recall`、`Precision`、`MRR`、`Hit Rate` 外，还会输出：

- `Recall@1/3/5`：相关文档是否出现在不同 TopK 范围内。
- `nDCG@1/3/5`：衡量相关文档排序位置，越靠前分数越高。
- `badCase.type`：自动标记失败类型，用于后续复盘。

Bad Case 类型约定：

| 类型 | 含义 | 常见修复方向 |
| --- | --- | --- |
| `recall_miss` | TopK 来源没有命中标准文档 | 增加 BM25、调整切片、提高召回 TopK |
| `ranking_error` | 命中了相关文档，但排序靠后 | 调整 rerank、融合权重或 RRF 参数 |
| `noisy_context` | 命中但无关来源较多 | 收紧分类过滤、优化切片粒度 |
| `generation_refusal` | 已命中来源但生成阶段拒答 | 检查 prompt、拒答阈值和上下文拼接 |
| `no_retrieval` | 没有返回任何来源 | 检查知识库索引、Embedding 和向量库状态 |
| `api_error` | 接口调用失败 | 检查后端服务、登录态、模型服务和网络 |

上线前建议保留一份稳定 Golden Set，每次修改 `chunkSize`、`TopK`、召回权重、Embedding 模型或 prompt 后都重新运行评测，并把 `results/retrieval-results.json` 中的 Bad Case 作为优化记录。

---

## 精排模型上线前的父段离线评估

不要只看“相关文档是否被召回”，还要看相关父段在聚合父段列表中的排序位置。新增脚本用于判断是否真的需要引入精排模型。

### 评估流程

1. 准备 50 条真实用户 Query，建议放入 `campus-qa.json` 或通过 `--dataset` 指定新的 JSON 数据集。
2. 启动后端并确保知识库索引已完成。
3. 采集候选父段：

   ```bash
   cd scripts/rag-eval
   npm run eval:parent-rerank:collect
   ```

   采集脚本会对每条 Query 执行“Top25 子句召回 → 父段聚合”，并生成：

   - `results/parent-rerank-annotations.json`

4. 人工标注 `results/parent-rerank-annotations.json` 中每个 `queries[].candidates[]`：

   ```json
   {
     "rank": 3,
     "parentId": "doc_xxx_para_12",
     "parentText": "候选父段原文...",
     "isRelevant": true,
     "note": "能直接回答 Query"
   }
   ```

   标注规则：只要该父段能独立支撑正确回答，就标 `true`；只是主题相近但不能回答则标 `false`。

5. 计算指标：

   ```bash
   npm run eval:parent-rerank
   ```

   结果保存到 `results/parent-rerank-metrics.json`。

### 指标解释

| 指标 | 含义 | 用途 |
| --- | --- | --- |
| `Recall@10` | 每个 Query 是否至少有 1 个相关父段进入 Top10 | 判断召回是否足够覆盖答案来源 |
| `相关父段级 Recall@10` | 所有被标为相关的父段中，有多少排在 Top10 | 判断多证据问题的覆盖情况 |
| `MRR` | 首个相关父段排名的倒数均值 | 判断用户最先看到/LLM 最先使用的证据是否靠前 |
| `第一个相关父段平均排名` | 命中 Query 中首个相关父段的平均 rank | 更直观判断精排潜在收益 |

### 决策建议

- 如果 `Recall@10` 仍保持约 97%，且 `MRR >= 0.5`、第一个相关父段平均排名不超过 2：精排模型收益通常很小，可以先跳过。
- 如果 `MRR <= 0.25` 或第一个相关父段平均排名大约在 5 位及以后：精排模型有实际价值，建议继续做小规模 A/B。
- 如果结果处于中间区间：优先分析 `results/parent-rerank-metrics.json` 里的 `rankingErrors`，只针对排序错误 Query 验证精排。

### 常用参数

```bash
# 指定 50 条样本、Top25 子句召回
npm run eval:parent-rerank:collect -- --sample-size 50 --child-top-k 25

# 只评估某个分类
npm run eval:parent-rerank:collect -- --category 学校概况

# 指定标注文件和 TopK
npm run eval:parent-rerank -- --input results/parent-rerank-annotations.json --top-k 10
```
---

## 登录态与文档 ID 导出

RAG 文档与问答接口受 `auth_token` httpOnly Cookie 保护。评测脚本支持两种登录方式：

### 方式一：直接传 Cookie（推荐）

1. 浏览器登录项目。
2. 在开发者工具 Application / Cookies 中复制 `auth_token=...`。
3. 在 `scripts/rag-eval/.env` 或命令行环境变量中设置：

```bash
RAG_EVAL_COOKIE="auth_token=你的cookie值"
```

### 方式二：用教务账号自动登录

如果本地能访问教务登录链路，也可以设置：

```bash
RAG_EVAL_STUDENT_ID="你的学号"
RAG_EVAL_PASSWORD="你的教务密码"
```

脚本会调用 `POST /api/school/login` 获取 Set-Cookie。注意不要把真实密码提交到 Git。

### 导出知识库文档 ID

先启动后端并完成登录配置，然后运行：

```bash
cd scripts/rag-eval
npm run docs
```

脚本会输出并保存：

- `results/doc-id-map.json`：机器可读文档列表。
- `results/doc-id-map.md`：按分类整理的文档 ID 对照表。

把对应 `id` 填入 `campus-qa.json` 的 `relevant_doc_ids` 后，再运行 `npm run eval:retrieval`。

---

## 线上 Badcase 回归闭环（2026-08-24）

静态测试集无法覆盖线上新出现的坏例。本闭环把 RagFeedback 的 dislike 反馈自动沉淀为回归样本：

```text
线上 dislike ──export──▶ badcases-from-feedback.json (pending_annotation)
                              │
                              ▼  badcase-review.cjs 标注 relevant_doc_ids / ground_truth
                        status=ready
                              │
                              ▼  DATASET_PATH 并入 eval-retrieval.js 回归
                       指标变化 > 阈值 → 告警 → 修复检索链路 → 重跑
```

### 1. 导出（需后端运行 + 管理员 Cookie）

```bash
cd scripts/rag-eval
RAG_EVAL_COOKIE="auth_token=..." node export-badcases.cjs [--rating=dislike|like|all] [--limit=N]
# 幂等：按 userId+feedbackId 去重，重复执行只增量写入 dataset/badcases-from-feedback.json
```

### 2. 查看待标注 & 一条命令标注

```bash
node badcase-review.cjs                    # 状态总览 + 待标注清单（每条附带现成的标注命令）
node badcase-review.cjs annotate --id=FB-admin-conv1 --docs=<docId1,docId2> [--gt="标准答案"]
node badcase-review.cjs validate           # 校验 ready 条目引用的 docId 是否仍存在于知识库
```

- `--id` 支持唯一前缀匹配；`candidate_doc_ids`（回答引用来源）可作标注起点；
  文档 ID 对照表用 `npm run docs` 生成（results/doc-id-map.md）。
- 检索回归只需 `relevant_doc_ids`；要并入 RAGAS 生成评测请补 `ground_truth`。

### 3. 并入回归

```bash
DATASET_PATH=dataset/badcases-from-feedback.json RAG_EVAL_COOKIE="auth_token=..." node eval-retrieval.js
```

评测脚本自动跳过 `pending_annotation` 条目（日志显示"待标注"），只对 ready 条目计算指标，
因此同一个文件可以长期同时容纳待标注与已标注样本。

### 约定

- 标注完成后**不要删除** feedback 字段——它是坏例的原始证据链（回答原文/traceId/时间）。
- 文档删除或全量重索引后跑一次 `validate`，失效的 docId 引用需要重新标注。
