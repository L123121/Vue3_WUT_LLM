"use strict";

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');

// 延迟加载 pdf-parse（可能在新版本中有兼容性问题）
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('[FileUpload] pdf-parse 加载失败，PDF 解析功能不可用:', e.message);
}

// 配置文件上传
const uploadDir = path.join(__dirname, '../../uploads');

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
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${basename}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}`));
    }
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
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

/**
 * 解析 DOCX 文件
 */
async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

/**
 * 解析文本文件
 */
function parseText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
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
  parseFile,
  cleanupFile,
  uploadDir
};
