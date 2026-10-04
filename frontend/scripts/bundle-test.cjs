/**
 * 危险品申报模块逻辑自测：用 esbuild 把 TS 用例打成单文件后在 Node 跑，
 * 不依赖浏览器；localStorage 在 selftest-bootstrap.ts 里打了内存桩。
 *   npm run selftest
 */
const { execFileSync } = require('node:child_process')
const esbuild = require('esbuild')
const path = require('node:path')

const outfile = path.join(__dirname, '.selftest.mjs')

async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'selftest-bootstrap.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  })
  execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      require('node:fs').rmSync(outfile, { force: true })
    } catch {
      /* ignore */
    }
  })
