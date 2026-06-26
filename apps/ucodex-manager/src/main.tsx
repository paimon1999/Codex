import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StatusOverlay } from "./StatusOverlay";
import "./styles.css";

const app = document.getElementById("app");

if (app instanceof HTMLElement) {
  if (window.location.hash === "#status-overlay") {
    createRoot(app).render(<StatusOverlay />);
  } else {
    createRoot(app).render(<App />);
  }
}
