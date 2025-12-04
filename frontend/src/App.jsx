// src/App.jsx
import { useEffect, useRef, useState } from "react";

export default function App() {
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
      question: "Welcome! Let's start with an introduction survey to understand you dietary preferences.\nWhat types of cuisine do you enjoy?",
      options: ["Italian", "Mexican", "Chinese", "Indian", "Mediterranean", "American", "Other"],
    },
    {
      question: "Do you have any dietary restrictions?",
      options: ["Vegan", "Vegetarian", "Gluten-free", "Nut allergy", "Dairy-free", "None"],
    },
    {
      question: "What prep/cook style do you prefer?",
      options: ["Quick meals", "Slow cooking", "Minimal dishes", "Meal prep", "No preference"],
    },
    {
      question: "What time of day is this meal for?",
      options: ["Breakfast", "Lunch", "Dinner", "Snack"],
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Kick off survey prompt
  useEffect(() => {
    if (surveyStep === 0 && messages.length === 0) {
      setMessages([{ role: "bot", content: surveyQuestions[0].question }]);
    }
  }, [surveyStep, messages.length]);

  const computeBaselineConstraints = (responses) => {
    const constraints = {};

    // Q1 cuisines
    const cuisines = responses[0] || [];
    if (cuisines.length) {
      constraints.cuisines_include = cuisines.map((c) => c.toLowerCase());
    }

    // Q2 dietary
    const diet = responses[1] || [];
    if (diet.includes("Vegan")) constraints.is_vegan = true;
    if (diet.includes("Vegetarian")) constraints.is_vegetarian = true;
    if (diet.includes("Gluten-free")) constraints.is_gluten_free = true;
    if (diet.includes("Nut allergy")) constraints.is_nut_free = true;
    if (diet.includes("Dairy-free")) constraints.is_dairy_free = true;

    // Q3 prep style -> cook_speed/time
    const prep = responses[2] || [];
    const wantsQuick = prep.includes("Quick meals");
    const wantsSlow = prep.includes("Slow cooking");

    // Only set cook_speed if they gave a clear single intent; avoid over-constraining.
    if (wantsQuick && !wantsSlow) {
      constraints.cook_speed = "fast";
    } else if (wantsSlow && !wantsQuick) {
      constraints.cook_speed = "slow";
    }

    // Q4 time-of-day -> course hint
    const times = responses[3] || [];
    const courseMap = [];
    if (times.includes("Breakfast")) courseMap.push("breakfast");
    if (times.includes("Lunch")) courseMap.push("lunch");
    if (times.includes("Dinner")) courseMap.push("dinner");
    if (times.includes("Snack")) courseMap.push("snack");
    if (courseMap.length) constraints.course_list = courseMap;

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

      const botMessage = {
        role: "bot",
        content:
          (data.explanation || "No explanation returned.") + (recipeList ? `\n\nTop picks:\n${recipeList}` : ""),
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", content: "Error: " + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSurveyFlow = () => {
    const responseText = `Selected: ${selectedOptions.join(", ")}`;
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

        botMessage = {
          role: "bot",
          content:
            (data.explanation || "No explanation returned.") +
            (recipeList ? `\n\nTop picks:\n${recipeList}` : ""),
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
        {current.options.map((opt) => (
          <label
            key={opt}
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
              value={opt}
              checked={selectedOptions.includes(opt)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedOptions([...selectedOptions, opt]);
                } else {
                  setSelectedOptions(selectedOptions.filter((o) => o !== opt));
                }
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
                background: selectedOptions.includes(opt) ? "black" : "white",
                transition: "0.15s",
              }}
            />

            <span style={{ color: "#000" }}>{opt}</span>
          </label>
        ))}
      </div>
    );
  };

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
