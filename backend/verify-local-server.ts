
import axios from 'axios';

async function testServer() {
  console.log('🚀 Testing Local Server API...');
  
  const url = 'http://localhost:3000/api';
  const payload = {
    message: 'Hello! Are you working?',
    history: []
  };

  try {
    console.log(`Connecting to ${url}...`);
    const response = await axios.post(url, payload, { timeout: 30000 });
    
    console.log('✅ Success! Reply:', JSON.stringify(response.data));
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testServer();
