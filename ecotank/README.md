# EcoTank Demo

EcoTank 是一个原生 HTML/CSS/JavaScript 构建的多智能体行为树教学 Demo。它将论文 **Coordination of NPCs in Multi-Agent Systems Based on Behavior Trees** 中的技术路线映射到一个可交互生态水球，让用户观察个体感知、决策、通信、意图和群体关系。

## 运行

需要一个静态 HTTP 服务器 —— 3D 渲染器是 ES module 并使用 importmap，`file://` 下会被 CORS 拒绝。

```bash
python -m http.server 8127
```

然后访问 `http://localhost:8127/`。

**Windows 注意**：`python -m http.server` 从注册表读取 MIME 类型，`.js` 常被登记为 `text/plain`。module script 有严格 MIME 检查，会静默拒绝加载（普通 script 不受影响，所以现象是 2D 逻辑正常但水球不出现）。用这条命令绕开：

```bash
python -c "import mimetypes, http.server; mimetypes.add_type('text/javascript', '.js'); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8127)"
```

three.js 与 three-html-render 已 vendor 进 `vendor/`，无需 npm install 或构建。页面会请求 Google Fonts；网络不可用时仍可运行，只会退回系统字体。

## 当前功能

- 运行、暂停、单步、重置和五阶段演示脚本。
- 中文/English 界面切换。
- 3D 生态水球：拖拽旋转、滚轮潜入水面之下、点击选中个体、跟随选中个体。
- 大鱼、小鱼、虾米、螺、清洁鱼、鱼虱、水草和浮游食物。
- 捕食、寄生、互利清洁、资源竞争、同种协作捕猎和群体防御。
- 生命周期、能量、年龄、繁殖、死亡和营养回收。
- 感知、消息、子目标和意图可视化图层。
- 行为树状态、blackboard、情绪、知识、搜索采样、通信队列和关系网络监控。

## 技术结构

```text
ecotank/
├── index.html              # 页面结构、importmap 和交互控件
├── ecotank.css             # 响应式布局与视觉样式
├── ecotank.js              # 仿真、决策、通信、关系、生物美术和 UI
├── ecotank3d.js            # WebGL 水球渲染器（ES module）
├── zine.js                 # 丝网印后处理 pass：分色、半调网点、纸
├── vendor/three/           # three.js 0.184 + OrbitControls
├── vendor/three-html-render/  # HTML-in-Canvas polyfill
└── assets/paper/           # 论文 Fig. 1 至 Fig. 6
```

### 2D 仿真如何映射到球面

仿真本身严格保持 2D，`ecotank3d.js` 只负责把它铺到一个水球上。水球是**极向**的：光从上极进入，下极是岩石海床。

| 仿真量 | 球面量 |
|---|---|
| tank `x` | 经度 0..2π（左右两壁在接缝处相接） |
| tank `y` | 纬度（`waterTop` = 受光的上极，`floor` = 下极海床盖） |
| `__vis.z` | 半径（决定生命层的厚度） |

深度走纬度而不是半径，球才有真正的上下：往上游就靠近光，下沉就落到岩石上。半径只提供体积感，并且随深度趋近 `floor` 被推到海床盖上 —— 否则螺会悬在岩石上方。

`__vis.z` 是纯渲染量，由 `ecotank.js` 的 `stepVisualDepth()` 维护，仿真的任何部分都不读它。它不是随机的：个体会向自己当前目标的 `z` 漂移，没有目标时才游走 —— 否则捕食者和猎物会散落在球的两端，追逐连线会横跨 60° 经度。

### 美术与光照

画风是**极简 zine / riso 丝网印**：陈旧纸底、大面积留白、有限专色、半调网点和套印偏差。参考 [gc-minimal-zine-poster](https://github.com/LiamGvchi/gc-minimal-zine-poster) 的风格戒律 —— 那份 skill 明确排斥 3D 渲染，所以这里只借它的**印刷工艺**，不借它的构图模板：几何体仍是真实的，成像端整体压成三版印刷。

油墨全局只有四个值，`ecotank3d.js`、`zine.js`、`ecotank.css` 和 `COLORS` 共用：

| | |
|---|---|
| 纸 | `#efe6d2` |
| 墨 | `#22201c` |
| 暖专色 | `#ff4d1f`（唯一高彩锚点：太阳、选中环、食物、捕食关系） |
| 冷专色 | `#2a4fd6`（克制使用：通信、互利） |

- **`zine.js`（印刷 pass）**：composer 的最后一道，跑在 `OutputPass` 之后，因此拿到的已经是 sRGB。它把画面按 `1 - 亮度` 转成油墨覆盖率，按 HSV 色相把饱和像素分给暖 / 冷专色版，三版各自以 45° / 15° / 75° 打半调网点，亚像素错位后**相乘**叠印，最后落在带纤维颗粒、污渍和扫描暗角的纸上。
  - 网点半径必须是面积精确的 `sqrt(cov/π)`：半径 0.5 的圆已经填满 79% 的网格，用 `0.72*sqrt(cov)` 会让 0.45 的中间调印成 0.8，以上全部糊成实地。
  - `uWhite` 是最小可印网点，低于它的高光直接掉版留白 —— 否则留白处处处是灰点，纸就不再读作纸。
  - `uPitch` 默认 3.6 而不是海报该有的 4.5：这张印刷品要承载一个活的仿真，网点一粗，细线关系和小个体会被整个吞掉。
- **场景端**：关掉 tone mapping（filmic 曲线是渐变发生器），删掉 bloom（辉光是印刷的反面），清屏为纯白。每个颜色常量都写成油墨覆盖率 `k`（见 `INK_GLSL` 的 `inkTone`），并且分层配给：水体 0.12–0.38 是底，岩石 0.28–0.52，生物 0.58–0.82 加 +0.30 的剪影墨边。水体不能和生物抢同一段色阶，否则鱼放在水上无处可去。
- **生物**：扫掠管状躯体 + 独立的尾/背/臀/胸鳍，每物种一个 `InstancedMesh`；游动是顶点着色器里沿脊椎行进的正弦波，振幅在头部归零，所以是游而不是横向剪切。螺是对数螺线壳，虾是弓形腹部 + 尾扇 + 触须。物种色被压到 0.22 饱和度以下，否则会越过 pass 的专色阈值、整群印成荧光橙。
- **水草**：变宽飘带，沿球面切向朝上极生长（径向生长会让叶片直接穿出水面）。叶片从岩石沿切线离开，叶尖在 `hypot(rootR, height)` 处，所以根部要压到 `0.93R` 并限高，否则会捅破球皮。
- **日夜与天气**：不再是房间明暗，而是**上墨量**。夜里水体多吃 0.10 的墨并偏冷，阴雨多吃 0.08 并变浑；太阳仍固定在世界空间、相机环绕，所以明暗交界线焊在球上。
- **叠加图层**：连线用 `MultiplyBlending`（纸上的线只能变暗，白 = 不上墨），强度是「离白多远」。调用方给的 alpha 多在 0.2–0.45，要先过一道 `sqrt` 才印得出来。

### 调试

`window.__eco3d` 暴露了 scene、相机、composer、zine、sky 和各个 mesh。着色器常量只能靠眼睛判断，这个把手就是为了在 console 里直接调。印刷参数全在 `__eco3d.zine.uniforms` 上：`uPitch`（网点间距）、`uSpread`（上墨增益）、`uWhite`（高光掉版）、`uGrain`（纸纹）、`uMisreg`（套印偏差，设 0 就没有 riso 味了）。

`localhost` 下渲染器会开 `preserveDrawingBuffer`（生产环境不开，省掉每帧一次拷贝），配合 `.claude/devserver.py` 的 `PUT /__shot` 端点，页面可以把自己渲染的帧回传成 `shot.png` —— 用于在无法截图的环境里核对画面。

`.claude/devserver.py` 是开发用静态服务器，做四件事：强制 `.js` 为 `text/javascript`（Windows 注册表常把它登记成 `text/plain`，module script 会静默拒绝加载）、发 `Cache-Control: no-store`、接受 `PUT /__shot` 把页面自己渲染的帧写成 `shot.png`、以及 `/?anim=timer` 注入一个用 Worker 驱动的 `requestAnimationFrame` 垫片。最后一条是给无头核对用的：隐藏标签页根本拿不到 rAF，页面会停在第 0 帧，`PUT /__shot` 也就无帧可交；定时器在隐藏标签页里会被 Chrome 降到 1 秒甚至 1 分钟一次，Worker 不受影响。

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

- `ecotank.js` 仍是单文件，算法、仿真、生物美术和 UI 耦合。
- 水球的半径轴是渲染层虚构的，不是仿真的第三个维度：感知半径、距离和边界判定全部仍在 2D 平面上计算。视觉上互不相邻的两个个体仍可能在仿真里是邻居。
- 侧视 2D 视图已被水球完全替换，没有降级路径；WebGL 不可用的设备会看到空白画布。
- `vendor/three-html-render/` 已 vendor 但当前未被使用。把 HTML 光栅化贴到曲面上会比平面 DOM 更难读，所以监控面板仍是普通 DOM；这个库留着给球面上的锚定标签用。
- 监控中的 BT 节点是状态记录，不是递归执行的节点对象。
- 搜索 trace 中的 expansion/backpropagation 是概念标签，当前没有真实状态树。
- 多智能体通信和意图共享运行在同一浏览器进程、同一世界状态中。
- 生态稳定机制会补充关键物种，适合演示但不代表自然生态模型。
- 使用 Google Fonts；严格离线部署应改成本地字体或完全使用系统字体。

## 修改规则

修改 Demo 时同时完成：

1. 运行 `node --check ecotank.js` 和 `node --check ecotank3d.js`。
2. 确认 JavaScript 使用的 DOM ID 都存在于 `index.html`。
3. 在浏览器里切一遍全部 4 种搜索策略 × 4 种通信模式；`sharedIntentions` 这类按物种索引的表曾在这里漏过物种。
4. 检查中文和英文界面。
5. 检查 Run、Step、Reset、策略切换、通信切换、干预、旋转、潜入和跟随。
6. 更新本 README 和学习指南。
7. 若修改论文映射，更新复现计划的追踪矩阵与证据链接。
