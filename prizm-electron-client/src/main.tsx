/**
 * Prizm Electron 客户端 - React 入口
 */
import { ConfigProvider, ThemeProvider } from "@lobehub/ui";
import { App as AntdApp, ConfigProvider as AntdConfigProvider } from "antd";
import { motion } from "motion/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("app")!);
root.render(
	<div className="app-root">
		<ConfigProvider motion={motion}>
			<ThemeProvider themeMode="auto">
				<AntdConfigProvider theme={{ cssVar: {} }}>
					<AntdApp>
						<App />
					</AntdApp>
				</AntdConfigProvider>
			</ThemeProvider>
		</ConfigProvider>
	</div>
);
