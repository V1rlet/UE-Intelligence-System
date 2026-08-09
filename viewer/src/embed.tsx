// Graph Brain / viewer - /embed 只读嵌入入口（P4U5）：AFFiNE iframe 等外部宿主用
import "../styles/palette.generated.css";
import "./design-tokens";
import { createRoot } from "react-dom/client";
import EmbedApp from "./EmbedApp";
import "../styles/motion.css";
import "../styles/app.css";

createRoot(document.getElementById("root")!).render(<EmbedApp />);
requestAnimationFrame(() => window.__graphBrainMarkReady?.());
