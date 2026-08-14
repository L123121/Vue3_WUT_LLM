@echo off
REM Start backend in weighted fusion mode for A/B comparison
set RAG_FUSION=weighted
echo [weighted-bat] RAG_FUSION=%RAG_FUSION% >> ..\backend-eval.log
cd /d %~dp0
node src\app.js >> ..\backend-eval.log 2>&1
