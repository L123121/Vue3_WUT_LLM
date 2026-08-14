@echo off
REM Start backend: weighted fusion + MMR disabled (A/B quantification)
set RAG_FUSION=weighted
set RAG_MMR_ENABLED=false
cd /d %~dp0
node src\app.js >> ..\backend-eval.log 2>&1
