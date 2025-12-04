// Updated App.jsx with black custom checkboxes
import { useState, useRef, useEffect } from "react";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [surveyStep, setSurveyStep] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const messagesEndRef = useRef(null);

  const surveyQuestions = [
    {
      question: "Welcome! Let's start with an introduction survey. What types of cuisine do you enjoy?",
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
    return value.replace(/\*\*(.*?)\*\*/g, "$1");
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (surveyStep === 0 && messages.length === 0) {
      setMessages([{ role: "bot", content: surveyQuestions[0].question }]);
    }
  }, [surveyStep, messages.length]);

  const handleSurveyFlow = () => {
    const responseText = `Selected: ${selectedOptions.join(", ")}`;
    setMessages((prev) => [...prev, { role: "user", content: responseText }]);

    const next = surveyStep + 1;
    setSurveyStep(next);
    setSelectedOptions([]);

    if (next < surveyQuestions.length) {
      setMessages((prev) => [...prev, { role: "bot", content: surveyQuestions[next].question }]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: "Thanks! Your survey is complete. You can now ask for recipes or suggestions." },
      ]);
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

    const userResponse = text;
    setMessages((prev) => [...prev, { role: "user", content: userResponse }]);
    setText("");
    setLoading(true);

    try {
      const response = await fetch("http://localhost:8000/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_message: userResponse, top_n: 5 }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Unknown error");
      }

      const data = await response.json();
      const recipeList = (data.similar_recipes || [])
        .map(
          (r, idx) =>
            `${idx + 1}. ${r.title || "Unknown"} (${r.cook_speed || "n/a"}, ~${r.total_time_min || "?"} min)`
        )
        .join("\n");

      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          content:
            (data.explanation || "No explanation returned.") +
            (recipeList ? `\n\nTop picks:\n${recipeList}` : ""),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", content: "Error: " + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  // -------------------
  // RENDER CUSTOM CHECKBOXES (black)
  // -------------------
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
            {/* Hidden input */}
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

            {/* Custom black checkbox */}
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

  // -------------------
  // MAIN UI
  // -------------------
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
          placeholder={
            surveyStep < surveyQuestions.length ? "Select from above" : "Type your message..."
          }
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
