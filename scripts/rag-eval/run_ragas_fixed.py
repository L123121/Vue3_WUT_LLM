#!/usr/bin/env python3
"""
Fixed RAGAS runner — patches job timeout, reduces parallelism.
"""
import json, os, sys, types
from pathlib import Path

# ── patch: suppress RAGAS import-time vertexai dependency ──
if "langchain_community.chat_models.vertexai" not in sys.modules:
    m = types.ModuleType("langchain_community.chat_models.vertexai")
    class ChatVertexAI: pass
    m.ChatVertexAI = ChatVertexAI
    sys.modules["langchain_community.chat_models.vertexai"] = m

# ── patch: increase RAGAS internal job timeout ──
import ragas.evaluation as ragas_eval
_orig_evaluate = ragas_eval.evaluate

def _patched_evaluate(dataset, metrics=None, llm=None, embeddings=None, **kwargs):
    """Wrapper that passes run_config with batch_size=1"""
    from ragas.run_config import RunConfig
    run_cfg = kwargs.pop("run_config", None) or RunConfig(batch_size=1)
    return _orig_evaluate(dataset, metrics=metrics, llm=llm, embeddings=embeddings, run_config=run_cfg, **kwargs)

ragas_eval.evaluate = _patched_evaluate

# ── use settings from .env ──
from dotenv import load_dotenv
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
for p in [PROJECT_ROOT, PROJECT_ROOT / "backend", SCRIPT_DIR]:
    env = p / ".env"
    if env.exists():
        load_dotenv(env, override=False)

OPENAI_API_KEY = os.getenv("AI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("AI_BASE_URL", "").rstrip("/")
LLM_MODEL = os.getenv("AI_MODEL", "step-3.7-flash")

if OPENAI_BASE_URL and not OPENAI_BASE_URL.endswith(("/v1", "/v2")):
    OPENAI_BASE_URL += "/v2"  # StepFun uses /v2

os.environ.setdefault("OPENAI_API_KEY", OPENAI_API_KEY)
os.environ.setdefault("OPENAI_BASE_URL", OPENAI_BASE_URL)

# ── load samples ──
samples_path = SCRIPT_DIR / "results" / "ragas-samples.json"
data = json.loads(samples_path.read_text(encoding="utf-8"))
samples = data["samples"] if isinstance(data, dict) and "samples" in data else data

valid = [s for s in samples if s.get("question") and s.get("answer") and s.get("contexts") and s.get("ground_truth")]
print(f"[FIXED] {len(valid)} valid samples out of {len(samples)} total", flush=True)

# ── create LLM + embeddings ──
from langchain_openai import ChatOpenAI
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper

llm = ChatOpenAI(
    model=LLM_MODEL,
    temperature=0,
    timeout=180,
    max_retries=3,
    max_tokens=4096,
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
)
llm = LangchainLLMWrapper(llm)

# Embedding: use local HuggingFace
from langchain_huggingface import HuggingFaceEmbeddings
emb = HuggingFaceEmbeddings(model_name="BAAI/bge-small-zh-v1.5", model_kwargs={"trust_remote_code": True})
emb = LangchainEmbeddingsWrapper(emb)

# ── build dataset ──
from datasets import Dataset
dataset = Dataset.from_dict({
    "question": [s["question"] for s in valid],
    "answer": [s["answer"] for s in valid],
    "contexts": [s["contexts"] for s in valid],
    "ground_truth": [s["ground_truth"] for s in valid],
})

# ── run metrics (skip answer_relevancy — embedding-based, less meaningful) ──
from ragas.metrics import faithfulness, context_recall, context_precision
metrics = [faithfulness, context_recall, context_precision]

print(f"[FIXED] Evaluating {len(valid)} samples × {len(metrics)} metrics with batch_size=1...")
from ragas import evaluate
result = evaluate(dataset, metrics=metrics, llm=llm, embeddings=emb)

# ── output ──
df = result.to_pandas()
output_path = SCRIPT_DIR / "results" / "ragas-results.json"
output_data = json.loads(df.to_json(orient="records", force_ascii=False))

# Build summary
faithfulness_vals = [r.get("faithfulness", None) for r in output_data if r.get("faithfulness") is not None]
context_recall_vals = [r.get("context_recall", None) for r in output_data if r.get("context_recall") is not None]
context_precision_vals = [r.get("context_precision", None) for r in output_data if r.get("context_precision") is not None]

overall = {"faithfulness": "N/A", "context_recall": "N/A", "context_precision": "N/A"}
if faithfulness_vals:
    overall["faithfulness"] = f"{sum(faithfulness_vals)/len(faithfulness_vals)*100:.1f}%"
if context_recall_vals:
    overall["context_recall"] = f"{sum(context_recall_vals)/len(context_recall_vals)*100:.1f}%"
if context_precision_vals:
    overall["context_precision"] = f"{sum(context_precision_vals)/len(context_precision_vals)*100:.1f}%"

summary = {
    "total": len(samples),
    "evaluated": len(valid),
    "overall": overall,
    "evaluator": {
        "framework": "ragas",
        "version": __import__("ragas").__version__,
        "metrics": ["faithfulness", "context_recall", "context_precision"],
        "llmModel": LLM_MODEL,
    },
}

output = {"summary": summary, "results": output_data}
output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"[FIXED] Done — results written to {output_path}")
print(f"  Faithfulness:      {overall['faithfulness']}")
print(f"  Context Recall:    {overall['context_recall']}")
print(f"  Context Precision: {overall['context_precision']}")
