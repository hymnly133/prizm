import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
	plugins: [vue()],
	clearScreen: false,
	server: {
		port: 5183,
		fs: {
			allow: [".."],
		},
	},
	resolve: {
		alias: {
			"@prizm/client-core": resolve(__dirname, "../prizm-client-core/src"),
		},
	},
	build: {
		target: "esnext",
		outDir: "dist",
		rollupOptions: {
			input: {
				main: resolve(__dirname, "index.html"),
				notification: resolve(__dirname, "notification.html"),
			},
		},
	},
});
