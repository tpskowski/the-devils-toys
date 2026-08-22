import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RulesReferencePage } from "./RulesReferencePage";
import { rulesSystemFromPath } from "./rules";
import { isRoomConfigPath } from "./room-config";
import { isHelpPath } from "./help";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/600.css";
// The landing page's epigraph, and nothing else. Variable on the weight axis,
// because a quote is set anywhere from 72px to 17px depending on its length and
// a grotesque that is right at the top of that range is heavy at the bottom.
import "@fontsource-variable/bricolage-grotesque";
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
import "./room-tags.css";

const rulesSystem = rulesSystemFromPath(window.location.pathname);
// Room Config is a GM tool most of this application's users never open, so it is
// split out and only fetched at its own address rather than shipped to everyone.
const RoomConfigPage = lazy(() => import("./RoomConfigPage").then((module) => ({ default: module.RoomConfigPage })));
// The guides are read now and then rather than played with, so they are split
// out too and only fetched at their own address.
const HelpPage = lazy(() => import("./HelpPage").then((module) => ({ default: module.HelpPage })));

function Entry() {
  if (isHelpPath(window.location.pathname))
    return (
      <Suspense fallback={null}>
        <HelpPage />
      </Suspense>
    );
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
