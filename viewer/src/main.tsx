// Graph Brain / viewer - React 入口
import "../styles/palette.generated.css";
import "./design-tokens";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppRuntimeBoundary } from "../components/common/AsyncSurface";
import "../styles/motion.css";
import "../styles/app.css";
import "../styles/engine-spec-browser.css";
import "../styles/comfort.css";
import "../styles/readability.css";
import "../styles/workspace-refactor.css";
import "../styles/async-surface.css";
import "../styles/hierarchy-select.css";
import "../styles/changes.css";

createRoot(document.getElementById("root")!).render(<AppRuntimeBoundary><App /></AppRuntimeBoundary>);
requestAnimationFrame(() => window.__graphBrainMarkReady?.());
