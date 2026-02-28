import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import "@/i18n";

// Initialize Capacitor plugins
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard } from "@capacitor/keyboard";
import { App as CapacitorApp } from "@capacitor/app";

// Configure status bar
StatusBar.setStyle({ style: Style.Dark }).catch(() => {
  // Ignore errors when running in browser
});
StatusBar.setBackgroundColor({ color: "#0f172a" }).catch(() => {});

// Handle keyboard events
Keyboard.addListener("keyboardWillShow", () => {
  document.body.classList.add("keyboard-visible");
});
Keyboard.addListener("keyboardWillHide", () => {
  document.body.classList.remove("keyboard-visible");
});

// Handle Android back button
CapacitorApp.addListener("backButton", ({ canGoBack }) => {
  if (canGoBack) {
    window.history.back();
  } else {
    CapacitorApp.exitApp();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
