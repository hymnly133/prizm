/**
 * Prizm Electron 客户端 - React 入口
 */
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("app")!);
root.render(<App />);
