#!/usr/bin/env node

/**
 * Prizm Server CLI
 *
 * Usage:
 *   node cli.js [port] [--host <host>] [--port <port>]
 *
 * Env:
 *   PRIZM_PORT, PRIZM_HOST, PRIZM_DATA_DIR, PRIZM_AUTH_DISABLED
 *
 * Example:
 *   node cli.js
 *   node cli.js 5000
 *   node cli.js --host 0.0.0.0
 *   PRIZM_AUTH_DISABLED=1 yarn start
 */

import { createPrizmServer, createDefaultAdapters } from "./index";
import { getConfig } from "./config";

const args = process.argv.slice(2);
const cfg = getConfig();
let port = cfg.port;
let host = cfg.host;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--host" || args[i] === "-H") {
		host = args[++i] || cfg.host;
	} else if (args[i] === "--port" || args[i] === "-p") {
		port = parseInt(args[++i]) || cfg.port;
	} else if (/^\d+$/.test(args[i])) {
		port = parseInt(args[i]);
	}
}

async function main(): Promise<void> {
	console.log("🎯 Prizm Server CLI\n");

	const adapters = createDefaultAdapters();
	const server = createPrizmServer(adapters, {
		port,
		host,
		authEnabled: cfg.authEnabled,
	});

	try {
		await server.start();
		const addr = server.getAddress();
		console.log(`✅ Server running at ${addr}`);
		console.log(`   Dashboard: ${addr}/dashboard/\n`);
	} catch (error) {
		console.error(
			"❌ Failed to start:",
			error instanceof Error ? error.message : String(error)
		);
		process.exit(1);
	}

	const shutdown = async (): Promise<void> => {
		console.log("\n\n👋 Shutting down...");
		await server.stop();
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
	console.error("💥 Fatal error:", error);
	process.exit(1);
});
