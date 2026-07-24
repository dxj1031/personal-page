# Personal Page 审查说明

## 当前定位

这是一个 885 行、约 198 KB 的单文件个人主页原型。页面将个人经历组织成一条“游戏 AI → 行为模拟 → 认知/情绪 → 多智能体集体决策”的叙事链，视觉主题统一，核心问题也很明确：有缺陷的智能体社会能否比单一理性个体做出更好的决定。

## 页面内容结构

1. Hero：`AI Product Engineer` 定位与多智能体、LLM Agent、全栈、产品标签。
2. Runtime Design / Explainability：列出 simulation loop、state model、blackboard、mailbox、memory decay、search traces 等实现点。
3. Chapter 01 — EcoTank：Behavior Trees、MCTS、多智能体 NPC 协同。
4. Chapter 02 — Cognition：CBT reflection、emotion tracking、cognitive modeling。
5. Chapter 03 — The Ministers：LLM 多智能体协商与集体决策。
6. Current Obsession：用一个研究问题收束全页。
7. Capability Field：Agent Systems、Simulation Systems、Engineering、Product Thinking。
8. Footer：邮箱、GitHub、LinkedIn。

## 必须先解决的问题

### P0：页面运行依赖缺失

- `Personal Page.html` 引用了 `./support.js`，但目录中只有 HTML 文件。
- 页面使用 `<x-dc>`、`<helmet>`、`style-hover` 和 `text/x-dc` 等非标准运行时约定；没有 `support.js` 时，自定义脚本不会按普通浏览器 JavaScript 执行。
- 在补齐生成器运行时或转换为标准 HTML/CSS/JS 前，不应把该文件视为可部署版本。

### P1：作品叙事与证据链不完整

- 页面出现 `Judge Paw` 与 `Chapters 04–05`，但正文没有对应章节。
- DOM 使用 `id="ch6"`、`data-screen-label="Ch 04 Collapse"`，可见编号却是 `03`，章节命名不一致。
- `EcoTank`、认知反思系统、`The Ministers` 等没有项目链接、代码仓库、时间、角色、约束、成果或指标。
- 当前简历能支持 MCTS、多智能体、决策系统和全栈方向，但没有逐项证明上述页面项目。建议为每个项目补充 `Problem / Role / Build / Result / Link` 五项。
- `AI Product Engineer` 是清晰的目标定位，但当前简历主要呈现学生与研究经历；页面应增加一段简短说明，把研究经历、State-Tide 和产品工程定位连接起来。

### P1：网页基础信息与可访问性缺失

- 缺少 `<title>`、`lang`、description、Open Graph 信息和 favicon。
- 没有 `<h1>`、`<nav>`、`<main>`、`<footer>` 等语义结构。
- 两个 canvas 没有文本替代；大量动画没有 `prefers-reduced-motion` 降级。
- 隐藏滚动条会降低可发现性；固定顶部链接和右侧导航需要单独验证窄屏布局。
- `target="_blank"` 链接应增加 `rel="noopener noreferrer"`。

### P2：维护性与性能

- HTML、CSS、SVG 和 JavaScript 全部堆在单文件中，后续修改和排错成本高。
- 页面加载 5 个 Google Fonts 字体族，同时持续运行多个 canvas/CSS 动画；移动设备和低性能设备可能出现卡顿。
- 大量内联样式与重复组件应提取成类；作品数据应改为一个结构化数组，再由模板生成。

## 建议的实现结构

```text
Personal Page/
├─ index.html          # 标准语义 HTML 与 SEO 元信息
├─ styles.css          # 设计变量、布局、动画和 reduced-motion
├─ app.js              # 滚动、canvas、交互逻辑
├─ projects.js         # EcoTank / Cognition / The Ministers 数据
├─ assets/             # 图片、图标、字体等静态资源
└─ README.md
```

优先顺序：恢复或移除 `support.js` 依赖 → 修正章节与缺失项目 → 补项目证据和链接 → 标准化结构与可访问性 → 再做性能优化。
