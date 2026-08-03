import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RulesReferencePage } from "./RulesReferencePage";
import { rulesSystemFromPath } from "./rules";
import { isRoomConfigPath } from "./room-config";
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
// Room Config is a GM tool most of this application's users never open, so it is
// split out and only fetched at its own address rather than shipped to everyone.
const RoomConfigPage = lazy(() => import("./RoomConfigPage").then((module) => ({ default: module.RoomConfigPage })));

function Entry() {
  if (isRoomConfigPath(window.location.pathname))
    return (
      <Suspense fallback={null}>
        <RoomConfigPage />
      </Suspense>
    );
  if (rulesSystem) return <RulesReferencePage system={rulesSystem} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Entry />
  </StrictMode>
);
