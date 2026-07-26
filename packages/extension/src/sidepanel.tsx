import { createRoot } from "react-dom/client";
import { App } from "./sidepanel/App.js";
import "./sidepanel/i18n/index.js";

createRoot(document.querySelector("#root")!).render(<App />);
