import express, { Request, Response, NextFunction } from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { ChatService } from './services/chat.service';  // 确保从这里导入
import config from './config';

// 加载环境变量
dotenv.config();

const app: Express = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);
const chatService = new ChatService();

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
  const hasApiConfig = !!config.xunfei.apiKey;
  
  res.json({ 
    status: 'ok', 
    message: '武理小精灵后端服务运行正常',
    timestamp: new Date().toISOString(),
    ai_service: {
      enabled: hasApiConfig,
      provider: 'iFlyTek Spark',
      model: config.xunfei.model || '未配置',
      status: hasApiConfig ? '配置正常' : '模拟模式'
    }
  });
});

// API 列表
app.get('/api', (req: Request, res: Response) => {
  res.json({ 
    app: '武理小精灵后端',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/health', description: '健康检查' },
      { method: 'GET', path: '/api', description: 'API列表' },
      { method: 'POST', path: '/api', description: '聊天接口（使用Qwen模型）' },
      { method: 'POST', path: '/api/chat', description: '聊天接口（兼容）' }
    ]
  });
});

// 聊天请求处理函数
const handleChatRequest = async (req: Request, res: Response, endpoint: string = '/api') => {
  try {
    const { message, history = [] } = req.body;
    
    console.log(`🤖 ${endpoint} 收到请求:`, message?.substring(0, 50));
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: '消息内容不能为空',
        code: 'MESSAGE_EMPTY'
      });
    }
    
    // 调用AI服务
    const result = await chatService.getResponse(message.trim(), history);
    
    console.log(`✅ ${endpoint} AI回复:`, (result.reply as string).substring(0, 50));
    
    res.json({
      success: true,
      data: {
        reply: result.reply,
        timestamp: result.timestamp,
        messageId: `msg_${Date.now()}`,
        model: result.model,
        isMock: result.isMock,
        via: endpoint
      }
    });
    
  } catch (error: any) {
    console.error(`❌ ${endpoint} 处理错误:`, error);
    res.status(500).json({
      success: false,
      error: 'AI服务处理失败',
      code: 'SERVER_ERROR'
    });
  }
};

// 主聊天接口
app.post('/api', (req: Request, res: Response) => {
  handleChatRequest(req, res, '/api');
});

// 兼容接口
app.post('/api/chat', (req: Request, res: Response) => {
  handleChatRequest(req, res, '/api/chat');
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
    error: '服务器内部错误'
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  const hasApi = !!config.xunfei.apiKey;
  console.log('='.repeat(60));
  console.log('🚀 武理小精灵后端服务启动成功！');
  console.log(`📍 地址：http://localhost:${PORT}`);
  console.log(`🤖 AI服务：${hasApi ? '讯飞Qwen模型' : '模拟模式'}`);
  console.log(`📡 模型：${config.xunfei.model || '未配置'}`);
  console.log('='.repeat(60));
});