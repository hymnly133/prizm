/**
 * Prizm Electron 客户端 - React 入口
 */
import { ConfigProvider, ThemeProvider } from "@lobehub/ui";
import { motion } from "motion/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("app")!);
root.render(
	<ConfigProvider motion={motion}>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</ConfigProvider>
);
