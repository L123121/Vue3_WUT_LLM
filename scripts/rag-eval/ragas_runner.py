#!/usr/bin/env python3
"""
Run official RAGAS metrics over samples exported from the Node.js backend.

Input rows can use either the project fields:
  question/query, answer, contexts/retrieved_contexts/retrieved_docs, ground_truth/reference
or RAGAS-style fields:
  user_input, response, retrieved_contexts, reference
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import types
from datetime import datetime, timezone
from importlib import import_module, metadata
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]

METRIC_ALIASES = {
    "faithfulness": ["faithfulness"],
    "answer_relevancy": ["answer_relevancy", "answer_relevance", "response_relevancy"],
    "context_precision": [
        "context_precision",
        "llm_context_precision_with_reference",
        "context_precision_with_reference",
    ],
    "context_recall": ["context_recall", "llm_context_recall"],
}

DEFAULT_METRICS = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]

def install_ragas_optional_shims() -> None:
    """Patch optional imports that some RAGAS versions require at import time."""
    module_name = "langchain_community.chat_models.vertexai"
    if module_name not in sys.modules:
        module = types.ModuleType(module_name)

        class ChatVertexAI:  # pragma: no cover - only used to satisfy optional imports
            pass

        module.ChatVertexAI = ChatVertexAI
        sys.modules[module_name] = module


def load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except Exception:
        return

    for env_path in [PROJECT_ROOT / ".env", PROJECT_ROOT / "backend" / ".env", SCRIPT_DIR / ".env"]:
        if env_path.exists():
            load_dotenv(env_path, override=False)


def env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def normalize_openai_base_url(raw: str, provider_default_version: str = "/v2") -> str:
    base_url = (raw or "").rstrip("/")
    if not base_url:
        return ""
    if re.search(r"/v\d+$", base_url):
        return base_url
    if "api.openai.com" in base_url:
        return f"{base_url}/v1"
    return f"{base_url}{provider_default_version}"


def normalize_embedding_base_url() -> str:
    explicit = env_first("RAGAS_EMBEDDING_BASE_URL", "OPENAI_EMBEDDING_BASE_URL")
    if explicit:
        return normalize_openai_base_url(explicit)

    host = env_first("XUNFEI_EMBEDDING_HOST")
    if host:
        if not host.startswith(("http://", "https://")):
            host = f"https://{host}"
        return normalize_openai_base_url(host)

    return normalize_openai_base_url(env_first("OPENAI_BASE_URL", "AI_BASE_URL"))


def configure_openai_env() -> dict[str, str]:
    api_key = env_first("RAGAS_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_API_KEY")
    base_url = normalize_openai_base_url(env_first("RAGAS_OPENAI_BASE_URL", "OPENAI_BASE_URL", "AI_BASE_URL"))
    model = env_first("RAGAS_LLM_MODEL", "OPENAI_MODEL", "AI_MODEL", default="gpt-4o-mini")

    embedding_api_key = env_first(
        "RAGAS_EMBEDDING_API_KEY",
        "OPENAI_EMBEDDING_API_KEY",
        "XUNFEI_API_KEY",
        "OPENAI_API_KEY",
        "AI_API_KEY",
    )
    embedding_base_url = normalize_embedding_base_url()
    embedding_model = env_first(
        "RAGAS_EMBEDDING_MODEL",
        "OPENAI_EMBEDDING_MODEL",
        "XUNFEI_EMBEDDING_MODEL",
        default="BGE-M3",
    )

    if api_key:
        os.environ.setdefault("OPENAI_API_KEY", api_key)
    if base_url:
        os.environ.setdefault("OPENAI_BASE_URL", base_url)
        os.environ.setdefault("OPENAI_API_BASE", base_url)
    if embedding_api_key:
        os.environ.setdefault("OPENAI_EMBEDDING_API_KEY", embedding_api_key)

    return {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "embedding_api_key": embedding_api_key,
        "embedding_base_url": embedding_base_url,
        "embedding_model": embedding_model,
    }


def load_rows(input_path: Path) -> list[dict[str, Any]]:
    raw = input_path.read_text(encoding="utf-8").strip()
    if not raw:
        return []

    if input_path.suffix.lower() == ".jsonl":
        return [json.loads(line) for line in raw.splitlines() if line.strip()]

    parsed = json.loads(raw)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ["samples", "results", "data"]:
            if isinstance(parsed.get(key), list):
                return parsed[key]
    raise ValueError(f"Unsupported input format: {input_path}")


def as_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        texts: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                texts.append(item.strip())
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content") or item.get("document")
                if isinstance(text, str) and text.strip():
                    texts.append(text.strip())
        return texts
    return []


def normalize_sample(row: dict[str, Any], index: int) -> dict[str, Any]:
    question = row.get("question") or row.get("query") or row.get("user_input") or ""
    answer = row.get("answer") or row.get("response") or ""
    contexts = as_text_list(row.get("contexts") or row.get("retrieved_contexts") or row.get("retrieved_docs"))
    ground_truth = row.get("ground_truth") or row.get("groundTruth") or row.get("reference") or ""

    return {
        **row,
        "id": row.get("id") or f"sample_{index + 1}",
        "question": question,
        "answer": answer,
        "contexts": contexts,
        "ground_truth": ground_truth,
        "category": row.get("category") or "default",
        "difficulty": row.get("difficulty") or "unknown",
    }


def select_valid_samples(samples: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    valid: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for sample in samples:
        missing = []
        if not sample["question"]:
            missing.append("question")
        if not sample["answer"]:
            missing.append("answer")
        if not sample["contexts"]:
            missing.append("contexts")
        if not sample["ground_truth"]:
            missing.append("ground_truth")
        if sample.get("error"):
            missing.append("error")

        if missing:
            skipped.append({**sample, "skip_reason": ",".join(missing)})
        else:
            valid.append(sample)

    return valid, skipped


def build_legacy_dataset(samples: list[dict[str, Any]]):
    from datasets import Dataset

    return Dataset.from_dict(
        {
            "question": [sample["question"] for sample in samples],
            "answer": [sample["answer"] for sample in samples],
            "contexts": [sample["contexts"] for sample in samples],
            "ground_truth": [sample["ground_truth"] for sample in samples],
        }
    )


def build_modern_dataset(samples: list[dict[str, Any]]):
    from datasets import Dataset

    return Dataset.from_list(
        [
            {
                "user_input": sample["question"],
                "response": sample["answer"],
                "retrieved_contexts": sample["contexts"],
                "reference": sample["ground_truth"],
            }
            for sample in samples
        ]
    )


def import_attr(module_name: str, names: list[str]):
    module = import_module(module_name)
    for name in names:
        if hasattr(module, name):
            return getattr(module, name)
    return None


def instantiate_metric(cls: Any, **kwargs: Any):
    kwargs = {key: value for key, value in kwargs.items() if value is not None}
    try:
        return cls(**kwargs)
    except TypeError:
        metric = cls()
        for key, value in kwargs.items():
            if hasattr(metric, key):
                setattr(metric, key, value)
        return metric


def _create_hf_embeddings(model_name: str = "BAAI/bge-small-zh-v1.5"):
    """Create local HuggingFace embeddings as fallback when API-based embeddings fail."""
    try:
        from langchain_huggingface import HuggingFaceEmbeddings
        print(f"[RAGAS] 使用本地 HuggingFace 模型做 embedding: {model_name}", file=sys.stderr)
        return HuggingFaceEmbeddings(model_name=model_name, model_kwargs={"trust_remote_code": True})
    except Exception as exc:
        print(f"[RAGAS] HuggingFaceEmbeddings 不可用，尝试 sentence-transformers: {exc}", file=sys.stderr)
        try:
            from langchain_community.embeddings import HuggingFaceEmbeddings as OldHuggingFaceEmbeddings
            return OldHuggingFaceEmbeddings(model_name=model_name)
        except Exception as exc2:
            print(f"[RAGAS] 所有本地 embedding 方案均失败: {exc2}", file=sys.stderr)
            return None

def create_langchain_models(config: dict[str, str]):
    try:
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
    except Exception as exc:
        print(f"[RAGAS] langchain-openai 不可用，将尝试使用 RAGAS 默认模型: {exc}", file=sys.stderr)
        return None, None

    llm = None
    embeddings = None

    try:
        llm_kwargs: dict[str, Any] = {
            "model": config["model"],
            "temperature": 0,
            "timeout": 180,
            "max_retries": 3,
            "max_tokens": 4096,
        }
        if config["api_key"]:
            llm_kwargs["api_key"] = config["api_key"]
        if config["base_url"]:
            llm_kwargs["base_url"] = config["base_url"]
        llm = ChatOpenAI(**llm_kwargs)
    except Exception as exc:
        print(f"[RAGAS] evaluator LLM 初始化失败，将尝试默认配置: {exc}", file=sys.stderr)

    # embedding：先试 API 方式，失败则降级到本地 HuggingFace
    try:
        embedding_kwargs: dict[str, Any] = {"model": config["embedding_model"]}
        if config["embedding_api_key"]:
            embedding_kwargs["api_key"] = config["embedding_api_key"]
        if config["embedding_base_url"]:
            embedding_kwargs["base_url"] = config["embedding_base_url"]
        embeddings = OpenAIEmbeddings(**embedding_kwargs)
        # 快速验证 embedding 是否真的可用（发一个测试请求）
        try:
            embeddings.embed_query("test")
        except Exception as verify_exc:
            print(f"[RAGAS] API embedding 验证失败，降级到本地模型: {verify_exc}", file=sys.stderr)
            embeddings = None
    except Exception as exc:
        print(f"[RAGAS] evaluator embedding 初始化失败，降级到本地模型: {exc}", file=sys.stderr)
        embeddings = None

    # 如果 API embedding 不可用，用本地 HuggingFace
    if embeddings is None:
        embeddings = _create_hf_embeddings()

    try:
        wrapper = import_attr("ragas.llms", ["LangchainLLMWrapper"])
        if wrapper and llm is not None:
            llm = wrapper(llm)
    except Exception as exc:
        print(f"[RAGAS] LLM wrapper 初始化失败，将直接传入 LangChain LLM: {exc}", file=sys.stderr)

    try:
        wrapper = import_attr("ragas.embeddings", ["LangchainEmbeddingsWrapper"])
        if wrapper and embeddings is not None:
            embeddings = wrapper(embeddings)
    except Exception as exc:
        print(f"[RAGAS] Embeddings wrapper 初始化失败，将直接传入 LangChain embeddings: {exc}", file=sys.stderr)

    return llm, embeddings


def parse_metrics(metrics_arg: str) -> list[str]:
    if not metrics_arg:
        return DEFAULT_METRICS
    requested = [item.strip() for item in metrics_arg.split(",") if item.strip()]
    aliases = {
        "answer_relevance": "answer_relevancy",
        "response_relevancy": "answer_relevancy",
        "llm_context_precision_with_reference": "context_precision",
        "llm_context_recall": "context_recall",
    }
    normalized = [aliases.get(item, item) for item in requested]
    return [item for item in DEFAULT_METRICS if item in normalized]


def run_legacy_ragas(samples: list[dict[str, Any]], metric_names: list[str], llm: Any, embeddings: Any):
    from ragas import evaluate
    import ragas.metrics as metrics_module

    metric_objects = []
    for metric_name in metric_names:
        metric = getattr(metrics_module, metric_name, None)
        if metric is None and metric_name == "answer_relevancy":
            metric = getattr(metrics_module, "answer_relevance", None)
        if metric is None:
            raise ImportError(f"legacy metric not found: {metric_name}")
        metric_objects.append(metric)

    dataset = build_legacy_dataset(samples)
    kwargs: dict[str, Any] = {}
    if llm is not None:
        kwargs["llm"] = llm
    if embeddings is not None:
        kwargs["embeddings"] = embeddings

    try:
        return evaluate(dataset, metrics=metric_objects, **kwargs)
    except TypeError:
        return evaluate(dataset, metrics=metric_objects)


def run_modern_ragas(samples: list[dict[str, Any]], metric_names: list[str], llm: Any, embeddings: Any):
    from ragas import evaluate

    metric_classes: dict[str, Any] = {
        "faithfulness": import_attr("ragas.metrics", ["Faithfulness"]),
        "answer_relevancy": import_attr("ragas.metrics", ["ResponseRelevancy", "AnswerRelevancy"]),
        "context_precision": import_attr(
            "ragas.metrics",
            ["LLMContextPrecisionWithReference", "ContextPrecision", "ContextPrecisionWithReference"],
        ),
        "context_recall": import_attr("ragas.metrics", ["LLMContextRecall", "ContextRecall"]),
    }

    metric_objects = []
    for metric_name in metric_names:
        metric_cls = metric_classes.get(metric_name)
        if metric_cls is None:
            raise ImportError(f"modern metric not found: {metric_name}")
        metric_objects.append(instantiate_metric(metric_cls, llm=llm, embeddings=embeddings))

    dataset = build_modern_dataset(samples)
    kwargs: dict[str, Any] = {}
    if llm is not None:
        kwargs["llm"] = llm
    if embeddings is not None:
        kwargs["embeddings"] = embeddings

    try:
        return evaluate(dataset, metrics=metric_objects, **kwargs)
    except TypeError:
        return evaluate(dataset, metrics=metric_objects)


def result_to_rows(result: Any) -> list[dict[str, Any]]:
    if hasattr(result, "to_pandas"):
        frame = result.to_pandas()
        return json.loads(frame.to_json(orient="records", force_ascii=False))
    if hasattr(result, "to_dict"):
        data = result.to_dict()
        if isinstance(data, dict):
            keys = list(data.keys())
            length = max((len(value) for value in data.values() if isinstance(value, list)), default=0)
            return [{key: data[key][index] for key in keys if isinstance(data.get(key), list)} for index in range(length)]
    if isinstance(result, list):
        return result
    raise TypeError("无法解析 RAGAS 返回结果")


def safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return max(0.0, min(1.0, number))


def pick_metric(row: dict[str, Any], canonical: str) -> float | None:
    for key in METRIC_ALIASES[canonical]:
        if key in row:
            value = safe_float(row[key])
            if value is not None:
                return value
    return None


def percent(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value * 100:.1f}%"


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def summarize_group(results: list[dict[str, Any]], group_key: str) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in results:
        groups.setdefault(str(item.get(group_key) or "unknown"), []).append(item)

    output = {}
    for key, items in groups.items():
        output[key] = {
            "count": len(items),
            "avg": {
                metric: percent(average([item["metrics"][metric] for item in items if item["metrics"].get(metric) is not None]))
                for metric in DEFAULT_METRICS + ["overall"]
            },
        }
    return output


def build_output(
    all_samples: list[dict[str, Any]],
    valid_samples: list[dict[str, Any]],
    skipped_samples: list[dict[str, Any]],
    ragas_rows: list[dict[str, Any]],
    metric_names: list[str],
    config: dict[str, str],
) -> dict[str, Any]:
    results = []
    for sample, row in zip(valid_samples, ragas_rows):
        metrics = {metric: pick_metric(row, metric) for metric in DEFAULT_METRICS}
        present_values = [value for value in metrics.values() if value is not None]
        metrics["overall"] = average(present_values)
        results.append(
            {
                "id": sample["id"],
                "question": sample["question"],
                "category": sample["category"],
                "difficulty": sample["difficulty"],
                "ground_truth": sample["ground_truth"],
                "answer": sample["answer"],
                "contexts": sample["contexts"],
                "sources": sample.get("sources", []),
                "retrieval": sample.get("retrieval"),
                "metrics": metrics,
            }
        )

    metric_averages = {
        metric: average([item["metrics"][metric] for item in results if item["metrics"].get(metric) is not None])
        for metric in DEFAULT_METRICS + ["overall"]
    }

    try:
        ragas_version = metadata.version("ragas")
    except Exception:
        ragas_version = "unknown"

    summary = {
        "total": len(all_samples),
        "evaluated": len(results),
        "skipped": len(skipped_samples),
        "warnings": len([sample for sample in all_samples if sample.get("warning")]),
        "errors": len([sample for sample in all_samples if sample.get("error")]),
        "overall": {metric: percent(value) for metric, value in metric_averages.items()},
        "byCategory": summarize_group(results, "category"),
        "byDifficulty": summarize_group(results, "difficulty"),
        "evaluator": {
            "framework": "ragas",
            "version": ragas_version,
            "metrics": metric_names,
            "llmModel": config["model"],
            "llmBaseUrl": config["base_url"],
            "embeddingModel": config["embedding_model"],
            "embeddingBaseUrl": config["embedding_base_url"],
        },
    }

    return {
        "summary": summary,
        "results": results,
        "skipped": [
            {
                "id": sample["id"],
                "question": sample["question"],
                "category": sample["category"],
                "difficulty": sample["difficulty"],
                "skip_reason": sample.get("skip_reason", "unknown"),
                "error": sample.get("error"),
                "warning": sample.get("warning"),
            }
            for sample in skipped_samples
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def save_csv(output: dict[str, Any], output_path: Path) -> None:
    csv_path = output_path.with_suffix(".csv")
    rows = output.get("results", [])
    with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
        fieldnames = ["id", "category", "difficulty", "faithfulness", "answer_relevancy", "context_precision", "context_recall", "overall", "question"]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for item in rows:
            writer.writerow(
                {
                    "id": item["id"],
                    "category": item["category"],
                    "difficulty": item["difficulty"],
                    "faithfulness": item["metrics"].get("faithfulness"),
                    "answer_relevancy": item["metrics"].get("answer_relevancy"),
                    "context_precision": item["metrics"].get("context_precision"),
                    "context_recall": item["metrics"].get("context_recall"),
                    "overall": item["metrics"].get("overall"),
                    "question": item["question"],
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run official RAGAS over exported RAG samples.")
    parser.add_argument("--input", required=True, help="Path to ragas-samples.json or .jsonl")
    parser.add_argument("--output", required=True, help="Path to write ragas-results.json")
    parser.add_argument("--metrics", default="", help="Comma-separated metric names")
    args = parser.parse_args()

    load_env_files()
    config = configure_openai_env()
    metric_names = parse_metrics(args.metrics)

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    samples = [normalize_sample(row, index) for index, row in enumerate(load_rows(input_path))]
    valid_samples, skipped_samples = select_valid_samples(samples)

    if not valid_samples:
        output = build_output(samples, [], skipped_samples, [], metric_names, config)
        output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        save_csv(output, output_path)
        print("[RAGAS] 没有可评测样本，已输出空报告")
        return 0

    install_ragas_optional_shims()
    llm, embeddings = create_langchain_models(config)

    print(f"[RAGAS] samples={len(valid_samples)} metrics={','.join(metric_names)}")
    print(f"[RAGAS] llm={config['model']} base={config['base_url'] or 'default'}")
    print(f"[RAGAS] embeddings={config['embedding_model']} base={config['embedding_base_url'] or 'default'}")

    try:
        ragas_result = run_legacy_ragas(valid_samples, metric_names, llm, embeddings)
    except Exception as legacy_exc:
        print(f"[RAGAS] legacy API failed, trying modern API: {legacy_exc}", file=sys.stderr)
        ragas_result = run_modern_ragas(valid_samples, metric_names, llm, embeddings)

    ragas_rows = result_to_rows(ragas_result)
    output = build_output(samples, valid_samples, skipped_samples, ragas_rows, metric_names, config)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    save_csv(output, output_path)

    print(f"[RAGAS] JSON report: {output_path}")
    print(f"[RAGAS] CSV report:  {output_path.with_suffix('.csv')}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ModuleNotFoundError as exc:
        print(f"[RAGAS] 缺少 Python 依赖: {exc}", file=sys.stderr)
        print("[RAGAS] 请执行: python -m pip install -r scripts/rag-eval/requirements.txt", file=sys.stderr)
        raise SystemExit(2)


