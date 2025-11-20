"""
End-to-end recommendation pipeline.

Flow:
1. Parse user text into constraints (LLM)
2. Normalize constraints
3. Filter recipes + pick anchor
4. Find similar recipes
5. Ask LLM for a user-friendly explanation
"""

from __future__ import annotations

import json
from textwrap import shorten
from typing import Any, Dict, List

import pandas as pd

from .filters import filter_recipes_by_constraints, normalize_constraints, parse_user_goals
from .llm import get_response, load_llm
from .similarity_engine import get_recipe_row, get_top_similar_recipes, load_similarity_assets


def pick_anchor_recipe_index(candidate_idx: pd.Index) -> int | None:
    """
    Deterministically pick an anchor recipe from the candidate pool.
    Currently: highest healthiness within the filtered set.
    """
    if len(candidate_idx) == 0:
        return None
    recipes, _, _, _, _ = load_similarity_assets()
    subset = recipes.loc[candidate_idx]
    best = subset.sort_values(by="healthiness_score", ascending=False).index
    return int(best[0]) if len(best) else None


def get_similar_recipes_with_constraints(anchor_index: int, candidate_idx: pd.Index, top_n: int = 5) -> pd.DataFrame:
    """
    Use the similarity engine, then intersect with the constraint-filtered set.
    """
    if anchor_index is None:
        return pd.DataFrame()

    raw_sim = get_top_similar_recipes(anchor_index, top_n=50)
    filtered = raw_sim[raw_sim.index.isin(candidate_idx)]
    return filtered.head(top_n)


def _summarize_recipe_by_index(idx: int) -> str:
    recipes, _, _, _, _ = load_similarity_assets()
    row = recipes.loc[idx]
    total_time = (row.get("est_prep_time_min", 0) or 0) + (row.get("est_cook_time_min", 0) or 0)
    desc = (
        f"{row.get('recipe_title', '(unknown)')}: "
        f"time ~{total_time} min, "
        f"speed={row.get('cook_speed')}, "
        f"diff={row.get('difficulty')}, "
        f"tastes={row.get('tastes')}, "
        f"health={row.get('healthiness_score')}, "
        f"main_ingredient={row.get('main_ingredient')}"
    )
    return shorten(str(desc), width=220)


def explain_recommendations(user_text: str, constraints: dict, anchor_index: int, similar_df: pd.DataFrame) -> str:
    if anchor_index is None or similar_df.empty:
        return "I couldn't find any recipes that match those constraints."

    base_summary = _summarize_recipe_by_index(anchor_index)
    sim_summaries = "\n".join(f"- {_summarize_recipe_by_index(idx)}" for idx in similar_df.index)

    prompt = f"""
You are Smart Meal Planner, explaining recipe recommendations to a user.

User goals:
\"\"\"{user_text}\"\"\"

Interpreted constraints (JSON, may be partial):
{json.dumps(constraints, indent=2)}

Base recipe we anchored on:
{base_summary}

Top similar recipes that also match the constraints:
{sim_summaries}

Explain in a short paragraph:
- Why these recipes fit the user's goals (time, diet, healthiness, taste, etc.).
- How they differ from each other (e.g., fastest vs healthiest vs simplest).
- End with a brief bullet list recommending 2–3 to try first.
Keep it concise and user-friendly.
"""

    _, answer = get_response(prompt, enable_thinking=False, max_new_tokens=600, temperature=0.3)
    return answer


def _serialize_recipe_row(row: pd.Series, similarity_score: float | None = None) -> dict:
    total_time = float((row.get("est_prep_time_min", 0) or 0) + (row.get("est_cook_time_min", 0) or 0))
    return {
        "id": int(row.name),
        "title": row.get("recipe_title"),
        "cook_speed": row.get("cook_speed"),
        "difficulty": row.get("difficulty"),
        "healthiness_score": float(row.get("healthiness_score", 0) or 0),
        "tastes": row.get("tastes"),
        "cuisine_list": row.get("cuisine_list"),
        "main_ingredient": row.get("main_ingredient"),
        "est_prep_time_min": float(row.get("est_prep_time_min", 0) or 0),
        "est_cook_time_min": float(row.get("est_cook_time_min", 0) or 0),
        "total_time_min": total_time,
        "similarity_score": float(similarity_score) if similarity_score is not None else None,
        "description": row.get("description"),
        "ingredients": row.get("ingredients"),
    }


def recommend_from_text(user_text: str, top_n: int = 5) -> dict:
    """
    Full pipeline:
    - LLM parses user_text -> constraints
    - Normalize constraints
    - Filter recipes DataFrame
    - If no candidates, relax a bit and try again
    - Pick an anchor recipe
    - Find similar recipes
    - LLM explains the recommendations
    """
    recipes, _, _, _, _ = load_similarity_assets()

    constraints_raw = parse_user_goals(user_text)
    constraints = normalize_constraints(constraints_raw)

    candidate_idx = filter_recipes_by_constraints(recipes, constraints)

    result: Dict[str, Any] = {
        "constraints": constraints,
        "candidate_count": int(len(candidate_idx)),
        "anchor_recipe": None,
        "similar_recipes": [],
        "explanation": "",
        "used_relaxation": False,
    }

    if len(candidate_idx) == 0:
        relaxed = dict(constraints)
        relaxed.pop("cook_speed", None)
        if "healthiness_min" in relaxed and relaxed["healthiness_min"] is not None:
            relaxed["healthiness_min"] = max(0, relaxed["healthiness_min"] - 10)

        candidate_idx_relaxed = filter_recipes_by_constraints(recipes, relaxed)

        if len(candidate_idx_relaxed) > 0:
            constraints = relaxed
            candidate_idx = candidate_idx_relaxed
            result["constraints"] = constraints
            result["candidate_count"] = int(len(candidate_idx_relaxed))
            result["used_relaxation"] = True
        else:
            result["explanation"] = (
                "No recipes matched your constraints, even after relaxing cook speed and healthiness slightly. "
                "Try loosening your request (e.g., allow medium time or broader cuisines)."
            )
            return result

    num_results = constraints.get("num_results") or top_n
    anchor_idx = pick_anchor_recipe_index(candidate_idx)

    if anchor_idx is None:
        result["explanation"] = "Could not select an anchor recipe from the candidates."
        return result

    anchor_row = get_recipe_row(anchor_idx)
    result["anchor_recipe"] = _serialize_recipe_row(anchor_row, similarity_score=1.0)

    similar_df = get_similar_recipes_with_constraints(anchor_idx, candidate_idx, top_n=num_results)
    result["similar_recipes"] = [
        _serialize_recipe_row(get_recipe_row(idx), similarity_score=similar_df.loc[idx, "similarity_score"])
        for idx in similar_df.index
    ]

    result["explanation"] = explain_recommendations(user_text, constraints, anchor_idx, similar_df)
    return result


def warm_up() -> None:
    """
    Load heavy assets (model + dataset) once at startup.
    """
    load_llm()
    load_similarity_assets()


__all__ = [
    "recommend_from_text",
    "warm_up",
]
