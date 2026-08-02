import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RulesReferencePage } from "./RulesReferencePage";
import { rulesSystemFromPath } from "./rules";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/600.css";
import "@devils-toys/shared/theme.css";
import "./styles.css";
import "./media.css";
import "./tab-picker.css";
import "./table-media.css";
import "./audio.css";
import "./rules-links.css";
import "./dice.css";
import "./npcs.css";
import "./tables.css";

const rulesSystem = rulesSystemFromPath(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{rulesSystem ? <RulesReferencePage system={rulesSystem} /> : <App />}</StrictMode>
);
