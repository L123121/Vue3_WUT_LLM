@echo off
REM Start backend: Qdrant vector store + weighted fusion (default production config)
set VECTOR_STORE_BACKEND=qdrant
set RAG_FUSION=weighted
cd /d %~dp0
node src\app.js >> ..\backend-eval.log 2>&1
