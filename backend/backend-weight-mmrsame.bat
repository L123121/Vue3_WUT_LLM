@echo off
REM Start backend: weighted fusion + MMR same-doc dedup (fixed logic, default enabled)
set RAG_FUSION=weighted
cd /d %~dp0
node src\app.js >> ..\backend-eval.log 2>&1
