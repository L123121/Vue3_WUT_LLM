import axios from 'axios';

async function test() {
  try {
    console.log('正在测试后端 AI 接口...');
    const response = await axios.post('http://localhost:3000/api', {
      message: '你好'
    });
    console.log('响应成功:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('请求失败:');
    if (error.response) {
      console.error('状态码:', error.response.status);
      console.error('错误数据:', error.response.data);
    } else {
      console.error('错误信息:', error.message);
    }
  }
}

test();
