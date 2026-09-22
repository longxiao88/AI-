import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MotionProvider } from "./components/Motion";
import { ConfirmProvider } from "./components/ui";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </MotionProvider>
  </React.StrictMode>,
);
