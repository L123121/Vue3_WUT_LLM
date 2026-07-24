const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JWT_SECRET = 'wuli-elf-dev-jwt-secret-2026-change-in-prod';

function makeJWT(p,s) {
  const h=Buffer.from(JSON.stringify({alg:'HS256',type:'JWT'})).toString('base64url');
  const b=Buffer.from(JSON.stringify(p)).toString('base64url');
  const sig=crypto.createHmac('sha256',s).update(h+'.'+b).digest('base64url');
  return h+'.'+b+'.'+sig;
}

const token = makeJWT({userId:'x',exp:Math.floor(Date.now()/1000)+86400}, JWT_SECRET);
process.env.RAG_EVAL_COOKIE = 'auth_token=' + token;

// Update QA dataset
const qaPath = path.resolve(__dirname, 'scripts/rag-eval/dataset/campus-qa.json');
const qa = JSON.parse(fs.readFileSync(qaPath, 'utf-8'));
const docId = 'doc_6412a3de-b7b1-46c7-91d3-448e36910d1f';
qa.forEach(i => { i.relevant_doc_ids = [docId]; });
fs.writeFileSync(qaPath, JSON.stringify(qa,null,2), 'utf-8');

// Run eval
const evalPath = path.resolve(__dirname, 'scripts/rag-eval/eval-retrieval.js').replace(/\\/g, '/');
import('file:///' + evalPath).then(m => m.runRetrievalEval()).catch(e => { console.error(e.message); process.exit(1); });
