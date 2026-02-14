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
  noExternal: ['@prizm/shared']
})
