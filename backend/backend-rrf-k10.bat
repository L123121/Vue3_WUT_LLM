@echo off
REM Start backend: RRF fusion k=10 + MMR same-doc dedup (k comparison run)
set RAG_FUSION=rrf
set RAG_RRF_K=10
cd /d %~dp0
node src\app.js >> ..\backend-eval.log 2>&1
