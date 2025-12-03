// src/App.jsx
import { useState, useRef, useEffect } from "react";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    const userMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setText("");
    setLoading(true);

    try {
      const detailMode = isRecipeDetailQuery(text);
      const endpoint = detailMode ? "http://localhost:8000/recipe_details" : "http://localhost:8000/submit";
      const payload = detailMode ? { recipe_query: text.replace(/^(how do i make|how to make|recipe for)/i, "").trim() || text } : { user_message: text, top_n: 5 };

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh", // Full-screen
        width: "100vw",  // Full width
        fontFamily: "system-ui, sans-serif",
        background: "#f5f5f5",
      }}
    >
      {/* Chat messages area */}
      <div
        style={{
          flex: 1,
          padding: 16,
          overflowY: "auto",
        }}
      >
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
      </div>

      {/* Input area */}
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
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 8,
            outline: "none",
            fontSize: 14,
          }}
          disabled={loading}
        />
        <button
          type="submit"
          style={{
            marginLeft: 8,
            padding: "0 16px",
            border: "none",
            borderRadius: 8,
            background: "#007bff",
            color: "#fff",
            cursor: "pointer",
          }}
          disabled={loading}
        >
          {loading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
