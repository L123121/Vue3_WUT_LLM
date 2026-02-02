const http = require('http'); 
 const https = require('https'); 
 const dotenv = require('dotenv'); 
 
 // 加载环境变量 
 dotenv.config(); 
 
 const API_KEY = process.env.XUNFEI_API_KEY; 
 const PORT = process.env.PORT || 3000; 
 
 // 启动时打印诊断信息 
 console.log('=== 后端启动诊断 ==='); 
 console.log('PORT:', PORT); 
 console.log('API_KEY 已设置:', !!API_KEY); 
 if (!API_KEY) { 
   console.warn('⚠️  警告：XUNFEI_API_KEY 未设置，请在 backend/.env 中配置'); 
 } else { 
   console.log('API_KEY 长度:', API_KEY.length); 
 } 
 
 // 创建与简化版服务器完全相同的HTTP服务器 
 const server = http.createServer((req, res) => { 
   // 设置CORS头 
   res.setHeader('Access-Control-Allow-Origin', '*'); 
   res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); 
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); 
   
   // 处理OPTIONS请求 
   if (req.method === 'OPTIONS') { 
     res.statusCode = 200; 
     res.end(); 
     return; 
   } 
   
   // 只处理POST请求到/api/chat 
   if (req.method === 'POST' && req.url === '/api/chat') { 
     let body = ''; 
     
     // 接收请求体 
     req.on('data', (chunk) => { 
       body += chunk; 
     }); 
     
     req.on('end', () => { 
       try { 
         const requestData = JSON.parse(body); 
         const { messages } = requestData; 
         
         console.log('=== 收到请求 ==='); 
         console.log('消息:', messages); 
         
         // 所有请求都使用流式处理 
         handleStreamRequest(messages, res); 
       } catch (error) { 
         console.error('解析请求体错误:', error); 
         res.statusCode = 400; 
         res.setHeader('Content-Type', 'application/json'); 
         res.end(JSON.stringify({ error: '请求格式错误' })); 
       } 
     }); 
   } else if (req.method === 'GET' && req.url === '/health') { 
     // 健康检查端点 
     res.statusCode = 200; 
     res.setHeader('Content-Type', 'application/json'); 
     res.end(JSON.stringify({ status: 'ok', message: 'AI Chat API is running' })); 
   } else { 
     res.statusCode = 404; 
     res.end(); 
   } 
 }); 
 
 // 处理流式请求 
 function handleStreamRequest(messages, res) { 
   // 创建与简化版服务器完全相同的请求体 
   const requestBody = { 
     model: 'xop3qwen1b7', 
     messages: messages, 
     max_tokens: 4000, 
     temperature: 0.7, 
     stream: true 
   }; 
   
   // 生成日期
   const date = new Date().toUTCString();
   
   // 生成签名
   const hostname = 'maas-api.cn-huabei-1.xf-yun.com';
   const signatureOrigin = `host: ${hostname}\r\ndate: ${date}\r\nPOST /v2/chat/completions HTTP/1.1`;
   const crypto = require('crypto');
   const signatureSha = crypto
     .createHmac('sha256', process.env.XUNFEI_API_SECRET)
     .update(Buffer.from(signatureOrigin, 'utf8'))
     .digest('base64');
   
   // 生成授权头
   const authorizationOrigin = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
   const authorization = Buffer.from(authorizationOrigin).toString('base64');
   
   // 创建请求选项（使用HMAC签名认证）
   const options = { 
     hostname: hostname, 
     port: 443, 
     path: '/v2/chat/completions', 
     method: 'POST', 
     timeout: 30000, 
     headers: { 
       'Content-Type': 'application/json', 
       'Authorization': authorization, 
       'Date': date, 
       'Host': hostname, 
       'User-Agent': 'Node.js-Client', 
       'Accept': '*/*' 
     } 
   }; 
   
   console.log('发送到MaaS的请求体:', JSON.stringify(requestBody, null, 2)); 
   console.log('请求选项:', JSON.stringify(options, null, 2)); 
   
   // 创建请求（与简化版服务器完全相同的方式） 
   const maasReq = https.request(options, (maasRes) => { 
     console.log('\n=== MaaS API 响应 ==='); 
     console.log('状态码:', maasRes.statusCode); 
     console.log('响应头:', maasRes.headers); 
     
     // 设置SSE响应头 
     res.setHeader('Content-Type', 'text/event-stream'); 
     res.setHeader('Cache-Control', 'no-cache'); 
     res.setHeader('Connection', 'keep-alive'); 
     res.setHeader('X-Accel-Buffering', 'no'); 
     
     // MaaS 返回的是流式 SSE 格式，需要逐行处理并转发 
     let buffer = ''; 
     maasRes.on('data', (chunk) => { 
       try { 
         const chunkStr = chunk.toString(); 
         buffer += chunkStr; 
         
         // 逐行处理缓冲区中的数据 
         const lines = buffer.split('\n'); 
         // 保留最后一个不完整的行在缓冲区中 
         buffer = lines.pop() || ''; 
         
         for (const line of lines) { 
           const trimmed = line.trim(); 
           if (trimmed) { 
             // 如果已经是 SSE 格式（以 data: 开头），直接转发；否则包装 
             if (trimmed.startsWith('data:')) { 
               res.write(line + '\n'); 
             } else if (trimmed.startsWith(':') || trimmed === '') { 
               // 注释行或空行，直接转发 
               res.write(line + '\n'); 
             } else { 
               // 其他数据（如纯 JSON），包装成 SSE 格式 
               res.write(`data: ${line}\n`); 
             } 
           } else { 
             // 空行（事件分隔符） 
             res.write('\n'); 
           } 
         } 
       } catch (e) { 
         console.error('处理 MaaS 数据失败:', e); 
       } 
     }); 
 
     maasRes.on('end', () => { 
       console.log('\n=== 响应结束 ==='); 
       // 处理缓冲区中剩余的数据 
       if (buffer.trim()) { 
         if (!buffer.trim().startsWith('data:')) { 
           res.write(`data: ${buffer.trim()}\n`); 
         } else { 
           res.write(buffer + '\n'); 
         } 
       } 
       // 发送结束标志 
       try { 
         res.write('data: [DONE]\n\n'); 
       } catch (e) {} 
       res.end(); 
     }); 
 
     maasRes.on('error', (err) => { 
       console.error('MaaS 响应错误:', err); 
       try { 
         res.write(`data: {"error": "MaaS 响应错误: ${err.message}"}\n\n`); 
         res.write('data: [DONE]\n\n'); 
       } catch (e) {} 
       res.end(); 
     }); 
   }); 
   
   // 错误处理 
   maasReq.on('error', (error) => { 
     console.error('\n=== 请求错误 ==='); 
     console.error('错误:', error); 
     
     res.write(`data: {"error": "流式请求失败：${error.message}"} \n\n`); 
     res.write('data: [DONE]\n\n'); 
     res.end(); 
   }); 
   
   // 超时处理 
   maasReq.on('timeout', () => { 
     console.error('\n=== 请求超时 ==='); 
     maasReq.destroy(); 
     
     res.write(`data: {"error": "请求超时"} \n\n`); 
     res.write('data: [DONE]\n\n'); 
     res.end(); 
   }); 
   
   // 发送请求体 
   maasReq.write(JSON.stringify(requestBody)); 
   maasReq.end(); 
   
   console.log('\n=== 请求已发送 ==='); 
 } 
 
 // 启动服务器 
 server.listen(PORT, () => { 
   console.log(`Server is running on http://localhost:${PORT}`); 
 });