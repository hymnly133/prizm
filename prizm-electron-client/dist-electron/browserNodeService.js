"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserNodeService = exports.BrowserNodeService = void 0;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const main_1 = __importDefault(require("electron-log/main"));
const ws_1 = __importDefault(require("ws"));
const config_1 = require("./config");
class BrowserNodeService {
    browserProcess = null;
    internalBrowserView = null;
    currentMode = null;
    localWsUrl = null;
    relayClient = null;
    localCdpClient = null;
    debuggingPort = 9333;
    isShuttingDown = false;
    /** 本地 CDP 断开后暂存来自 relay 的消息，重连成功后发送；重连失败则丢弃 */
    pendingRelayToCdp = [];
    reconnectingCdp = null;
    /**
     * 启动本地浏览器节点，并连接到 Prizm Server 隧道
     */
    async startNode(mode = 'external') {
        if (this.currentMode) {
            return {
                success: false,
                message: `Browser node is already running in ${this.currentMode} mode`
            };
        }
        try {
            this.isShuttingDown = false;
            this.currentMode = mode;
            main_1.default.info(`[BrowserNode] Starting browser in ${mode} mode...`);
            if (mode === 'external') {
                await this.startExternalProcess();
            }
            else {
                await this.startInternalView();
            }
            // 等待 CDP 端口就绪并获取 webSocketDebuggerUrl
            this.localWsUrl = await this.waitForCdpEndpoint();
            main_1.default.info(`[BrowserNode] Local CDP active at: ${this.localWsUrl}`);
            // 连接到服务端隧道并建立 Relay
            await this.connectToServerTunnel();
            return { success: true, message: `Local browser (${mode}) and relay started successfully` };
        }
        catch (e) {
            main_1.default.error('[BrowserNode] Failed to start:', e);
            this.cleanup();
            return { success: false, message: e?.message || String(e) };
        }
    }
    async startExternalProcess() {
        // 1. 获取本地浏览器路径
        const browserPath = this.getBrowserExecutablePath();
        if (!browserPath) {
            throw new Error('Could not find a valid Chrome/Edge executable on this system.');
        }
        // 2. 创建独立的用户数据目录
        const userDataDir = path.join(electron_1.app.getPath('userData'), 'browser-node-profile');
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        // 3. 启动浏览器，开启 CDP 端口（使用 9333 避免与 Electron 自身的 9222 冲突）
        const args = [
            `--remote-debugging-port=${this.debuggingPort}`,
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-restore-session-state',
            '--disable-background-networking',
            '--remote-allow-origins=*',
            'about:blank'
        ];
        main_1.default.info(`[BrowserNode] Spawning: ${browserPath} (CDP port ${this.debuggingPort})`);
        this.browserProcess = (0, child_process_1.spawn)(browserPath, args);
        this.browserProcess.stderr?.on('data', (chunk) => {
            const msg = chunk.toString().trim();
            if (msg)
                main_1.default.info(`[BrowserNode] chrome stderr: ${msg.slice(0, 200)}`);
        });
        this.browserProcess.on('exit', (code) => {
            main_1.default.info(`[BrowserNode] External browser process exited with code ${code}`);
            if (!this.isShuttingDown) {
                this.cleanup();
            }
        });
    }
    async startInternalView() {
        // 创建完全隔离的 Session
        const agentSession = electron_1.session.fromPartition('persist:prizm-agent-sandbox');
        this.internalBrowserView = new electron_1.BrowserView({
            webPreferences: {
                session: agentSession,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });
        // 默认加载一个空白页，方便 Playwright 定位
        if (this.internalBrowserView) {
            await this.internalBrowserView.webContents.loadURL('about:blank');
            main_1.default.info('[BrowserNode] Internal BrowserView initialized and loaded about:blank');
        }
    }
    /**
     * 关闭浏览器节点和隧道
     */
    async stopNode() {
        this.isShuttingDown = true;
        this.cleanup();
    }
    /**
     * 获取节点状态
     */
    getStatus() {
        return {
            isRunning: this.currentMode !== null,
            mode: this.currentMode,
            wsEndpoint: this.localWsUrl
        };
    }
    cleanup() {
        if (this.relayClient) {
            this.relayClient.close();
            this.relayClient = null;
        }
        if (this.localCdpClient) {
            this.localCdpClient.close();
            this.localCdpClient = null;
        }
        this.pendingRelayToCdp = [];
        this.reconnectingCdp = null;
        if (this.browserProcess) {
            try {
                // Ensure browserProcess and its pid exist before trying to kill by pid
                if (process.platform === 'win32' && this.browserProcess.pid) {
                    // Windows 上温柔地关不掉可能需要强制
                    (0, child_process_1.spawn)('taskkill', ['/pid', this.browserProcess.pid.toString(), '/f', '/t']);
                }
                else {
                    this.browserProcess.kill('SIGKILL');
                }
            }
            catch (e) {
                main_1.default.error('[BrowserNode] Error killing external browser process:', e);
            }
            this.browserProcess = null;
        }
        if (this.internalBrowserView) {
            try {
                // 如果被 attach 到了某个窗口上，Electron 并没有统一的销毁机制除了从父级移出
                ;
                this.internalBrowserView.webContents.destroy();
            }
            catch (e) {
                main_1.default.error('[BrowserNode] Error destroying internal browser view:', e);
            }
            this.internalBrowserView = null;
        }
        this.currentMode = null;
        this.localWsUrl = null;
    }
    /**
     * 轮询获取外部浏览器 CDP 的 webSocketDebuggerUrl。
     * 使用 /json/version 获取 browser-level CDP URL（Stagehand 需要 browser target 来管理 context/page）。
     */
    async waitForCdpEndpoint(maxRetries = 30, intervalMs = 500) {
        main_1.default.info(`[BrowserNode] Waiting for CDP on port ${this.debuggingPort} (up to ${maxRetries * intervalMs}ms)...`);
        for (let i = 0; i < maxRetries; i++) {
            if (this.isShuttingDown)
                throw new Error('Startup cancelled');
            try {
                const res = await fetch(`http://127.0.0.1:${this.debuggingPort}/json/version`);
                if (res.ok) {
                    const data = (await res.json());
                    if (data.webSocketDebuggerUrl) {
                        main_1.default.info(`[BrowserNode] CDP ready: browser=${data.Browser ?? 'unknown'} url=${data.webSocketDebuggerUrl}`);
                        return data.webSocketDebuggerUrl;
                    }
                }
            }
            catch {
                // port not ready yet
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        throw new Error(`Timeout waiting for CDP endpoint on port ${this.debuggingPort}. Ensure no other process uses this port.`);
    }
    /**
     * 连接本地 CDP 并挂载双向透传与关闭处理（关闭时不断开 relay，仅清空 localCdpClient，由 ensureLocalCdpThenFlush 重连）
     */
    connectLocalCdp(onOpen) {
        if (!this.localWsUrl)
            return;
        this.localCdpClient = new ws_1.default(this.localWsUrl);
        this.localCdpClient.on('open', () => {
            main_1.default.info('[BrowserNode] Connected to Local CDP');
            onOpen?.();
            this.flushPendingToCdp();
        });
        this.localCdpClient.on('message', (data, isBinary) => {
            if (this.relayClient?.readyState === ws_1.default.OPEN) {
                this.relayClient.send(data, { binary: isBinary });
            }
        });
        this.localCdpClient.on('error', (err) => {
            main_1.default.error('[BrowserNode] Local CDP Ws Error:', err);
        });
        this.localCdpClient.on('close', (code, reason) => {
            main_1.default.info(`[BrowserNode] Local CDP closed code=${code} reason=${reason?.toString() || 'none'} (relay kept)`);
            this.localCdpClient = null;
        });
    }
    /**
     * 确保本地 CDP 已连接（若已断开则尝试重连），然后把 pendingRelayToCdp 刷到浏览器
     */
    ensureLocalCdpThenFlush() {
        if (this.localCdpClient?.readyState === ws_1.default.OPEN) {
            while (this.pendingRelayToCdp.length > 0) {
                const msg = this.pendingRelayToCdp.shift();
                this.localCdpClient.send(msg.data, { binary: msg.isBinary });
            }
            return;
        }
        if (this.reconnectingCdp !== null) {
            this.reconnectingCdp.then((ok) => {
                if (ok)
                    this.flushPendingToCdp();
            });
            return;
        }
        if (this.localCdpClient !== null)
            return; // 正在连接或即将关闭，不重复重连
        this.reconnectingCdp = this.tryReconnectLocalCdp();
        this.reconnectingCdp.then((ok) => {
            this.reconnectingCdp = null;
            if (ok) {
                this.flushPendingToCdp();
            }
            else {
                main_1.default.warn('[BrowserNode] Reconnect to local CDP failed (browser may have exited). Tunnel kept; stop and start node to attach a new browser.');
                this.pendingRelayToCdp = [];
            }
        });
    }
    flushPendingToCdp() {
        if (!this.localCdpClient || this.localCdpClient.readyState !== ws_1.default.OPEN)
            return;
        while (this.pendingRelayToCdp.length > 0) {
            const msg = this.pendingRelayToCdp.shift();
            this.localCdpClient.send(msg.data, { binary: msg.isBinary });
        }
    }
    tryReconnectLocalCdp() {
        const url = this.localWsUrl;
        if (!url)
            return Promise.resolve(false);
        return new Promise((resolve) => {
            const ws = new ws_1.default(url);
            const timeout = setTimeout(() => {
                ws.removeAllListeners();
                ws.close();
                resolve(false);
            }, 5000);
            ws.on('open', () => {
                clearTimeout(timeout);
                this.localCdpClient = ws;
                this.attachLocalCdpHandlers();
                resolve(true);
            });
            ws.on('error', () => {
                clearTimeout(timeout);
                resolve(false);
            });
            ws.on('close', () => {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }
    attachLocalCdpHandlers() {
        const ws = this.localCdpClient;
        if (!ws)
            return;
        ws.on('message', (data, isBinary) => {
            if (this.relayClient?.readyState === ws_1.default.OPEN) {
                this.relayClient.send(data, { binary: isBinary });
            }
        });
        ws.on('error', (err) => {
            main_1.default.error('[BrowserNode] Local CDP Ws Error:', err);
        });
        ws.on('close', (code, reason) => {
            main_1.default.info(`[BrowserNode] Local CDP closed code=${code} reason=${reason?.toString() || 'none'} (relay kept)`);
            this.localCdpClient = null;
        });
    }
    /**
     * 建立到 Prizm Server 的 Relay 隧道
     */
    async connectToServerTunnel() {
        const config = await (0, config_1.loadConfigFromDisk)();
        const serverHost = config.server.host || '127.0.0.1';
        const serverPort = config.server.port || '4127';
        // 鉴权：relay 服务端用 apiKey 校验，provider 的 clientId 由服务端归一化为 API Key 所属 clientId，与 chat 一致；URL 中 clientId 仅作日志/兼容
        const clientId = config.client?.name || 'prizm-electron-client';
        const tunnelUrl = `ws://${serverHost}:${serverPort}/api/v1/browser/relay?clientId=${encodeURIComponent(clientId)}&role=provider&apiKey=${encodeURIComponent(config.api_key ?? '')}`;
        return new Promise((resolve, reject) => {
            this.relayClient = new ws_1.default(tunnelUrl);
            this.relayClient.on('open', () => {
                main_1.default.info('[BrowserNode] Connected to Prizm Server Tunnel');
                // 隧道建立后，连接本地 CDP
                this.connectLocalCdp(resolve);
            });
            this.relayClient.on('message', (data, isBinary) => {
                if (this.localCdpClient?.readyState === ws_1.default.OPEN) {
                    this.localCdpClient.send(data, { binary: isBinary });
                    return;
                }
                this.pendingRelayToCdp.push({ data, isBinary });
                this.ensureLocalCdpThenFlush();
            });
            this.relayClient.on('error', (err) => {
                main_1.default.error('[BrowserNode] Tunnel Ws Error:', err);
                reject(err);
            });
            this.relayClient.on('close', (code, reason) => {
                main_1.default.info(`[BrowserNode] Relay tunnel closed code=${code} reason=${reason?.toString() || 'none'}`);
                this.cleanup();
            });
        });
    }
    /**
     * 获取系统上已有的 Chrome/Edge 路径
     */
    getBrowserExecutablePath() {
        const isWindows = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        const isLinux = process.platform === 'linux';
        let paths = [];
        if (isWindows) {
            paths = [
                process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
                process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe',
                process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe'
            ];
        }
        else if (isMac) {
            paths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            ];
        }
        else if (isLinux) {
            paths = [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/microsoft-edge-stable'
            ];
        }
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < paths.length; i++) {
            if (fs.existsSync(paths[i])) {
                return paths[i];
            }
        }
        return null;
    }
}
exports.BrowserNodeService = BrowserNodeService;
exports.browserNodeService = new BrowserNodeService();
//# sourceMappingURL=browserNodeService.js.map