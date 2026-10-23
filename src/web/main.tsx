import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { AppProvider } from "./store";

try { const t = localStorage.getItem("nw.theme"); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; } catch { /* ignore */ }
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><AppProvider><App /></AppProvider></BrowserRouter></StrictMode>);
