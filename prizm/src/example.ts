/**
 * Prizm Server 独立运行示例
 *
 * 运行方式：
 * cd prizm
 * node dist/example.js
 */

import { createPrizmServer, createDefaultAdapters, getConfig } from "./index";

async function main(): Promise<void> {
	console.log("🚀 Starting Prizm Server example...\n");

	const adapters = createDefaultAdapters();
	const cfg = getConfig();

	const server = createPrizmServer(adapters, {
		port: cfg.port,
		host: cfg.host,
	});

	try {
		await server.start();
		const base = `http://${cfg.host}:${cfg.port}`;
		console.log(`✅ Prizm Server is running at ${server.getAddress()}`);
		console.log("\n📖 Try these commands:\n");
		console.log(`  curl ${base}/health`);
		console.log(
			`  curl -X POST ${base}/notes -H "Content-Type: application/json" -d '{"content":"test"}'`
		);
		console.log(`  curl ${base}/notes`);
		console.log(
			`  curl -X POST ${base}/notify -H "Content-Type: application/json" -d '{"title":"hi","body":"world"}'`
		);
		console.log("\n  Press Ctrl+C to stop\n");
	} catch (error) {
		console.error("❌ Failed to start server:", error);
		process.exit(1);
	}

	const stop = async (): Promise<void> => {
		console.log("\n\n🛑 Stopping server...");
		await server.stop();
		console.log("✅ Server stopped");
		process.exit(0);
	};

	process.on("SIGINT", () => void stop());
	process.on("SIGTERM", () => void stop());
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
