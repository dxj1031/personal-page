# EcoTank Demo

EcoTank 是一个原生 HTML/CSS/JavaScript 构建的多智能体行为树教学 Demo。它将论文 **Coordination of NPCs in Multi-Agent Systems Based on Behavior Trees** 中的技术路线映射到一个可交互生态缸，让用户观察个体感知、决策、通信、意图和群体关系。

## 运行

直接打开 `index.html`，或将仓库根目录作为静态网站目录运行并访问 `/EcoTank/demo/`。

不需要安装依赖、构建前端或启动后端。页面会请求 Google Fonts；网络不可用时仍可运行，只会退回系统字体。

## 当前功能

- 运行、暂停、单步、重置和五阶段演示脚本。
- 中文/English 界面切换。
- Canvas 缩放、平移、复位和跟随选中个体。
- 大鱼、小鱼、虾米、螺、清洁鱼、鱼虱、水草和浮游食物。
- 捕食、寄生、互利清洁、资源竞争、同种协作捕猎和群体防御。
- 生命周期、能量、年龄、繁殖、死亡和营养回收。
- 感知、消息、子目标和意图可视化图层。
- 行为树状态、blackboard、情绪、知识、搜索采样、通信队列和关系网络监控。

## 技术结构

```text
demo/
├── index.html              # 页面结构和交互控件
├── ecotank.css             # 响应式布局与视觉样式
├── ecotank.js              # 仿真、决策、通信、关系、渲染和 UI
└── assets/paper/           # 论文 Fig. 1 至 Fig. 6
```

运行时全部保存在浏览器内存中：

```text
requestAnimationFrame
        │
        ├── 固定时间步 simulateStep()
        │     ├── 环境与生命周期
        │     ├── 局部感知与知识
        │     ├── mailbox / knowledge transfer
        │     ├── candidate / search / intention
        │     ├── 行动、捕食与繁殖
        │     └── 生态关系与稳定机制
        └── Canvas + DOM 监控渲染
```

## 与论文技术点的对应关系

| 论文技术点 | 当前 Demo | 当前实现级别 |
|---|---|---|
| 基础 BT | Root、Service、RH、Emotional Selector 等状态展示 | 教学状态映射，不是通用 BT runtime |
| Emotional BT | hunger/fear/curiosity/social 影响 plan/risk/time | 启发式近似，未逐式复现论文公式 |
| EDBT | mailbox、soft/hard 消息、RH 抢占 | 部分实现，缺 HRS 确认和中断保护协议 |
| MDP/MMDP/Dec-POMDP | 局部观察、奖励和共享意图概念 | 未实现正式模型 |
| MCTS/UCT | UCT 选择和启发式 rollout | MCTS-style 候选采样，不是完整搜索树 |
| Dec-MCTS | 同种 agent 发布意图分布并计算冲突 | 共享内存近似，未完整实现异步分布式阶段 |
| Dec-SGTS | zone、subgoal route、pair cost、D-UCT 风格采样 | 子目标近似，未实现完整子目标树和分布式优化 |
| IKT-BT | QRA、QRU、EU、EBU、TTL knowledge、buffer | 机制级近似，尚无完整 BT 模块与实验复现 |

因此，当前版本应描述为“论文技术的交互式教学 Demo”，不能描述为“论文算法完整复现”。完整复现路线见 [../../docs/Paper_Technical_Reproduction_Plan_zh-CN.md](../../docs/Paper_Technical_Reproduction_Plan_zh-CN.md)。

## Demo 自有扩展

螺、清洁鱼、鱼虱、寄生、互利共生、竞争、合作捕猎和群体防御属于 EcoTank 场景扩展，不是论文提出的算法。这些功能用于产生更丰富的多智能体压力和可观察关系，但在论文技术追踪中必须标记为 `DEMO_EXTENSION`。

## 默认配置

- Search：Dec-SGTS
- Communication：EBU
- Emotional BT：开启
- EDBT：开启
- Lifecycle：开启
- Communication range：150
- 随机种子：`20260821`
- 正常决策间隔：7 个仿真 tick；hard message、目标失效、到达、超时或卡住可提前触发决策

## 已知限制

- `ecotank.js` 仍是单文件，算法、仿真、渲染和 UI 耦合。
- 监控中的 BT 节点是状态记录，不是递归执行的节点对象。
- 搜索 trace 中的 expansion/backpropagation 是概念标签，当前没有真实状态树。
- 多智能体通信和意图共享运行在同一浏览器进程、同一世界状态中。
- 生态稳定机制会补充关键物种，适合演示但不代表自然生态模型。
- 使用 Google Fonts；严格离线部署应改成本地字体或完全使用系统字体。

## 修改规则

修改 Demo 时同时完成：

1. 运行 `node --check ecotank.js`。
2. 确认 JavaScript 使用的 DOM ID 都存在于 `index.html`。
3. 检查中文和英文界面。
4. 检查 Run、Step、Reset、策略切换、通信切换、干预、缩放和平移。
5. 更新本 README 和学习指南。
6. 若修改论文映射，更新复现计划的追踪矩阵与证据链接。
