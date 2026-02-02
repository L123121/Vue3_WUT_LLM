import dotenv from 'dotenv';

dotenv.config();

export default {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'default_secret',
  env: process.env.NODE_ENV || 'development',
  xunfei: {
    appId: '593fc475',
    apiKey: 'a8857c7cb2aa4d80c9ce33f202577974',
    apiSecret: 'NDk1YjUxNTA2MGYxM2E2YzY5M2Y1OTI5',
    baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2'
  }
};