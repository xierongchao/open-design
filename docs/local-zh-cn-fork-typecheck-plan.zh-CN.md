# 本地中文 fork 的 TypeScript 恢复方案

这份文档给后续执行的 Claude Code 使用。目标不是把 Open Design 的
国际化体系改成“只剩中文”，而是在只使用中文环境的前提下，让本地 fork
恢复可验证、可更新官方代码、可重复修复的状态。

## 目标

- `pnpm --filter @open-design/web typecheck` 通过。
- 保留官方仓库的 i18n 约束：不要删除 locale，不要把 `Dict` 改成全可选，
  不要在 `zh-CN.ts` 重新引入 `...en`。
- 中文运行体验优先；英文只需要保持类型和 fallback 可用。
- 后续从官方同步代码后，可以重新运行同一套步骤，缩小或删除本地 backfill。

## 当前基线

在 2026-06-09 的本地工作区中，`pnpm --filter @open-design/web typecheck`
暴露了这些阻塞：

- `apps/web/src/i18n/types.ts` 的 `Dict` 有 3057 个 key。
- `apps/web/src/i18n/locales/en.ts` 显式有 2615 个 key，缺 442 个。
- `apps/web/src/i18n/locales/zh-CN.ts` 显式有 2615 个 key，缺 442 个。
- `apps/web/tests/components/EditableCodeViewer.test.tsx:125` 把
  `number | null` 传给了 `toBeGreaterThan`。
- `apps/web/tests/i18n/locales.test.ts` 还包含日文 `ja` 的 tier-1 parity
  断言，但当前 `ja.ts` 仍有 `...en`。这是测试层的额外既有问题，不属于
  “让 web tsc 恢复”的最小范围。
- 如果 web 仍报
  `@open-design/contracts` 缺 `RenameProjectFolderResponse`，通常是
  `packages/contracts/dist` 本地声明文件没刷新，而不是源码没有 export。
- 如果 web 仍报 `DesignFilesPanel.tsx` 找不到 `folderCount`，先强制重跑
  TypeScript builder；当前源码里相关展示已经使用 `tableFiles.length`。

## 决策

采用“严格 i18n 补齐”方案：

- 以 `Dict` 作为 key 的事实来源。
- 补齐 `en.ts` 和 `zh-CN.ts` 缺失 key。
- 其他大多数 locale 仍通过 `...en` fallback 获得完整 shape，不在这次维护。
- `zh-CN.ts` 继续保持显式声明所有 key，因为
  `apps/web/tests/i18n/locales.test.ts` 明确锁住了 tier-1 中文 parity。
- 不把 `ja` parity 一并拉进本次任务；如果后续要让
  `apps/web/tests/i18n/locales.test.ts` 整体通过，需要另开一轮日文补齐或调整测试。

不要采用这些快捷方式：

- 不要把 `Dict` 的所有字段改成可选。
- 不要把 `DICTS` 改成 `Record<Locale, Partial<Dict>>` 来绕过错误。
- 不要在 `zh-CN.ts` 顶部加入 `import { en }` 和 `...en`。
- 不要用 `@ts-ignore`、`as any` 或跳过 `tests/**/*` 的方式让 tsc 变绿。

这些方式短期能少打字，但会和官方 i18n 测试、后续 rebase、运行时 fallback
语义持续打架。

## 执行步骤

### 1. 建立干净反馈环

先不要改源码，确认当前错误：

```bash
git status --short
pnpm --filter @open-design/contracts build
pnpm --filter @open-design/web exec tsc -b --noEmit --force
```

`contracts build` 很重要：`@open-design/contracts` 的包入口指向
`packages/contracts/dist/*.d.ts`，而 `dist/` 是本地生成产物，不进 git。
如果只改了 `packages/contracts/src` 却没 build，web typecheck 会继续读旧声明。

### 2. 生成缺失 key 报告

使用 TypeScript AST，不要用简单正则数 key。把报告写进 `.tmp/`：

```bash
mkdir -p .tmp
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();

function sourceFile(relativePath) {
  const filePath = path.join(root, relativePath);
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
}

function dictKeys() {
  const sf = sourceFile('apps/web/src/i18n/types.ts');
  const keys = [];
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Dict') {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = member.name;
        if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) keys.push(name.text);
        else if (ts.isIdentifier(name)) keys.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

function localeKeys(locale) {
  const sf = sourceFile(`apps/web/src/i18n/locales/${locale}.ts`);
  const keys = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = prop.name;
        if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) keys.push(name.text);
        else if (ts.isIdentifier(name)) keys.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

const canonical = dictKeys();
const report = {};
for (const locale of ['en', 'zh-CN']) {
  const present = new Set(localeKeys(locale));
  report[locale] = canonical.filter((key) => !present.has(key));
}

fs.writeFileSync('.tmp/i18n-missing-report.json', JSON.stringify(report, null, 2));
console.log(`Dict keys: ${canonical.length}`);
console.log(`en missing: ${report.en.length}`);
console.log(`zh-CN missing: ${report['zh-CN'].length}`);
NODE
```

预期当前输出是：

```text
Dict keys: 3057
en missing: 442
zh-CN missing: 442
```

### 3. 补齐 en 和 zh-CN

建议让 Claude Code 分批处理 `.tmp/i18n-missing-report.json`，每批 40 到 80 个 key。

补齐规则：

- `en.ts` 写自然英文，不要写 key 名本身。
- `zh-CN.ts` 写简体中文，保留产品名和技术名，例如 `Open Design`、`AMR`、
  `Claude Code`、`GitHub`、`MCP`、`API Key`。
- 占位符必须逐字一致：英文有 `{n}`、`{name}`、`{path}`，中文也必须有同名占位符。
- 语气保持 UI 文案短句，不要解释功能。
- 如果缺失 key 在 `apps/web/src/i18n/locales/fr.ts` 已有值，可以把它当作
  “这个 key 确实属于当前产品”的参照，但不要从法语机械翻译；优先根据 key 名、
  调用位置和邻近 i18n key 写英文/中文。

为了减少后续 rebase 冲突，把补齐内容放到每个 locale 文件末尾、最终 `};`
之前的生成块中：

```ts
  // Local fork backfill: generated from Dict while upstream locale files catch up.
  // BEGIN LOCAL I18N KEY BACKFILL
  'common.clear': 'Clear',
  // ...
  // END LOCAL I18N KEY BACKFILL
};
```

`zh-CN.ts` 用同样 marker。后续从官方更新后，Claude Code 应先删除旧 marker
块，再根据新的缺失报告重新生成。这样官方已经补上的 key 不会和本地块重复。

### 4. 加一个可重复的 backfill 校验

Claude Code 可以临时写 `.tmp/check-i18n-backfill.mjs`，也可以新增
`scripts/check-i18n-dict-parity.ts`。如果新增 repo 脚本，用 TypeScript。

校验必须覆盖：

- `Dict` key 全部存在于 `en.ts`。
- `Dict` key 全部存在于 `zh-CN.ts`。
- `zh-CN.ts` 不包含 `...en`。
- `en` 和 `zh-CN` 同一 key 的 `{placeholder}` 集合完全一致。
- 没有重复 key。

这一步的价值是后续同步官方代码时可以直接重跑，而不是靠肉眼找 400 多个 key。

### 5. 修复 EditableCodeViewer 测试类型错误

在 `apps/web/tests/components/EditableCodeViewer.test.tsx` 的
`scrolls textarea...` 用显式 null guard，而不是类型断言硬压：

```ts
const firstCall = selectSpy.mock.calls[0];
expect(firstCall).toBeDefined();
if (!firstCall) throw new Error('Expected setSelectionRange to be called');

const [selectionStart, selectionEnd] = firstCall;
if (selectionStart == null || selectionEnd == null) {
  throw new Error('Expected setSelectionRange to receive numeric selection bounds');
}

expect(selectionStart).toBeGreaterThanOrEqual(0);
expect(selectionEnd).toBeGreaterThan(selectionStart);
```

这样既符合 DOM 类型，也保留测试本来的断言含义。

### 6. 处理相邻阻塞

如果仍报 `RenameProjectFolderResponse`：

1. 确认 `packages/contracts/src/api/files.ts` 有
   `RenameProjectFolderResponse`。
2. 确认 `packages/contracts/src/index.ts` 已 export `./api/files.js`。
3. 跑：

```bash
pnpm --filter @open-design/contracts build
```

不要改成从 `apps/web/src/types.ts` 重新定义同名类型；这会破坏 web/daemon
共享 contract 的边界。

如果仍报 `folderCount`：

1. 先跑强制 tsc，排除旧 `tsconfig.tsbuildinfo` 诊断：

```bash
pnpm --filter @open-design/web exec tsc -b --noEmit --force
```

2. 如果还存在，定位真实引用：

```bash
rg -n "folderCount" apps/web/src/components/DesignFilesPanel.tsx
```

3. 优先在同一 render scope 使用已有派生值，例如 `tableFiles.length`；
   不要引入跨组件状态。

## 中文默认语言

如果只是自己使用中文，不需要为此改代码。打开一次 UI 选择简体中文，或在浏览器
控制台设置：

```js
localStorage.setItem('open-design:locale', 'zh-CN');
localStorage.setItem('open-design:locale-source', 'manual');
```

只有在你明确希望 fork 永远默认中文时，才考虑改
`apps/web/src/i18n/index.tsx` 的 `detectInitialLocale()` fallback。这个改动会和
官方测试预期更容易冲突，不建议作为本次 tsc 修复的一部分。

## 验收命令

按顺序运行：

```bash
pnpm --filter @open-design/contracts build
pnpm --filter @open-design/web exec vitest run -c vitest.config.ts tests/components/EditableCodeViewer.test.tsx
pnpm --filter @open-design/web typecheck
pnpm i18n:coverage
```

不要把 `apps/web/tests/i18n/locales.test.ts` 作为本次 tsc 修复的必过门槛；
它当前会把日文 parity 的既有问题也拉进来。只有在你决定同时修 `ja.ts` 时，
再把它加回验收命令。

准备提交或给上游同步前，再跑仓库级检查：

```bash
pnpm guard
pnpm typecheck
```

## 给 Claude Code 的任务提示

可以直接把下面这段交给 Claude Code：

```text
请按 docs/local-zh-cn-fork-typecheck-plan.zh-CN.md 执行。

约束：
- 不要删除任何 locale。
- 不要把 Dict 改成可选字段或 Partial。
- 不要在 zh-CN.ts 引入 ...en。
- 不要用 @ts-ignore、as any 或跳过 tests 的方式绕过 tsc。
- 先生成 .tmp/i18n-missing-report.json，再补齐 en.ts 和 zh-CN.ts。
- 用 marker 块 BEGIN/END LOCAL I18N KEY BACKFILL 管理本地补齐内容，后续 rebase 可重跑。
- 修复 EditableCodeViewer.test.tsx 时用 null guard。
- contracts 类型报错时先 pnpm --filter @open-design/contracts build，不要复制 contract 类型到 web。

完成后运行：
pnpm --filter @open-design/contracts build
pnpm --filter @open-design/web exec vitest run -c vitest.config.ts tests/components/EditableCodeViewer.test.tsx
pnpm --filter @open-design/web typecheck
pnpm i18n:coverage

最后汇报仍失败的完整错误，不要继续猜。
```
