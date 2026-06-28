# RAG 评测数据集格式说明

## 文件格式

`campus-qa.json` 是一个 JSON 数组，每个元素代表一条评测样本。

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，如 `q001` |
| `question` | string | 是 | 用户提问 |
| `ground_truth` | string | 是 | 标准答案（人工编写，作为评测基准） |
| `category` | string | 是 | 知识分类：学校概况 / 计算机学院 / 图书馆 / 教务相关 / 综合 |
| `relevant_doc_ids` | string[] | 是 | 该问题应该命中的文档 ID 列表（用于计算召回率） |
| `difficulty` | string | 是 | 难度：easy / medium / hard |

## 难度定义

- **easy**: 答案直接出现在文档中的单句话，如"校训是什么"
- **medium**: 需要理解文档内容并做简单推理，如"计算机学院有哪些实验室"
- **hard**: 需要跨多个文档联合推理，如"比较两个校区的图书馆资源差异"

## 如何获取文档 ID

1. 启动后端：`cd backend && npm run dev`
2. 调用接口：`GET http://localhost:3000/api/rag/documents`
3. 返回结果中的 `id` 字段即为文档 ID

## 注意事项

- `relevant_doc_ids` 可以为空数组（表示该问题不应命中任何文档，用于测试"无答案"场景）
- 每个分类至少 5 条数据
- 总数据量建议 30-50 条
