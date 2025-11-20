"""
Similarity engine: TF-IDF + numeric features for recipe matching.

This module loads the recipe dataset once, builds combined feature vectors,
and exposes a cosine-similarity helper that mirrors the notebook logic.
"""

from __future__ import annotations

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


@lru_cache(maxsize=1)
def load_similarity_assets() -> Tuple[pd.DataFrame, pd.DataFrame, csr_matrix, TfidfVectorizer, StandardScaler]:
    """
    Load the dataset and build the combined TF-IDF + numeric feature matrix.
    Returned objects are cached so we only do this heavy work once.
    """
    data_path = _locate_dataset()
    recipes = pd.read_csv(data_path)

    selected_columns = [
        "recipe_title",
        "category",
        "subcategory",
        "description",
        "ingredients",
        "num_ingredients",
        "cook_speed",
        "est_cook_time_min",
        "healthiness_score",
    ]

    reduced_df = recipes[selected_columns].copy()
    reduced_df["content"] = (
        reduced_df["recipe_title"].fillna("")
        + " "
        + reduced_df["category"].fillna("")
        + " "
        + reduced_df["subcategory"].fillna("")
        + " "
        + reduced_df["description"].fillna("")
        + " "
        + reduced_df["ingredients"].fillna("")
        + " "
        + reduced_df["cook_speed"].fillna("")
    )

    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    tfidf_matrix = vectorizer.fit_transform(reduced_df["content"])

    numeric_features = reduced_df[["num_ingredients", "est_cook_time_min", "healthiness_score"]].fillna(0)
    scaler = StandardScaler()
    numeric_scaled = scaler.fit_transform(numeric_features)

    combined_features = hstack([tfidf_matrix, csr_matrix(numeric_scaled * NUMERIC_WEIGHT)])

    return recipes, reduced_df, combined_features, vectorizer, scaler


def get_recipe_row(recipe_index: int) -> pd.Series:
    recipes, _, _, _, _ = load_similarity_assets()
    return recipes.loc[recipe_index]


def get_top_similar_recipes(recipe_index: int, top_n: int = 10) -> pd.DataFrame:
    """
    Given a recipe index, return the top N most similar recipes based on the
    combined feature vectors. Duplicate titles are dropped and the anchor
    recipe itself is removed.
    """
    if recipe_index is None:
        return pd.DataFrame()

    recipes, reduced_df, combined_features, _, _ = load_similarity_assets()

    if recipe_index < 0 or recipe_index >= combined_features.shape[0]:
        raise IndexError(f"Recipe index {recipe_index} out of bounds for {combined_features.shape[0]} rows.")

    sim_scores = cosine_similarity(combined_features[recipe_index], combined_features).flatten()
    sim_df = pd.DataFrame(
        {
            "recipe_title": reduced_df["recipe_title"],
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
