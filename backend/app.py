"""
FastAPI backend for Smart Meal Planner.

Endpoint:
POST /submit
Body: {"user_message": "...", "top_n": 5}
Response: anchor recipe, similar recipes, explanation, and the parsed constraints.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .pipeline import recommend_from_text, recipe_details_by_title, warm_up


class SubmitRequest(BaseModel):
    user_message: str = Field(..., min_length=1)
    top_n: int = Field(5, ge=1, le=20, description="How many similar recipes to return.")
    baseline_constraints: Dict[str, Any] | None = Field(
        None,
        description="Optional baseline constraints (e.g., dietary flags, cuisines) gathered from the survey.",
    )


class RecipeCard(BaseModel):
    id: int
    title: Optional[str] = None
    cook_speed: Optional[str] = None
    difficulty: Optional[str] = None
    healthiness_score: Optional[float] = None
    tastes: Optional[str] = None
    cuisine_list: Optional[str] = None
    main_ingredient: Optional[str] = None
    est_prep_time_min: Optional[float] = None
    est_cook_time_min: Optional[float] = None
    total_time_min: Optional[float] = None
    similarity_score: Optional[float] = Field(None, description="1.0 for anchor, cosine similarity otherwise.")
    description: Optional[str] = None
    ingredients: Optional[str] = None


class SubmitResponse(BaseModel):
    constraints: Dict[str, Any]
    candidate_count: int
    used_relaxation: bool = False
    anchor_recipe: Optional[RecipeCard]
    similar_recipes: List[RecipeCard]
    explanation: str


class RecipeDetailRequest(BaseModel):
    recipe_query: str = Field(..., min_length=1, description="Title or partial title to look up.")


class RecipeDetailResponse(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    cook_speed: Optional[str] = None
    difficulty: Optional[str] = None
    total_time_min: Optional[float] = None
    ingredients_list: List[str] = []
    directions_list: List[str] = []


app = FastAPI(title="Smart Meal Planner API", version="0.1.0")

# Allow the React frontend to call us locally.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    # Warm up heavy assets (model + similarity features) once.
    # Can be skipped by setting SKIP_WARM_UP=1 to avoid auto-loading the LLM at startup.
    if os.getenv("SKIP_WARM_UP") not in {"1", "true", "yes", "on"}:
        warm_up()


@app.post("/submit", response_model=SubmitResponse)
def submit(request: SubmitRequest) -> SubmitResponse:
    try:
        result = recommend_from_text(
            request.user_message,
            top_n=request.top_n,
            baseline_constraints=request.baseline_constraints,
        )
    except Exception as exc:  # noqa: BLE001
        # Surface a clean error to the frontend.
        raise HTTPException(status_code=500, detail=f"Failed to generate recommendation: {exc}") from exc

    return SubmitResponse(**result)


@app.post("/recipe_details", response_model=RecipeDetailResponse)
def recipe_details(request: RecipeDetailRequest) -> RecipeDetailResponse:
    detail = recipe_details_by_title(request.recipe_query)
    if detail is None:
        raise HTTPException(status_code=404, detail="Recipe not found.")
    return RecipeDetailResponse(**detail)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=False,
    )
