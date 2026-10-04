#!/usr/bin/env bash
# 危险品申报单业务规则测试：本机 esbuild 是 macOS 二进制跑不起来，
# 所以用 tsc 把纯 TS 业务层编译到临时目录后用 node 执行。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/api" "$OUT/data"
cp src/data/types.ts src/data/modules.ts src/data/seed.ts src/data/local-store.ts src/data/dgoods-rules.ts "$OUT/data/"
cp src/api/local-service.ts src/api/dgoods-service.ts "$OUT/api/"
sed -i "s#@/data/#../data/#g" "$OUT"/api/*.ts
sed "s#@/api/#./api/#g; s#@/data/#./data/#g" test-dgoods.mts > "$OUT/test.ts"
(cd "$OUT" && "$OLDPWD/node_modules/.bin/tsc" --module nodenext --moduleResolution nodenext --target es2020 --strict --skipLibCheck --noEmitOnError false --outDir out $(find . -name '*.ts' -not -path './out/*') || true)
node "$OUT/out/test.js"
