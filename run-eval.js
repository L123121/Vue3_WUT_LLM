const crypto = require('crypto');
const path = require('path');
const JWT_SECRET = 'wuli-elf-dev-jwt-secret-2026-change-in-prod';

function makeJWT(payload, secret) {
  const hdr = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const bdy = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(hdr+'.'+bdy).digest('base64url');
  return hdr+'.'+bdy+'.'+sig;
}

// Fresh token with 24h expiry
const token = makeJWT(
  { userId: 'eval-runner', username: 'eval', role: 'admin', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 86400 },
  JWT_SECRET
);

process.env.RAG_EVAL_COOKIE = 'auth_token=' + token;
console.log('Token generated, running eval...');

// Run the ES module eval
const evalPath = path.resolve(__dirname, 'scripts/rag-eval/eval-retrieval.js').replace(/\\/g, '/');
import('file:///' + evalPath).then(m => {
  return m.runRetrievalEval();
}).then(result => {
  if (result) {
    const s = result.summary;
    console.log('\n===== 最终评估结果 =====');
    console.log('有效样本:', s.evaluated, '/', s.total);
    console.log('Recall:', s.overall.recall);
    console.log('Precision:', s.overall.precision);
    console.log('Hit Rate:', s.overall.hitRate);
    console.log('MRR:', s.overall.mrr);
    console.log('nDCG@5:', s.overall['ndcg@5']);
    console.log('Bad Cases:', s.badCaseCount);
    console.log('\n按类别:');
    for (const [k,v] of Object.entries(s.byCategory || {}))
      console.log(' ', k, '→ recall:', v.recall, 'precision:', v.precision, 'mrr:', v.mrr, '(n='+v.count+')');
    console.log('\n按难度:');
    for (const [k,v] of Object.entries(s.byDifficulty || {}))
      console.log(' ', k, '→ recall:', v.recall, 'precision:', v.precision, '(n='+v.count+')');
  }
}).catch(err => {
  console.error('Eval error:', err.message);
  process.exit(1);
});
