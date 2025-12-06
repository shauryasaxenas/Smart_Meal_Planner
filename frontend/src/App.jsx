// src/App.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [surveyStep, setSurveyStep] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [surveyResponses, setSurveyResponses] = useState([]);
  const [baselineConstraints, setBaselineConstraints] = useState(null);
  const messagesEndRef = useRef(null);

  const surveyQuestions = [
    {
      question: "Welcome! Quick survey so we can start with relevant ideas.\nWhich cuisines do you enjoy?",
      options: [
        { label: "European", value: "european" },
        { label: "French", value: "french" },
        { label: "Asian", value: "asian" },
        { label: "Mediterranean", value: "mediterranean" },
        { label: "American (region)", value: "american_region" },
        { label: "American (general)", value: "american" },
        { label: "Italian", value: "italian" },
        { label: "Korean", value: "korean" },
        { label: "Greek", value: "greek" },
        { label: "Chinese", value: "chinese" },
        { label: "Thai", value: "thai" },
        { label: "Caribbean", value: "caribbean" },
        { label: "Middle Eastern", value: "middle eastern region" },
        { label: "No preference", value: "__none__" },
      ],
    },
    {
      question: "Do you have any dietary needs?",
      options: [
        { label: "Vegan", value: "is_vegan" },
        { label: "Vegetarian", value: "is_vegetarian" },
        { label: "Gluten-free", value: "is_gluten_free" },
        { label: "Nut-free", value: "is_nut_free" },
        { label: "Dairy-free", value: "is_dairy_free" },
        { label: "Halal", value: "is_halal" },
        { label: "Kosher", value: "is_kosher" },
        { label: "None", value: "__none__" },
      ],
    },
    {
      question: "How much time/effort are you looking for?",
      options: [
        { label: "Fast (most under ~45 min)", value: "fast" },
        { label: "Medium", value: "medium" },
        { label: "Slow (long simmer/bake)", value: "slow" },
        { label: "No preference", value: "__none__" },
      ],
    },
    {
      question: "What kind of dish?",
      options: [
        { label: "Main", value: "main" },
        { label: "Side", value: "side" },
        { label: "Breakfast", value: "breakfast" },
        { label: "Snack", value: "snack" },
        { label: "Dessert", value: "dessert" },
        { label: "Soup", value: "soup" },
        { label: "Drink", value: "drink" },
        { label: "Bread", value: "bread" },
        { label: "No preference", value: "__none__" },
      ],
    },
  ];

  const formatContent = (value) => {
    if (!value) return "";
    // Strip simple markdown bold markers for cleaner display.
    return value.replace(/\*\*(.*?)\*\*/g, "$1");
  };

  const isRecipeDetailQuery = (textValue) => {
    if (!textValue) return false;
    const lowered = textValue.toLowerCase();
    return (
      lowered.startsWith("how do i make") ||
      lowered.startsWith("how to make") ||
      lowered.startsWith("recipe for") ||
      lowered.includes("ingredients for") ||
      lowered.includes("directions for")
    );
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!hasStarted) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [hasStarted, messages]);

  // Kick off survey prompt
  useEffect(() => {
    if (!hasStarted) return;
    if (surveyStep === 0 && messages.length === 0) {
      setMessages([{ role: "bot", content: surveyQuestions[0].question }]);
    }
  }, [hasStarted, surveyStep, messages.length]);

  const computeBaselineConstraints = (responses) => {
    const constraints = {};
    const stripNone = (arr) => (arr || []).filter((v) => v !== "__none__");

    // Q1 cuisines
    const cuisines = stripNone(responses[0]);
    if (cuisines.length) {
      constraints.cuisines_include = cuisines.map((c) => c.toLowerCase());
    }

    // Q2 dietary
    const diet = stripNone(responses[1]);
    if (diet.includes("is_vegan")) constraints.is_vegan = true;
    if (diet.includes("is_vegetarian")) constraints.is_vegetarian = true;
    if (diet.includes("is_gluten_free")) constraints.is_gluten_free = true;
    if (diet.includes("is_nut_free")) constraints.is_nut_free = true;
    if (diet.includes("is_dairy_free")) constraints.is_dairy_free = true;
    if (diet.includes("is_halal")) constraints.is_halal = true;
    if (diet.includes("is_kosher")) constraints.is_kosher = true;

    // Q3 prep style -> cook_speed/time
    const prep = stripNone(responses[2]);
    const wantsFast = prep.includes("fast");
    const wantsMedium = prep.includes("medium");
    const wantsSlow = prep.includes("slow");

    // Only set cook_speed if they gave a clear single intent; avoid over-constraining.
    if (wantsFast + wantsMedium + wantsSlow === 1) {
      if (wantsFast) constraints.cook_speed = "fast";
      if (wantsMedium) constraints.cook_speed = "medium";
      if (wantsSlow) constraints.cook_speed = "slow";
    }

    // Q4 time-of-day -> course hint
    const times = stripNone(responses[3]);
    if (times.length) constraints.course_list = times;

    return Object.keys(constraints).length ? constraints : null;
  };

  const requestRecommendation = async (userText, baseline = null) => {
    setLoading(true);
    try {
      const response = await fetch("http://localhost:8000/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: userText,
          top_n: 5,
          baseline_constraints: baseline,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || response.statusText || "Unknown error");
      }

      const data = await response.json();
      const recipeList = (data.similar_recipes || [])
        .map(
          (r, idx) =>
            `${idx + 1}. ${r.title || "Unknown"} (${r.cook_speed || "n/a"}, ~${r.total_time_min || "?"} min)`
        )
        .join("\n");

      const explanation = data.explanation || "No explanation returned.";
      const listAppend = !data.explanation && recipeList ? `\n\nTop picks:\n${recipeList}` : "";

      const botMessage = {
        role: "bot",
        content: explanation + listAppend,
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", content: "Error: " + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSurveyFlow = () => {
    const current = surveyQuestions[surveyStep];
    const labelLookup = Object.fromEntries(
      (current.options || []).map((o) => [o.value ?? o, o.label ?? String(o)])
    );
    const responseText = `Selected: ${selectedOptions.map((v) => labelLookup[v] || v).join(", ")}`;
    setMessages((prev) => [...prev, { role: "user", content: responseText }]);

    const nextResponses = (() => {
      const next = [...surveyResponses];
      next[surveyStep] = selectedOptions;
      return next;
    })();
    setSurveyResponses(nextResponses);

    const next = surveyStep + 1;
    setSurveyStep(next);
    setSelectedOptions([]);

    if (next < surveyQuestions.length) {
      setMessages((prev) => [...prev, { role: "bot", content: surveyQuestions[next].question }]);
    } else {
      const computed = computeBaselineConstraints(nextResponses);
      setBaselineConstraints(computed);
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: "Thanks! Your survey is complete. Generating starter ideas based on your preferences..." },
      ]);
      requestRecommendation("starter recommendations based on my survey", computed);
    }
  };

  const handleSkipSurvey = () => {
    // Bypass survey and allow freeform chat without baseline constraints.
    setSurveyStep(surveyQuestions.length);
    setSurveyResponses([]);
    setSelectedOptions([]);
    setBaselineConstraints(null);
    setMessages([{ role: "bot", content: "Survey skipped. Ask anything to get started." }]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (surveyStep < surveyQuestions.length) {
      if (selectedOptions.length === 0) return;
      handleSurveyFlow();
      return;
    }

    if (!text.trim()) return;

    const userMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    const outgoingText = text;
    setText("");
    setLoading(true);

    try {
      const detailMode = isRecipeDetailQuery(outgoingText);
      const endpoint = detailMode ? "http://localhost:8000/recipe_details" : "http://localhost:8000/submit";
      const payload = detailMode
        ? { recipe_query: outgoingText.replace(/^(how do i make|how to make|recipe for)/i, "").trim() || outgoingText }
        : { user_message: outgoingText, top_n: 5, baseline_constraints: baselineConstraints };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || response.statusText || "Unknown error";
        throw new Error(detail);
      }

      const data = await response.json();

      let botMessage;
      if (data.ingredients_list || data.directions_list) {
        const ingredients = (data.ingredients_list || []).map((it) => `- ${it}`).join("\n");
        const directions = (data.directions_list || []).map((it, i) => `${i + 1}. ${it}`).join("\n");
        botMessage = {
          role: "bot",
          content: `${data.title || "Recipe"}\n${data.description || ""}\n\nIngredients:\n${ingredients}\n\nDirections:\n${directions}`,
        };
      } else {
        const recipeList = (data.similar_recipes || [])
          .map(
            (r, idx) =>
              `${idx + 1}. ${r.title || "Unknown"} (${r.cook_speed || "n/a"}, ~${r.total_time_min || "?"} min)`
          )
          .join("\n");

        const explanation = data.explanation || "No explanation returned.";
        const listAppend = !data.explanation && recipeList ? `\n\nTop picks:\n${recipeList}` : "";

        botMessage = {
          role: "bot",
          content: explanation + listAppend,
        };
      }
      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: "Error: " + err.message },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const renderSurveyOptions = () => {
    if (surveyStep >= surveyQuestions.length) return null;

    const current = surveyQuestions[surveyStep];

    return (
      <div style={{ marginTop: 8, background: "#fff", padding: 12, borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ color: "#000" }}>Intro Survey</strong>
          <button
            type="button"
            onClick={handleSkipSurvey}
            disabled={loading}
            style={{
              background: "transparent",
              border: "none",
              color: "#007bff",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Skip survey
          </button>
        </div>
        {current.options.map((opt) => {
          const optVal = opt.value ?? opt;
          const optLabel = opt.label ?? String(opt);
          const isChecked = selectedOptions.includes(optVal);
          return (
          <label
            key={optVal}
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 10,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              value={optVal}
              checked={isChecked}
              onChange={(e) => {
                const { checked } = e.target;
                setSelectedOptions((prev) => {
                  if (checked) {
                    if (optVal === "__none__") return ["__none__"];
                    const withoutNone = prev.filter((v) => v !== "__none__");
                    return withoutNone.includes(optVal) ? withoutNone : [...withoutNone, optVal];
                  }
                  return prev.filter((v) => v !== optVal);
                });
              }}
              disabled={loading}
              style={{ display: "none" }}
            />

            <span
              style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: "2px solid black",
              marginRight: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isChecked ? "black" : "white",
              transition: "0.15s",
            }}
          />

            <span style={{ color: "#000" }}>{optLabel}</span>
          </label>
          );
        })}
      </div>
    );
  };

  if (!hasStarted) {
    return (
      <div className="landing">
        <div className="landing-card">
          <p className="landing-eyebrow">Smart Meal Planner</p>
          <h1 className="landing-title">Personalized dinner ideas, fast.</h1>
          <p className="landing-subtitle">
            Tell us what you are craving, and we will suggest personalized recipes to meet your needs!
          </p>
          <div className="landing-steps">
            <p className="landing-steps-title">How to use it</p>
            <ol>
              <li>Tap “Open the chat”</li>
              <li>Fill out a quick survey to save dietary prefrences, or skip it</li>
              <li>Ask how to make your favorite suggestion or prompt further!</li>
            </ol>
          </div>
          <button className="landing-button" type="button" onClick={() => setHasStarted(true)}>
            Open the chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f5f5f5" }}>
      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                padding: 10,
                borderRadius: 12,
                maxWidth: "70%",
                background: m.role === "user" ? "#007bff" : "#e5e5ea",
                color: m.role === "user" ? "#fff" : "#000",
                whiteSpace: "pre-wrap",
              }}
            >
              {formatContent(m.content)}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />

        {loading && surveyStep >= surveyQuestions.length && (
          <div style={{ padding: 10, color: "#555" }}>...</div>
        )}

        {surveyStep < surveyQuestions.length && renderSurveyOptions()}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          borderTop: "1px solid #ddd",
          padding: 8,
          background: "#fff",
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={surveyStep < surveyQuestions.length ? "Select from above" : "Type your message..."}
          disabled={surveyStep < surveyQuestions.length || loading}
          style={{
            flex: 1,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 8,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            marginLeft: 8,
            padding: "0 16px",
            background: "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: 8,
          }}
        >
          {loading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
