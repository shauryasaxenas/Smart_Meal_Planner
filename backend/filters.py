"""
Constraint parsing and filtering helpers, ported from the notebook workflow.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

import pandas as pd

from .llm import get_response

CONSTRAINT_SCHEMA_HINT = """
Expected JSON keys (all optional):

- max_total_minutes: integer, total prep + cook time, e.g. 30
- cook_speed: "fast" | "medium" | "slow" | null
- difficulty_max: "easy" | "medium" | "hard" | null
- is_vegan: true/false/null
- is_vegetarian: true/false/null
- is_gluten_free: true/false/null
- is_dairy_free: true/false/null
- is_nut_free: true/false/null
- is_halal: true/false/null
- is_kosher: true/false/null
- tastes_include: array of taste words, e.g. ["spicy", "savory"]
- tastes_exclude: array of taste words
- cuisines_include: array of strings, e.g. ["asian", "mediterranean"]
- healthiness_min: integer 0–100
- num_results: integer, number of recipes to recommend
""".strip()

TASTE_VOCAB = {"sweet", "spicy", "savory", "sour", "bitter", "umami"}


def _first_json_object(text: str) -> str | None:
    """Grab the first {...} block from a model response."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start = cleaned.find("{")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(cleaned[start:], start=start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return cleaned[start : i + 1]
    return None


def parse_user_goals(user_text: str) -> Dict[str, Any]:
    """
    Use Qwen to turn free-form user text into a constraints dict that maps
    directly to columns in the recipes DataFrame.
    """
    prompt = f"""
You are a meal-planning constraints extractor for a recipe recommender.

User goals:
\"\"\"{user_text}\"\"\"

{CONSTRAINT_SCHEMA_HINT}

Rules:
- Infer only what is clearly implied (e.g., "quick" -> max_total_minutes ≈ 30, cook_speed "fast").
- Map "healthy" or "very healthy" to healthiness_min (e.g., 60–80).
- If a field is not mentioned, set it to null or omit it.
- Use true/false/null for dietary flags.
- Output STRICT JSON only (no prose, no code fences).
"""

    _, raw = get_response(prompt, enable_thinking=False, max_new_tokens=400, temperature=0.2)
    blob = _first_json_object(raw) or raw
    try:
        return json.loads(blob)
    except Exception:  # noqa: BLE001
        return {}


def normalize_constraints(c: dict | None) -> dict:
    """
    - Move non-taste items from tastes_include into cuisines_include.
    - Keep everything else as-is.
    """
    c = dict(c or {})
    tastes_inc = list(c.get("tastes_include") or [])
    cuisines_inc = list(c.get("cuisines_include") or [])

    real_tastes: List[str] = []
    misfiled_cuisines: List[str] = []

    for t in tastes_inc:
        if not t:
            continue
        if t.lower() in TASTE_VOCAB:
            real_tastes.append(t)
        else:
            misfiled_cuisines.append(t)

    c["tastes_include"] = real_tastes
    c["cuisines_include"] = cuisines_inc + misfiled_cuisines
    return c


def filter_recipes_by_constraints(recipes_df: pd.DataFrame, constraints: Dict[str, Any]) -> pd.Index:
    """
    Apply constraints to the full recipes DataFrame and return the indices of rows that match.
    """
    df = recipes_df.copy()
    c = constraints or {}

    # Time
    max_total = c.get("max_total_minutes")
    if max_total is not None:
        total_time = df["est_prep_time_min"].fillna(0) + df["est_cook_time_min"].fillna(0)
        df = df[total_time <= max_total]

    # Cook speed
    cook_speed = c.get("cook_speed")
    if cook_speed:
        if isinstance(cook_speed, str):
            cook_speed = [cook_speed]
        df = df[df["cook_speed"].isin(cook_speed)]

    # Difficulty (difficulty_max as upper bound)
    difficulty_order = ["easy", "medium", "hard"]
    difficulty_max = c.get("difficulty_max")
    if difficulty_max in difficulty_order:
        max_idx = difficulty_order.index(difficulty_max)
        allowed = set(difficulty_order[: max_idx + 1])
        df = df[df["difficulty"].isin(allowed)]

    # Dietary flags
    for flag in ["is_vegan", "is_vegetarian", "is_gluten_free", "is_dairy_free", "is_nut_free", "is_halal", "is_kosher"]:
        val = c.get(flag)
        if val is True:
            df = df[df[flag] == True]  # noqa: E712

    # Taste preferences
    tastes_inc: List[str] = c.get("tastes_include") or []
    tastes_exc: List[str] = c.get("tastes_exclude") or []

    if tastes_inc:
        for t in tastes_inc:
            df = df[df["tastes"].fillna("").astype(str).str.contains(t, case=False)]

    if tastes_exc:
        for t in tastes_exc:
            df = df[~df["tastes"].fillna("").astype(str).str.contains(t, case=False)]

    # Cuisines
    cuisines_inc: List[str] = c.get("cuisines_include") or []
    if cuisines_inc:
        for cu in cuisines_inc:
            df = df[df["cuisine_list"].fillna("").astype(str).str.contains(cu, case=False)]

    # Healthiness
    if c.get("healthiness_min") is not None:
        df = df[df["healthiness_score"] >= c["healthiness_min"]]

    return df.index


__all__ = [
    "CONSTRAINT_SCHEMA_HINT",
    "filter_recipes_by_constraints",
    "normalize_constraints",
    "parse_user_goals",
]
