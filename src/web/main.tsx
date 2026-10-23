import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { watchScrollRegions } from "./a11y";
import { AppProvider } from "./store";

try { const t = localStorage.getItem("nw.theme"); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; } catch { /* ignore */ }
watchScrollRegions(document.getElementById("root")!);
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><AppProvider><App /></AppProvider></BrowserRouter></StrictMode>);

// Installable app + offline shell. Production only: the dev server's hot reload and a service worker fight each other.
if ("serviceWorker" in navigator && (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* app works without it */ }); });
}
