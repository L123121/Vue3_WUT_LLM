// src/app.ts
// 使用正确的导入方式
import express, { Request, Response, NextFunction } from 'express';
import type { Express } from 'express'; // 单独导入类型
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const app: Express = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: '武理小精灵后端服务运行正常',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 示例路由
app.get('/api', (req: Request, res: Response) => {
  res.json({ 
    app: '武理小精灵后端',
    version: '1.0.0',
    endpoints: [
      '/api/health',
      '/api/students',
      '/api/courses'
    ]
  });
});

app.get('/api/students', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: '张三', studentId: '2021001', major: '计算机科学' },
      { id: 2, name: '李四', studentId: '2021002', major: '软件工程' },
      { id: 3, name: '王五', studentId: '2021003', major: '人工智能' }
    ]
  });
});

app.get('/api/courses', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: 'Vue.js 前端开发', code: 'CS101', credit: 3 },
      { id: 2, name: 'Node.js 后端开发', code: 'CS102', credit: 3 },
      { id: 3, name: '数据库系统原理', code: 'CS201', credit: 4 }
    ]
  });
});

// 404 处理
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ 
    success: false,
    error: '接口不存在',
    path: req.originalUrl
  });
});

// 错误处理
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    success: false,
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🚀 武理小精灵后端服务启动成功！');
  console.log(`📍 服务器地址：http://localhost:${PORT}`);
  console.log(`📡 API 地址：http://localhost:${PORT}/api`);
  console.log(`🏥 健康检查：http://localhost:${PORT}/api/health`);
  console.log('='.repeat(50));
});