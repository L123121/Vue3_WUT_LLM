"use strict";

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

// 延迟加载 pdf-parse（可能在新版本中有兼容性问题）
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('[FileUpload] pdf-parse 加载失败，PDF 解析功能不可用:', e.message);
}

// 配置文件上传
const uploadDir = path.join(__dirname, '../../uploads');
// 媒体附件目录（图片等）
const mediaDir = path.join(__dirname, '../../media');

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.pptx', '.txt', '.md']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MIME_TYPES_BY_EXTENSION = {
  '.pdf': new Set(['application/pdf']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ]),
  '.doc': new Set(['application/msword', 'application/octet-stream']),
  '.pptx': new Set([
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/octet-stream',
  ]),
  '.txt': new Set(['text/plain', 'application/octet-stream']),
  '.md': new Set(['text/markdown', 'text/plain', 'application/octet-stream']),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.png': new Set(['image/png']),
  '.gif': new Set(['image/gif']),
  '.webp': new Set(['image/webp']),
};

// ==================== Turndown（HTML → Markdown） ====================

const turndownService = new TurndownService({
  headingStyle: 'atx',       // ## 标题
  codeBlockStyle: 'fenced',  // ```code```
  emDelimiter: '*',          // *斜体*
  strongDelimiter: '**',     // **加粗**
  bulletListMarker: '-',
});

// 启用 GFM 插件（表格、任务列表等）
turndownService.use(gfm);

// 自定义图片处理：提取并保存 base64 图片
turndownService.addRule('image', {
  filter: 'img',
  replacement: (content, node) => {
    const src = node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '图片';

    // base64 图片：保存到 media 目录并替换路径
    if (src.startsWith('data:')) {
      const filename = saveBase64Image(src, alt);
      return `\n![${alt}](media/${filename})\n`;
    }

    // 普通 URL 图片
    return `\n![${alt}](${src})\n`;
  },
});

// 确保 media 目录存在
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

/** 图片计数器（单次解析内递增，用于生成唯一文件名） */
let _imageCounter = 0;

/**
 * 保存 base64 图片到 media 目录
 * @param {string} dataUri - data:image/png;base64,...
 * @param {string} alt - 图片描述
 * @returns {string} 文件名
 */
function saveBase64Image(dataUri, alt) {
  _imageCounter++;
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return `image-${_imageCounter}.png`;

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const data = Buffer.from(match[2], 'base64');
  const filename = `img-${Date.now()}-${_imageCounter}.${ext}`;
  const filePath = path.join(mediaDir, filename);

  try {
    fs.writeFileSync(filePath, data);
    console.log(`[FileUpload] 已保存图片: ${filename} (${data.length} bytes)`);
  } catch (err) {
    console.warn(`[FileUpload] 图片保存失败: ${err.message}`);
  }

  return filename;
}

function isAllowedUpload(file, includeImages = false) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = includeImages
    ? new Set([...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS])
    : DOCUMENT_EXTENSIONS;

  if (!allowedExtensions.has(ext)) return false;

  const allowedMimeTypes = MIME_TYPES_BY_EXTENSION[ext];
  const mimetype = String(file.mimetype || '').toLowerCase();
  return !!allowedMimeTypes && allowedMimeTypes.has(mimetype);
}

// 确保上传目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    cb(null, `upload-${timestamp}-${random}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    cb(null, isAllowedUpload(file));
  }
});

// 聊天文件上传（允许图片 + 文档）
const chatUpload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  },
  fileFilter: (req, file, cb) => {
    cb(null, isAllowedUpload(file, true));
  }
});

/**
 * 解析文件内容
 */
async function parseFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  switch (ext) {
    case '.pdf':
      return parsePDF(filePath);

    case '.docx':
    case '.doc':
      return parseDocx(filePath);

    case '.pptx':
      return parsePptx(filePath);

    case '.txt':
    case '.md':
      return parseText(filePath);

    default:
      throw new Error(`不支持的文件类型: ${ext}`);
  }
}

/**
 * 解析 PDF 文件
 */
async function parsePDF(filePath) {
  if (!pdfParse) {
    throw new Error('PDF 解析功能不可用，请检查 pdf-parse 安装');
  }
  const dataBuffer = await fs.promises.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

/**
 * 解析 DOCX 文件（增强版：保留表格、提取图片、标注公式）
 *
 * 处理策略：
 * - 表格 → Markdown 表格语法（行列结构完整保留）
 * - 图片 → 提取 base64 存为文件，替换为 ![描述](media/文件名)
 * - 公式 → mammoth 不直接支持 Office Math，尝试提取原始 XML 中的公式文本
 */
async function parseDocx(filePath) {
  // 重置图片计数器
  _imageCounter = 0;

  // 第一步：用 convertToHtml 保留表格和图片
  const { value: html, messages } = await mammoth.convertToHtml({
    path: filePath,
  });

  // 统计 mammoth 报告的消息
  const warningMsgs = messages || [];
  const imageCount = warningMsgs.filter(m => m.type === 'warning' && /image|picture/i.test(m.message)).length;

  // 第二步：提取公式（Office Math）
  const formulas = await extractDocxFormulas(filePath);

  // 第三步：HTML → Markdown
  let markdown = turndownService.turndown(html);

  // 第四步：在顶部添加摘要
  const notes = [];
  if (imageCount > 0 || _imageCounter > 0) {
    const totalImages = Math.max(imageCount, _imageCounter);
    notes.push(`> 📷 本文档包含 ${totalImages} 张图片，已保存至附件目录 (media/)`);
  }
  if (formulas.length > 0) {
    // 在对应位置插入公式文本
    notes.push(`> 📐 本文档包含 ${formulas.length} 个公式`);
  }

  const header = notes.length > 0 ? notes.join('\n') + '\n\n' : '';

  // 第五步：追加公式文本（如果有）
  let formulaAppendix = '';
  if (formulas.length > 0) {
    formulaAppendix = '\n\n---\n### 公式列表\n\n' +
      formulas.map((f, i) => `公式 ${i + 1}：${f}`).join('\n\n');
  }

  return header + markdown + formulaAppendix;
}

/**
 * 从 DOCX 中提取 Office Math（公式）文本
 * DOCX 本质是 ZIP，OMML 存储在 word/document.xml 中的 <m:oMath> 元素
 */
async function extractDocxFormulas(filePath) {
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const archive = await JSZip.loadAsync(fileBuffer);
    const docFile = archive.files['word/document.xml'];
    if (!docFile) return [];

    const xml = await docFile.async('text');
    const formulas = [];

    // 匹配 <m:oMath>...</m:oMath> 块
    const mathBlocks = [...xml.matchAll(/<m:oMath(?:\s[^>]*)?>([\s\S]*?)<\/m:oMath>/g)];

    for (const [, inner] of mathBlocks) {
      // 提取所有 <m:t> 标签内的文本（OMML 的文本元素）
      const textParts = [...inner.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g)];
      const text = textParts
        .map(m => decodeXmlText(m[1]))
        .filter(Boolean)
        .join('');

      if (text) {
        formulas.push(text);
      }
    }

    return formulas;
  } catch (err) {
    console.warn(`[FileUpload] 公式提取失败: ${err.message}`);
    return [];
  }
}

async function parsePptx(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const archive = await JSZip.loadAsync(fileBuffer);
  const slideFiles = Object.values(archive.files)
    .filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file.name))
    .sort((left, right) => getPptxPartIndex(left.name) - getPptxPartIndex(right.name));

  const slideTexts = [];
  for (const slideFile of slideFiles) {
    const xml = await slideFile.async('text');
    const text = extractPptxXmlText(xml);
    if (text) {
      slideTexts.push(`## 第 ${getPptxPartIndex(slideFile.name)} 页\n\n${text}`);
    }
  }

  return slideTexts.join('\n\n---\n\n');
}

function getPptxPartIndex(name) {
  const match = name.match(/(slide|notesSlide)(\d+)\.xml$/);
  return match ? Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function extractPptxXmlText(xml) {
  const matches = [...String(xml || '').matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)];
  return matches
    .map(match => decodeXmlText(match[1]))
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlText(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析文本文件
 */
async function parseText(filePath) {
  return fs.promises.readFile(filePath, 'utf-8');
}

/**
 * 清理上传的文件
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn('[FileUpload] 清理文件失败:', error.message);
  }
}

module.exports = {
  upload,
  chatUpload,
  parseFile,
  cleanupFile,
  uploadDir,
  mediaDir,
};