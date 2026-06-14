@AGENTS.md

## 项目技能（打包客户端）

当用户说"打包windows"、"打包mac"、"打包mac和windows"、"build mac"、"build windows"时，执行项目技能：

**技能文件**：`.claude/skills/build-client/SKILL.md`

**先读该文件再执行** —— 它包含完整的构建步骤、国内镜像设置、以及关键的 web 构建修复（Next.js 16 预渲染 bug 的 compile 模式绕过）。该修复依赖工作区里的 `apps/web/scripts/build.mjs` 和 `next@16.2.9`，不要回退它们。
