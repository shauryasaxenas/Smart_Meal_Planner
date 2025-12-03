"""
Similarity engine: TF-IDF + numeric features for recipe matching.

Updated to mirror the latest notebook logic:
- Parse list-like columns into text (dietary_profile, cuisine_list, tastes, health_flags)
- Include engineered total_time feature
- Combine richer text fields (combined_text + parsed lists + cook_speed + difficulty)
"""

from __future__ import annotations

import ast
import os
from functools import lru_cache
from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)

NUMERIC_WEIGHT = float(os.getenv("SIM_NUMERIC_WEIGHT", 1.5))


def _dataset_candidates() -> list[Path]:
    here = Path(__file__).resolve().parent
    project_root = here.parent
    return [
        here / "data" / "recipes_extended.csv",
        project_root / "filtering" / "recipes_extended.csv",
        project_root / "recipes_extended.csv",
    ]


def _locate_dataset() -> Path:
    for candidate in _dataset_candidates():
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not find recipes_extended.csv. Expected it under backend/data/ or filtering/."
    )


def _parse_list_like_to_text(x: object) -> str:
    """
    Convert stringified lists such as '["sweet","spicy"]' into 'sweet spicy'.
    Falls back to the raw string if parsing fails.
    """
    if isinstance(x, str):
        stripped = x.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                parsed = ast.literal_eval(stripped)
                if isinstance(parsed, list):
                    return " ".join(str(item) for item in parsed)
            except Exception:  # noqa: BLE001
                return x
        return stripped
    return ""


@lru_cache(maxsize=1)
def load_similarity_assets() -> Tuple[pd.DataFrame, pd.DataFrame, csr_matrix, TfidfVectorizer, StandardScaler]:
    """
    Load the dataset and build the combined TF-IDF + numeric feature matrix,
    with richer text features and engineered total_time.
    Returned objects are cached so we only do this heavy work once per process.
    """
    data_path = _locate_dataset()
    recipes = pd.read_csv(data_path)

    feature_df = recipes.copy()
    feature_df["total_time"] = feature_df["est_prep_time_min"].fillna(0) + feature_df["est_cook_time_min"].fillna(0)

    # Parse list-like columns into space-separated tokens for TF-IDF.
    feature_df["dietary_profile_text"] = feature_df.get("dietary_profile", "").apply(_parse_list_like_to_text)
    feature_df["cuisine_list_text"] = feature_df.get("cuisine_list", "").apply(_parse_list_like_to_text)
    feature_df["tastes_text"] = feature_df.get("tastes", "").apply(_parse_list_like_to_text)
    feature_df["health_flags_text"] = feature_df.get("health_flags", "").apply(_parse_list_like_to_text)

    # Combined textual signal (aligned with the provided notebook code).
    feature_df["content"] = (
        feature_df.get("combined_text", "").fillna("")
        + " "
        + feature_df["dietary_profile_text"].fillna("")
        + " "
        + feature_df["cuisine_list_text"].fillna("")
        + " "
        + feature_df["tastes_text"].fillna("")
        + " "
        + feature_df["health_flags_text"].fillna("")
        + " "
        + feature_df.get("cook_speed", "").fillna("")
        + " "
        + feature_df.get("difficulty", "").fillna("")
    )

    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    tfidf_matrix = vectorizer.fit_transform(feature_df["content"])

    numeric_features = feature_df[["num_ingredients", "total_time", "healthiness_score"]].fillna(0)
    scaler = StandardScaler()
    numeric_scaled = scaler.fit_transform(numeric_features)

    combined_features = hstack([tfidf_matrix, csr_matrix(numeric_scaled * NUMERIC_WEIGHT)])

    return recipes, feature_df, combined_features, vectorizer, scaler


def get_recipe_row(recipe_index: int) -> pd.Series:
    recipes, _, _, _, _ = load_similarity_assets()
    return recipes.loc[recipe_index]


def find_recipe_index_by_title(title_query: str) -> int | None:
    """
    Try to find a recipe index by (case-insensitive) title substring match.
    Returns the first match or None.
    """
    if not title_query:
        return None
    recipes, _, _, _, _ = load_similarity_assets()
    mask = recipes["recipe_title"].fillna("").str.contains(title_query, case=False, na=False)
    matches = recipes[mask]
    if matches.empty:
        return None
    return int(matches.index[0])


def get_top_similar_recipes(recipe_index: int, top_n: int = 10) -> pd.DataFrame:
    """
    Given a recipe index, return the top N most similar recipes based on the
    combined feature vectors. Duplicate titles are dropped and the anchor
    recipe itself is removed.
    """
    if recipe_index is None:
        return pd.DataFrame()

    recipes, feature_df, combined_features, _, _ = load_similarity_assets()

    if recipe_index < 0 or recipe_index >= combined_features.shape[0]:
        raise IndexError(f"Recipe index {recipe_index} out of bounds for {combined_features.shape[0]} rows.")

    sim_scores = cosine_similarity(combined_features[recipe_index], combined_features).flatten()
    sim_df = pd.DataFrame(
        {
            "recipe_title": feature_df["recipe_title"],
            "similarity_score": sim_scores,
        }
    )

    sim_df = sim_df.sort_values(by="similarity_score", ascending=False)
    sim_df = sim_df.drop_duplicates(subset="recipe_title", keep="first")
    sim_df = sim_df[sim_df.index != recipe_index]

    return sim_df.head(top_n)


__all__ = [
    "get_recipe_row",
    "get_top_similar_recipes",
    "load_similarity_assets",
]
