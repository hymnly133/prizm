import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    example: 'src/example.ts',
    'mcp/stdio-bridge': 'src/mcp/stdio-bridge.ts'
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // 保留 __dirname / import.meta.url 等 Node 运行时
  platform: 'node',
  // 不 external workspace 依赖，打包进输出
  // 注意：@prizm/evermemos 含 native 依赖（lancedb/better-sqlite3），不能打包，
  // 需在 dev/build 前先 yarn workspace @prizm/evermemos build
  noExternal: ['@prizm/shared']
})
