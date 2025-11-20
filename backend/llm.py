"""
LLM helpers for the Smart Meal Planner backend.

We load a local Qwen3 model via HuggingFace `transformers`, keep it cached, and
provide a simple `get_response` helper that mirrors the notebook behavior
(chat template + optional <think> handling).
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Tuple

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

try:
    # Optional, but lets us pick up HF_TOKEN / QWEN_USE_SMALL_MODEL from a .env file.
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path(".env"))
except Exception:
    # If python-dotenv isn't installed, we just skip .env loading.
    pass

DEFAULT_MODEL_4B = "Qwen/Qwen3-4B"
DEFAULT_MODEL_SMALL = "Qwen/Qwen3-1.7B"


def _bool_env(name: str, default: bool = False) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.lower() in {"1", "true", "yes", "y", "on"}


def _detect_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    has_mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    if has_mps:
        return "mps"
    return "cpu"


def _resolve_model_id() -> str:
    if _bool_env("QWEN_USE_SMALL_MODEL", False):
        return os.getenv("QWEN_SMALL_MODEL_ID", DEFAULT_MODEL_SMALL)
    return os.getenv("QWEN_MODEL_ID", DEFAULT_MODEL_4B)


@lru_cache(maxsize=1)
def load_llm() -> Tuple[AutoTokenizer, AutoModelForCausalLM, str]:
    """
    Load/tokenizer/model once and cache them. Respects a few env vars:
    - QWEN_MODEL_ID to override the default 4B ID
    - QWEN_USE_SMALL_MODEL (truthy) to force the 1.7B model
    - HF_TOKEN if the model is gated
    """
    model_id = _resolve_model_id()
    device = _detect_device()

    quant_config = None
    dtype = torch.float32

    if device == "cuda":
        try:
            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
            dtype = torch.bfloat16
        except Exception as exc:  # noqa: BLE001
            # Quantization isn't available; fall back gracefully.
            print(f"NF4 quantization unavailable, using bfloat16 instead: {exc}")
            dtype = torch.bfloat16
    elif device == "mps":
        dtype = torch.float16  # MPS prefers float16

    tokenizer = AutoTokenizer.from_pretrained(
        model_id,
        use_fast=False,
        trust_remote_code=True,
        token=os.getenv("HF_TOKEN"),
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        quantization_config=quant_config,
        torch_dtype=None if quant_config else dtype,
        trust_remote_code=True,
        token=os.getenv("HF_TOKEN"),
    )

    model.to(device)

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model.eval()
    return tokenizer, model, device


def get_response(
    prompt: str,
    *,
    enable_thinking: bool = False,
    max_new_tokens: int = 512,
    temperature: float = 0.2,
    top_p: float = 0.9,
) -> tuple[str, str]:
    """
    Generate a response using the cached Qwen3 model.

    Returns a tuple of (thinking_trace, final_text). The thinking_trace is
    non-empty only when `enable_thinking=True` and the model emits <think>...</think>.
    """
    tokenizer, model, _ = load_llm()

    messages = [{"role": "user", "content": prompt}]
    chat_text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=enable_thinking,
    )
    inputs = tokenizer([chat_text], return_tensors="pt")
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    with torch.no_grad():
        generated = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
        )

    new_tokens = generated[0, inputs["input_ids"].shape[-1] :]
    text = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

    if enable_thinking and "</think>" in text:
        think, final = text.split("</think>", 1)
        think = think.replace("<think>", "").strip()
        return think, final.strip()

    return "", text


__all__ = ["get_response", "load_llm"]
