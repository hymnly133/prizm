"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// 1. Mocks via hoisted so they can be referenced inside vi.mock factory
const mocks = vitest_1.vi.hoisted(() => {
    return {
        mockBrowserView: class {
            webContents = {
                loadURL: vitest_1.vi.fn(),
                session: {
                    setProxy: vitest_1.vi.fn()
                },
                close: vitest_1.vi.fn(),
                isDestroyed: vitest_1.vi.fn().mockReturnValue(false)
            };
        },
        mockSessionFromPartition: vitest_1.vi.fn().mockReturnValue({
            setProxy: vitest_1.vi.fn()
        }),
        mockSpawnOn: vitest_1.vi.fn(),
        mockSpawnKill: vitest_1.vi.fn(),
        mockWsOn: vitest_1.vi.fn(),
        mockWsSend: vitest_1.vi.fn(),
        mockWsClose: vitest_1.vi.fn()
    };
});
// 1. Mock Electron
vitest_1.vi.mock('electron', () => {
    const electronMock = {
        app: {
            getAppPath: vitest_1.vi.fn().mockReturnValue('/mock/app/path'),
            getPath: vitest_1.vi.fn().mockReturnValue('/mock/user/data')
        },
        BrowserView: mocks.mockBrowserView,
        session: {
            fromPartition: mocks.mockSessionFromPartition
        }
    };
    return {
        ...electronMock,
        default: electronMock
    };
});
// 2. Mock 'fs' and 'path'
vitest_1.vi.mock('fs', () => ({
    existsSync: vitest_1.vi.fn().mockReturnValue(true) // assume chromium / chrome exists
}));
// 3. Mock windowManager to avoid referencing actual window
vitest_1.vi.mock('../windowManager', () => ({
    windowManager: {
        getMainWindow: vitest_1.vi.fn().mockReturnValue({
            setBrowserView: vitest_1.vi.fn(),
            removeBrowserView: vitest_1.vi.fn(),
            getBounds: vitest_1.vi.fn().mockReturnValue({ width: 800, height: 600 })
        })
    }
}));
// 4. Mock process spawn
vitest_1.vi.mock('child_process', () => ({
    spawn: vitest_1.vi.fn().mockImplementation(() => {
        return {
            on: mocks.mockSpawnOn,
            kill: mocks.mockSpawnKill,
            stdout: { on: vitest_1.vi.fn(), pipe: vitest_1.vi.fn() },
            stderr: { on: vitest_1.vi.fn(), pipe: vitest_1.vi.fn() }
        };
    })
}));
// 5. Mock Config and Log
vitest_1.vi.mock('../config', () => ({
    loadConfigFromDisk: vitest_1.vi.fn().mockReturnValue({
        client: { name: 'test-client' },
        server: { host: '127.0.0.1', port: 4127 }
    })
}));
vitest_1.vi.mock('electron-log/main', () => ({
    default: {
        info: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn()
    }
}));
// 6. Mock WebSocket
vitest_1.vi.mock('ws', () => {
    return {
        default: vitest_1.vi.fn().mockImplementation(() => {
            return {
                on: mocks.mockWsOn,
                send: mocks.mockWsSend,
                close: mocks.mockWsClose,
                readyState: 1 // OPEN
            };
        })
    };
});
// Import Service after mocks
const browserNodeService_1 = require("../browserNodeService");
(0, vitest_1.describe)('BrowserNodeService', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        // We mock the polling for endpoint to just immediately resolve
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'waitForCdpEndpoint').mockResolvedValue('ws://localhost:9222/devtools/browser/mock');
        // We mock the websocket relay tunnel connect so it doesn't actually connect
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'connectToServerTunnel').mockResolvedValue(undefined);
        // We mock getBrowserExecutablePath to prevent failure on missing Chrome path
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'getBrowserExecutablePath').mockReturnValue('/mock/chrome.exe');
    });
    (0, vitest_1.afterEach)(async () => {
        await browserNodeService_1.browserNodeService.stopNode();
    });
    (0, vitest_1.it)('should get initial status as stopped', () => {
        const status = browserNodeService_1.browserNodeService.getStatus();
        (0, vitest_1.expect)(status.isRunning).toBe(false);
        (0, vitest_1.expect)(status.mode).toBeNull();
    });
    (0, vitest_1.it)('should start External process node successfully', async () => {
        const result = await browserNodeService_1.browserNodeService.startNode('external');
        if (!result.success)
            console.error('[Test External] Msg:', result.message);
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(true);
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().mode).toBe('external');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.waitForCdpEndpoint).toHaveBeenCalled();
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.connectToServerTunnel).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should start Internal view node successfully', async () => {
        const result = await browserNodeService_1.browserNodeService.startNode('internal');
        if (!result.success)
            console.error('[Test Internal] Msg:', result.message);
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(true);
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().mode).toBe('internal');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.waitForCdpEndpoint).toHaveBeenCalled();
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.connectToServerTunnel).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should stop active node and clear resources', async () => {
        await browserNodeService_1.browserNodeService.startNode('external');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(true);
        await browserNodeService_1.browserNodeService.stopNode();
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(false);
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().mode).toBeNull();
        (0, vitest_1.expect)(mocks.mockSpawnKill).toHaveBeenCalled();
    });
    (0, vitest_1.it)('should fail start when getBrowserExecutablePath returns null (external mode)', async () => {
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'getBrowserExecutablePath').mockReturnValueOnce(null);
        const result = await browserNodeService_1.browserNodeService.startNode('external');
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.message).toContain('Chrome');
        (0, vitest_1.expect)(result.message).toContain('Edge');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(false);
    });
    (0, vitest_1.it)('should fail when waitForCdpEndpoint times out', async () => {
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'waitForCdpEndpoint').mockRejectedValue(new Error('Timeout waiting for local browser CDP endpoint'));
        const result = await browserNodeService_1.browserNodeService.startNode('external');
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.message).toContain('Timeout');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(false);
    });
    (0, vitest_1.it)('should fail when connectToServerTunnel rejects', async () => {
        vitest_1.vi.spyOn(browserNodeService_1.browserNodeService, 'connectToServerTunnel').mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await browserNodeService_1.browserNodeService.startNode('external');
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.message).toContain('ECONNREFUSED');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(false);
    });
    (0, vitest_1.it)('should return already running when startNode is called twice', async () => {
        await browserNodeService_1.browserNodeService.startNode('external');
        const second = await browserNodeService_1.browserNodeService.startNode('external');
        (0, vitest_1.expect)(second.success).toBe(false);
        (0, vitest_1.expect)(second.message).toContain('already running');
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().mode).toBe('external');
    });
    (0, vitest_1.it)('should return status with wsEndpoint when running', async () => {
        await browserNodeService_1.browserNodeService.startNode('external');
        const status = browserNodeService_1.browserNodeService.getStatus();
        (0, vitest_1.expect)(status.isRunning).toBe(true);
        (0, vitest_1.expect)(status.mode).toBe('external');
        (0, vitest_1.expect)(status.wsEndpoint).toBe('ws://localhost:9222/devtools/browser/mock');
    });
    (0, vitest_1.it)('should be idempotent to call stopNode when not running', async () => {
        await (0, vitest_1.expect)(browserNodeService_1.browserNodeService.stopNode()).resolves.not.toThrow();
        (0, vitest_1.expect)(browserNodeService_1.browserNodeService.getStatus().isRunning).toBe(false);
    });
});
//# sourceMappingURL=browserNodeService.test.js.map