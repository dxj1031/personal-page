(() => {
  "use strict";

  const LANG = localStorage.getItem("ecotank-lang") === "en" ? "en" : "zh";
  const tr = (zh, en) => (LANG === "en" ? en : zh);
  function applyStaticI18n() {
    if (LANG !== "en") return;
    document.documentElement.lang = "en";
    document.title = "EcoTank · Multi-Agent Behavior-Tree Ecosystem";
    document.querySelectorAll("[data-en]").forEach((el) => { el.textContent = el.dataset.en; });
    document.querySelectorAll("[data-en-title]").forEach((el) => { el.title = el.dataset.enTitle; });
  }

  const WORLD = { width: 1120, height: 640, waterTop: 46, floor: 582 };
  const SAFE_MARGIN = 22;
  const DECISION_PERIOD = 7;
  const MIN_ACTION_AGE = 18;
  const MAX_ACTION_AGE = 96;
  const STUCK_LIMIT = 18;
  const ECO_MINIMUMS = { bigfish: 1, smallfish: 5, shrimp: 16, snail: 6, cleaner: 2 };
  const ECO_VISIBLE_TARGETS = { bigfish: 1, smallfish: 6, shrimp: 22, snail: 9, cleaner: 3 };
  const INITIAL_COUNTS = { plants: 80, food: 24, bigfish: 1, smallfish: 6, shrimp: 22, snail: 9, cleaner: 3, louse: 6 };
  const RECRUITMENT_PACE = { bigfish: 1, smallfish: 2, shrimp: 6, snail: 3, cleaner: 1 };
  const STATUS = { running: "running", success: "success", failure: "failure", idle: "idle" };

  const COLORS = {
    bigfish: "#ffb45f",
    smallfish: "#6fc6ff",
    shrimp: "#ff8aa5",
    snail: "#c9a24b",
    cleaner: "#7effc4",
    louse: "#b98cff",
    plant: "#78d669",
    food: "#f4d37d",
    danger: "#ff6b6b",
    message: "#5eead4",
    subgoal: "#c398ff",
  };

  // relationship-type palette (cross-species + intraspecies interactions)
  const REL_COLORS = {
    predation: "#ff6b6b",   // 捕食
    mutualism: "#3ce8a0",   // 共生 (cleaner <-> host)
    parasitism: "#b98cff",  // 寄生 (louse -> host)
    competition: "#ffb347", // 跨物种竞争
    intraspecific: "#ff86c2", // 物种内竞争
    cooperation: "#5ec8ff", // 合作
  };

  const SPECIES = {
    bigfish: {
      label: tr("大鱼", "Big fish"),
      idPrefix: "B",
      size: 28,
      speed: 3.1,
      sense: 210,
      prey: ["smallfish"],
      predators: [],
      maxEnergy: 120,
      spawnEnergy: 88,
      matureAge: 340,
      maxAge: 5200,
      calories: 48,
      metabolism: 0.028,
      birthLimit: 2,
      schooling: 0.05,
    },
    smallfish: {
      label: tr("小鱼", "Small fish"),
      idPrefix: "F",
      size: 16,
      speed: 2.95,
      sense: 170,
      prey: ["shrimp", "food"],
      predators: ["bigfish"],
      maxEnergy: 74,
      spawnEnergy: 50,
      matureAge: 210,
      maxAge: 4200,
      calories: 25,
      metabolism: 0.02,
      birthLimit: 11,
      schooling: 0.22,
    },
    shrimp: {
      label: tr("虾米", "Shrimp"),
      idPrefix: "R",
      size: 10,
      speed: 2.18,
      sense: 120,
      prey: ["plant", "food"],
      predators: ["smallfish"],
      maxEnergy: 42,
      spawnEnergy: 27,
      matureAge: 120,
      maxAge: 3300,
      calories: 12,
      metabolism: 0.013,
      birthLimit: 38,
      schooling: 0.12,
      grazer: true,
    },
    snail: {
      label: tr("螺", "Snail"),
      idPrefix: "N",
      size: 12,
      speed: 0.62,
      sense: 74,
      prey: ["plant"],
      predators: [],
      maxEnergy: 54,
      spawnEnergy: 36,
      matureAge: 240,
      maxAge: 5200,
      calories: 11,
      metabolism: 0.0075,
      birthLimit: 22,
      schooling: 0,
      benthic: true,
      grazer: true,
    },
    cleaner: {
      label: tr("清洁鱼", "Cleaner fish"),
      idPrefix: "C",
      size: 13,
      speed: 3.05,
      sense: 200,
      prey: ["food", "louse"],
      predators: [],
      maxEnergy: 64,
      spawnEnergy: 42,
      matureAge: 220,
      maxAge: 4200,
      calories: 16,
      metabolism: 0.017,
      birthLimit: 10,
      schooling: 0.1,
      cleaner: true,
    },
    louse: {
      label: tr("鱼虱", "Fish louse"),
      idPrefix: "L",
      size: 5,
      speed: 1.65,
      sense: 150,
      prey: [],
      predators: ["cleaner"],
      maxEnergy: 24,
      spawnEnergy: 15,
      matureAge: 70,
      maxAge: 1600,
      calories: 4,
      metabolism: 0.018,
      birthLimit: 44,
      schooling: 0,
      parasite: true,
    },
  };

  // which species a louse can attach to, and which hosts a cleaner services
  const HOST_SPECIES = ["bigfish", "smallfish"];

  const ZONES = [
    { id: "grass-left", label: tr("左侧水草床", "Left plant bed"), x: 185, y: 510, w: 250, h: 126, risk: 0.26, food: 0.86 },
    { id: "cave", label: tr("岩洞安全区", "Cave shelter"), x: 545, y: 520, w: 190, h: 105, risk: 0.16, safety: 0.9 },
    { id: "open", label: tr("开阔水域", "Open water"), x: 570, y: 268, w: 470, h: 260, risk: 0.68, food: 0.35 },
    { id: "surface", label: tr("水面投喂区", "Surface feeding zone"), x: 520, y: 92, w: 550, h: 100, risk: 0.44, food: 0.62 },
    { id: "nursery", label: tr("幼体躲藏区", "Nursery cover"), x: 900, y: 480, w: 270, h: 150, risk: 0.24, safety: 0.7 },
    { id: "edge", label: tr("边界巡游区", "Edge patrol strip"), x: 64, y: 230, w: 120, h: 320, risk: 0.38, safety: 0.45 },
  ];

  const TECH_POINTS = [
    {
      key: "bt",
      title: tr("BT 基础执行", "Core BT Execution"),
      body: tr("Root Selector 每个 tick 在生存、觅食、繁殖、探索、休息之间返回 running / success / failure。", "Each tick the root selector returns running / success / failure across survival, foraging, mating, exploration and rest."),
      tags: ["Selector", "Sequence", "Action", "Condition", "Blackboard"],
    },
    {
      key: "emotion",
      title: "Emotional Behavior Tree",
      body: tr("饥饿、恐惧、好奇和群体安全感改变 planning、risk perception、time discounting 权重。", "Hunger, fear, curiosity and group safety reshape the planning, risk-perception and time-discounting weights."),
      tags: ["planning", "risk", "time discounting"],
    },
    {
      key: "edbt",
      title: "Event-driven BT",
      body: tr("捕食者、食物、同伴遇袭、敲击鱼缸会进入 mailbox；RH 节点可抢占当前行为。", "Predators, food, attacked peers and tank taps enter the mailbox; RH nodes can preempt the current behavior."),
      tags: ["RH", "SRS", "HRS", "mailbox", "interrupt"],
    },
    {
      key: "mcts",
      title: "MCTS / UCT",
      body: tr("个体对候选行为做 UCT 采样，rollout 估计能量收益、风险、距离和未来状态。", "Agents run UCT sampling over candidate actions; rollouts estimate energy gain, risk, distance and future state."),
      tags: ["UCT", "rollout", "backprop"],
    },
    {
      key: "decmcts",
      title: "Dec-MCTS",
      body: tr("同类个体发布意图分布，后续决策会避开同一猎物、同一躲藏区或同一繁殖目标。", "Conspecifics publish intention distributions, so later decisions avoid the same prey, shelter or mate."),
      tags: ["local search", "intention sharing"],
    },
    {
      key: "decsgts",
      title: "Dec-SGTS",
      body: tr("生态缸被抽象为水草床、岩洞、开阔水域、水面、幼体区等子目标序列。", "The tank is abstracted into a subgoal sequence: plant beds, cave, open water, surface and nursery."),
      tags: ["subgoal predicate", "D-UCT", "pair evaluation"],
    },
    {
      key: "ikt",
      title: tr("IKT-BT 通信", "IKT-BT Communication"),
      body: tr("QRA / QRU 是直接查询；EU / EBU 会窃听附近消息并更新或缓存知识。", "QRA / QRU are direct queries; EU / EBU eavesdrop on nearby messages to update or cache knowledge."),
      tags: ["TQRA", "TQRU", "TEU", "TEBU", "episodic buffer"],
    },
    {
      key: "life",
      title: tr("生命周期", "Lifecycle"),
      body: tr("年龄、能量、饥饿、繁殖冷却和死亡回收会反馈到黑板和行为树选择。", "Age, energy, hunger, mating cooldown and death recycling feed back into the blackboard and tree choices."),
      tags: ["energy", "age", "birth", "death"],
    },
  ];

  const FIGURES = [
    ["image1.png", tr("Fig. 1 情绪选择器", "Fig. 1 Emotion selector")],
    ["image2.png", tr("Fig. 2 EDBT 工作流", "Fig. 2 EDBT workflow")],
    ["image3.png", tr("Fig. 3 协调节点结构", "Fig. 3 Coordination node structure")],
    ["image4.png", "Fig. 4 MDP"],
    ["image5.png", "Fig. 5 MCTS"],
    ["image6.png", tr("Fig. 6 直接通信与窃听", "Fig. 6 Direct communication & eavesdropping")],
  ];

  class Random {
    constructor(seed) {
      this.seed = seed >>> 0;
    }

    next() {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }

    range(min, max) {
      return min + (max - min) * this.next();
    }

    choice(items) {
      return items[Math.floor(this.next() * items.length)];
    }
  }

  const ui = {};
  const settings = {
    speed: 1.2,
    search: "decsgts",
    comm: "ebu",
    emotion: true,
    eventDriven: true,
    lifecycle: true,
    commRange: 150,
    overlays: {
      perception: false,
      messages: false,
      subgoals: false,
      intentions: false,
    },
  };

  let world;
  let running = false;
  let selectedId = "";
  const camera = { zoom: 1, cx: WORLD.width / 2, cy: WORLD.height / 2, follow: false };
  const MAX_ZOOM = 6.5;
  let frameHandle = 0;
  let lastFrame = 0;
  let accumulator = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applyStaticI18n();
    cacheUi();
    bindUi();
    resetWorld();
    renderAll();
    frameHandle = requestAnimationFrame(loop);
  }

  function cacheUi() {
    ui.canvas = document.getElementById("tankCanvas");
    ui.runToggle = document.getElementById("runToggle");
    ui.stepButton = document.getElementById("stepButton");
    ui.resetButton = document.getElementById("resetButton");
    ui.scriptButton = document.getElementById("scriptButton");
    ui.speedRange = document.getElementById("speedRange");
    ui.fullscreenButton = document.getElementById("fullscreenButton");
    ui.langButton = document.getElementById("langButton");
    ui.tabs = [...document.querySelectorAll(".tab-button")];
    ui.demoTab = document.getElementById("demoTab");
    ui.monitorTab = document.getElementById("monitorTab");
    ui.metricStrip = document.getElementById("metricStrip");
    ui.searchMode = document.getElementById("searchMode");
    ui.commMode = document.getElementById("commMode");
    ui.emotionToggle = document.getElementById("emotionToggle");
    ui.eventToggle = document.getElementById("eventToggle");
    ui.lifecycleToggle = document.getElementById("lifecycleToggle");
    ui.commRange = document.getElementById("commRange");
    ui.commRangeValue = document.getElementById("commRangeValue");
    ui.agentSelect = document.getElementById("agentSelect");
    ui.selectedName = document.getElementById("selectedName");
    ui.selectedSummary = document.getElementById("selectedSummary");
    ui.scriptPanel = document.getElementById("scriptPanel");
    ui.eventFeed = document.getElementById("eventFeed");
    ui.populationPanel = document.getElementById("populationPanel");
    ui.btTree = document.getElementById("btTree");
    ui.blackboardPanel = document.getElementById("blackboardPanel");
    ui.searchPanel = document.getElementById("searchPanel");
    ui.communicationPanel = document.getElementById("communicationPanel");
    ui.techMap = document.getElementById("techMap");
    ui.paperFigures = document.getElementById("paperFigures");
    ui.overlayAll = document.getElementById("overlayAll");
    ui.overlayPerception = document.getElementById("overlayPerception");
    ui.overlayMessages = document.getElementById("overlayMessages");
    ui.overlaySubgoals = document.getElementById("overlaySubgoals");
    ui.overlayIntentions = document.getElementById("overlayIntentions");
    ui.zoomIn = document.getElementById("zoomIn");
    ui.zoomOut = document.getElementById("zoomOut");
    ui.zoomReset = document.getElementById("zoomReset");
    ui.zoomFollow = document.getElementById("zoomFollow");
    ui.zoomHud = document.getElementById("zoomHud");
    ui.relationshipGraph = document.getElementById("relationshipGraph");
  }

  function bindUi() {
    ui.runToggle.addEventListener("click", toggleRun);
    ui.stepButton.addEventListener("click", () => {
      if (running) toggleRun();
      simulateStep();
      draw();
      renderAll();
    });
    ui.resetButton.addEventListener("click", () => {
      if (running) toggleRun();
      resetWorld();
      renderAll();
      draw();
    });
    ui.scriptButton.addEventListener("click", startScript);
    if (ui.langButton) {
      ui.langButton.textContent = LANG === "en" ? "中文" : "English";
      ui.langButton.addEventListener("click", () => {
        localStorage.setItem("ecotank-lang", LANG === "en" ? "zh" : "en");
        location.reload();
      });
    }
    ui.speedRange.addEventListener("input", () => {
      settings.speed = Number(ui.speedRange.value);
    });
    ui.fullscreenButton.addEventListener("click", () => {
      document.body.classList.toggle("focus-mode");
      resizeCanvas();
      draw();
    });
    ui.tabs.forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    ui.searchMode.addEventListener("click", (event) => setSegment(event, "search"));
    ui.commMode.addEventListener("click", (event) => setSegment(event, "comm"));
    ui.emotionToggle.addEventListener("change", () => {
      settings.emotion = ui.emotionToggle.checked;
      renderAll();
    });
    ui.eventToggle.addEventListener("change", () => {
      settings.eventDriven = ui.eventToggle.checked;
      renderAll();
    });
    ui.lifecycleToggle.addEventListener("change", () => {
      settings.lifecycle = ui.lifecycleToggle.checked;
      renderAll();
    });
    ui.commRange.addEventListener("input", () => {
      settings.commRange = Number(ui.commRange.value);
      ui.commRangeValue.textContent = String(settings.commRange);
    });
    ui.overlayPerception.addEventListener("change", () => {
      settings.overlays.perception = ui.overlayPerception.checked;
      syncOverlayAllButton();
    });
    ui.overlayMessages.addEventListener("change", () => {
      settings.overlays.messages = ui.overlayMessages.checked;
      syncOverlayAllButton();
    });
    ui.overlaySubgoals.addEventListener("change", () => {
      settings.overlays.subgoals = ui.overlaySubgoals.checked;
      syncOverlayAllButton();
    });
    ui.overlayIntentions.addEventListener("change", () => {
      settings.overlays.intentions = ui.overlayIntentions.checked;
      syncOverlayAllButton();
    });
    if (ui.overlayAll) ui.overlayAll.addEventListener("click", () => {
      const on = !Object.values(settings.overlays).every(Boolean);
      settings.overlays = { perception: on, messages: on, subgoals: on, intentions: on };
      ui.overlayPerception.checked = on;
      ui.overlayMessages.checked = on;
      ui.overlaySubgoals.checked = on;
      ui.overlayIntentions.checked = on;
      syncOverlayAllButton();
    });
    syncOverlayAllButton();
    ui.agentSelect.addEventListener("change", () => {
      selectedId = ui.agentSelect.value;
      if (camera.follow) centerOnSelected();
      renderAll();
    });
    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => handleIntervention(button.dataset.action));
    });
    bindCameraControls();
    window.addEventListener("resize", () => {
      resizeCanvas();
      draw();
    });
  }

  function centerOnSelected() {
    const a = getAgent(selectedId);
    if (a && a.alive) { camera.cx = (a.__vis || a).x; camera.cy = (a.__vis || a).y; }
  }

  function applyZoom(nextZoom, anchorPx, anchorPy) {
    const fit = canvasFit();
    // world point under the anchor before zooming
    const wx = anchorPx == null ? camera.cx : (anchorPx - fit.offsetX) / fit.scale;
    const wy = anchorPy == null ? camera.cy : (anchorPy - fit.offsetY) / fit.scale;
    camera.zoom = clamp(nextZoom, 1, MAX_ZOOM);
    const scale2 = fit.base * camera.zoom;
    // keep that world point pinned under the cursor
    camera.cx = wx - (anchorPx == null ? 0 : (anchorPx - ui.canvas.width / 2) / scale2);
    camera.cy = wy - (anchorPy == null ? 0 : (anchorPy - ui.canvas.height / 2) / scale2);
    if (camera.zoom <= 1.001) { camera.zoom = 1; camera.cx = WORLD.width / 2; camera.cy = WORLD.height / 2; }
    updateZoomHud();
    if (!running) draw();
  }

  function canvasPx(event) {
    const rect = ui.canvas.getBoundingClientRect();
    return {
      px: (event.clientX - rect.left) * (ui.canvas.width / rect.width),
      py: (event.clientY - rect.top) * (ui.canvas.height / rect.height),
    };
  }

  function bindCameraControls() {
    // wheel = zoom toward cursor
    ui.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const { px, py } = canvasPx(event);
      const factor = Math.exp(-event.deltaY * 0.0016);
      camera.follow = false;
      applyZoom(camera.zoom * factor, px, py);
      syncFollowButton();
    }, { passive: false });

    // pointer: click to select, drag to pan (when zoomed in)
    let down = null;
    ui.canvas.addEventListener("pointerdown", (event) => {
      const { px, py } = canvasPx(event);
      down = { px, py, cx: camera.cx, cy: camera.cy, moved: false, id: event.pointerId };
      ui.canvas.setPointerCapture(event.pointerId);
    });
    ui.canvas.addEventListener("pointermove", (event) => {
      if (!down) return;
      const { px, py } = canvasPx(event);
      const dx = px - down.px, dy = py - down.py;
      if (!down.moved && Math.hypot(dx, dy) > 5) down.moved = true;
      if (down.moved && camera.zoom > 1.001) {
        const fit = canvasFit();
        camera.follow = false;
        syncFollowButton();
        camera.cx = down.cx - dx / fit.scale;
        camera.cy = down.cy - dy / fit.scale;
        ui.canvas.style.cursor = "grabbing";
        if (!running) draw();
      }
    });
    const endDrag = (event) => {
      if (!down) return;
      if (!down.moved) selectFromCanvas(event);
      down = null;
      ui.canvas.style.cursor = "";
    };
    ui.canvas.addEventListener("pointerup", endDrag);
    ui.canvas.addEventListener("pointercancel", () => { down = null; ui.canvas.style.cursor = ""; });

    if (ui.zoomIn) ui.zoomIn.addEventListener("click", () => applyZoom(camera.zoom * 1.5, ui.canvas.width / 2, ui.canvas.height / 2));
    if (ui.zoomOut) ui.zoomOut.addEventListener("click", () => applyZoom(camera.zoom / 1.5, ui.canvas.width / 2, ui.canvas.height / 2));
    if (ui.zoomReset) ui.zoomReset.addEventListener("click", () => { camera.follow = false; syncFollowButton(); applyZoom(1); });
    if (ui.zoomFollow) ui.zoomFollow.addEventListener("click", () => {
      camera.follow = !camera.follow;
      syncFollowButton();
      if (camera.follow) {
        centerOnSelected();
        if (camera.zoom < 2.4) applyZoom(2.8); else updateZoomHud();
      }
      if (!running) draw();
    });
    updateZoomHud();
  }

  function syncOverlayAllButton() {
    if (ui.overlayAll) ui.overlayAll.classList.toggle("active", Object.values(settings.overlays).every(Boolean));
  }

  function syncFollowButton() {
    if (ui.zoomFollow) ui.zoomFollow.classList.toggle("active", camera.follow);
  }

  function updateZoomHud() {
    if (!ui.zoomHud) return;
    const a = world ? getAgent(selectedId) : null;
    const who = a ? `${a.id} ${SPECIES[a.species].label}` : "—";
    ui.zoomHud.textContent = `${camera.zoom.toFixed(1)}× · ${camera.follow ? tr("跟随 ", "Follow ") + who : who}`;
  }

  function resetWorld() {
    world = {
      rng: new Random(20260821),
      tick: 0,
      organisms: [],
      plants: [],
      food: [],
      messages: [],
      events: [],
      counters: {
        births: 0,
        deaths: 0,
        eaten: 0,
        messages: 0,
        eavesdrops: 0,
        queries: 0,
        interrupts: 0,
        rollouts: 0,
        knowledgeUpdates: 0,
        mutualism: 0,
        parasitism: 0,
        competition: 0,
        cooperation: 0,
      },
      ids: { bigfish: 0, smallfish: 0, shrimp: 0, snail: 0, cleaner: 0, louse: 0, plant: 0, food: 0 },
      sharedIntentions: { bigfish: {}, smallfish: {}, shrimp: {}, snail: {}, cleaner: {}, louse: {} },
      relLinks: [],
      script: { active: false, phase: 0, phaseStart: 0 },
      activeTech: "decsgts",
      glassShock: 0,
    };

    spawnPlants(INITIAL_COUNTS.plants);
    seedFood(INITIAL_COUNTS.food, "initial plankton field", false);
    [
      ["bigfish", INITIAL_COUNTS.bigfish],
      ["smallfish", INITIAL_COUNTS.smallfish],
      ["shrimp", INITIAL_COUNTS.shrimp],
      ["snail", INITIAL_COUNTS.snail],
      ["cleaner", INITIAL_COUNTS.cleaner],
      ["louse", INITIAL_COUNTS.louse],
    ].forEach(([species, count]) => {
      for (let i = 0; i < count; i += 1) {
        spawnOrganism(species);
      }
    });

    selectedId = world.organisms[0]?.id || "";
    logEvent("init", tr("生态缸重置：水草、虾米、螺、小鱼、清洁鱼、大鱼与鱼虱共处一缸", "Tank reset: plants, shrimp, snails, small fish, cleaner fish, big fish and lice share one tank"));
  }

  function spawnPlants(count) {
    for (let i = 0; i < count; i += 1) {
      const leftCluster = world.rng.next() < 0.58;
      const x = leftCluster ? world.rng.range(60, 390) : world.rng.range(790, 1050);
      world.plants.push({
        id: `P${++world.ids.plant}`,
        x,
        y: WORLD.floor - world.rng.range(8, 26),
        biomass: world.rng.range(34, 88),
        maxBiomass: world.rng.range(80, 128),
        growth: world.rng.range(0.035, 0.09),
        nutrients: world.rng.range(0, 14),
        sway: world.rng.range(0, Math.PI * 2),
      });
    }
  }

  function spawnOrganism(species, position = null, options = {}) {
    const spec = SPECIES[species];
    const id = `${spec.idPrefix}${++world.ids[species]}`;
    const x = position?.x ?? initialX(species);
    const y = position?.y ?? initialY(species);
    const organism = {
      id,
      species,
      label: `${spec.label}-${id}`,
      x,
      y,
      vx: world.rng.range(-0.6, 0.6),
      vy: world.rng.range(-0.35, 0.35),
      dir: world.rng.next() < 0.5 ? -1 : 1,
      energy: options.energy ?? world.rng.range(spec.maxEnergy * 0.62, spec.maxEnergy * 0.94),
      age: options.age ?? Math.floor(world.rng.range(spec.matureAge * 0.45, spec.matureAge + 160)),
      sex: world.rng.next() < 0.5 ? "F" : "M",
      birthCooldown: options.birthCooldown ?? Math.floor(world.rng.range(60, 180)),
      alive: true,
      deathReason: "",
      mailbox: [],
      buffer: [],
      knowledge: [],
      blackboard: {},
      emotion: { hunger: 0, fear: 0, curiosity: 0, social: 0 },
      weights: { plan: 1, risk: 1, time: 1 },
      action: { type: "idle", label: "idle", target: { x, y } },
      bt: createBt(),
      searchRows: [],
      searchTrace: null,
      subgoals: [],
      intention: {},
      lastBroadcast: {},
      lastDecision: -DECISION_PERIOD,
      selectedPulse: world.rng.range(0, Math.PI * 2),
      stuckTicks: 0,
      lastX: x,
      lastY: y,
      actionStarted: 0,
      // relationship state
      host: null,          // louse: id of the fish it is attached to
      parasiteLoad: 0,     // host: number of lice currently attached
      cleanCooldown: 0,    // cleaner: ticks until next parasite removal
      contestCooldown: 0,  // competition: ticks until it can contest again
      mobbedTicks: 0,      // predator: harassed by a defensive mob
      coopPulse: 0,        // render flash when cooperating
      relFlash: null,      // {type,f} transient relationship highlight
    };
    world.organisms.push(organism);
    return organism;
  }

  function initialX(species) {
    if (species === "bigfish") return world.rng.range(700, 1030);
    if (species === "smallfish") return world.rng.range(260, 760);
    if (species === "cleaner") return world.rng.range(400, 820);
    if (species === "louse") return world.rng.range(300, 900);
    return world.rng.range(80, 1000);
  }

  function initialY(species) {
    if (species === "bigfish") return world.rng.range(140, 420);
    if (species === "smallfish") return world.rng.range(115, 475);
    if (species === "cleaner") return world.rng.range(200, 480);
    if (species === "snail") return WORLD.floor - world.rng.range(8, 16);
    if (species === "louse") return world.rng.range(160, 470);
    return world.rng.range(430, 558);
  }

  function createBt() {
    return {
      "Root Selector": STATUS.idle,
      "Service: checkMailbox": STATUS.idle,
      "RH: Event Handler": STATUS.idle,
      "Critical Survival Sequence": STATUS.idle,
      "Emotional Selector": STATUS.idle,
      "Search Policy": STATUS.idle,
      "Tmod: Knowledge Transfer": STATUS.idle,
      "Lifecycle Sequence": STATUS.idle,
      "Action Manager": STATUS.idle,
    };
  }

  function loop(now) {
    const delta = Math.min(80, now - (lastFrame || now));
    lastFrame = now;
    if (running) {
      accumulator += delta * settings.speed;
      while (accumulator >= 54) {
        simulateStep();
        accumulator -= 54;
      }
    }
    draw();
    frameHandle = requestAnimationFrame(loop);
  }

  function toggleRun() {
    running = !running;
    ui.runToggle.textContent = running ? "Pause" : "Run";
    ui.runToggle.classList.toggle("primary", !running);
  }

  function switchTab(tab) {
    ui.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    ui.demoTab.classList.toggle("active", tab === "demo");
    ui.monitorTab.classList.toggle("active", tab === "monitor");
    renderAll();
    resizeCanvas();
    draw();
  }

  function setSegment(event, key) {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    settings[key] = button.dataset.value;
    event.currentTarget.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    world.activeTech = key === "search" ? settings.search : "ikt";
    world.organisms.forEach((organism) => {
      organism.searchRows = [];
      organism.searchTrace = null;
      organism.subgoals = [];
      organism.intention = {};
    });
    world.sharedIntentions = { bigfish: {}, smallfish: {}, shrimp: {} };
    renderAll();
  }

  function simulateStep() {
    world.tick += 1;
    world.relLinks = [];
    updateScript();
    updatePlants();
    updateFood();
    decayTransientState();

    const agents = world.organisms.filter((organism) => organism.alive);
    agents.forEach((agent) => updateLife(agent));
    agents.forEach((agent) => perceive(agent));
    agents.forEach((agent) => decide(agent));
    agents.forEach((agent) => executeAction(agent));
    agents.forEach((agent) => handleEating(agent));
    // ---- inter/intra-species relationship systems ----
    agents.forEach((agent) => handleParasitism(agent));
    agents.forEach((agent) => handleCleaning(agent));
    resolveContests(agents);
    handleCooperation(agents);
    handleMobbing(agents);
    if (settings.lifecycle) agents.forEach((agent) => handleReproduction(agent));
    cleanupDead();
    stabilizeEcosystem();

    if (world.tick % 5 === 0) renderAll();
  }

  function updatePlants() {
    world.plants.forEach((plant) => {
      const nutrientBoost = plant.nutrients > 0 ? 0.08 : 0;
      plant.biomass = clamp(plant.biomass + plant.growth + nutrientBoost, 0, plant.maxBiomass);
      plant.nutrients = Math.max(0, plant.nutrients - 0.05);
      plant.sway += 0.025;
    });
  }

  function updateFood() {
    world.food.forEach((food) => {
      food.y = Math.min(WORLD.floor - 18, food.y + food.vy);
      food.vy = clamp(food.vy + 0.008, 0.18, 0.85);
      food.ttl -= 1;
    });
    world.food = world.food.filter((food) => food.ttl > 0 && food.energy > 1);
  }

  function decayTransientState() {
    world.glassShock = Math.max(0, world.glassShock - 1);
    world.messages.forEach((message) => {
      message.ttl -= 1;
    });
    world.messages = world.messages.filter((message) => message.ttl > 0);

    world.organisms.forEach((agent) => {
      agent.mailbox = agent.mailbox
        .map((message) => ({ ...message, ttl: message.ttl - 1 }))
        .filter((message) => message.ttl > 0);
      agent.buffer = agent.buffer
        .map((message) => ({ ...message, ttl: message.ttl - 1 }))
        .filter((message) => message.ttl > 0);
      agent.knowledge = agent.knowledge
        .map((fact) => ({ ...fact, ttl: fact.ttl - 1 }))
        .filter((fact) => fact.ttl > 0);
      agent.birthCooldown = Math.max(0, agent.birthCooldown - 1);
      agent.cleanCooldown = Math.max(0, agent.cleanCooldown - 1);
      agent.contestCooldown = Math.max(0, agent.contestCooldown - 1);
      agent.mobbedTicks = Math.max(0, agent.mobbedTicks - 1);
      agent.coopPulse = Math.max(0, agent.coopPulse - 1);
      if (agent.relFlash) {
        agent.relFlash.f -= 1;
        if (agent.relFlash.f <= 0) agent.relFlash = null;
      }
    });
  }

  function updateLife(agent) {
    const spec = SPECIES[agent.species];
    agent.age += 1;
    const actionCost = agent.action.type === "flee" || agent.action.type === "hunt" ? 0.022 : 0.007;
    const parasiteBurden = agent.parasiteLoad * 0.022; // 寄生负荷持续消耗宿主能量
    agent.energy -= spec.metabolism + actionCost + Math.abs(agent.vx) * 0.0035 + parasiteBurden;
    agent.energy = clamp(agent.energy, -4, spec.maxEnergy);

    const nearbyPredators = findPredators(agent, spec.sense);
    const neighbors = findNeighbors(agent, agent.species, 120).length;
    agent.emotion.hunger = clamp(1 - agent.energy / spec.maxEnergy, 0, 1);
    agent.emotion.fear = clamp((nearbyPredators.length ? 0.62 : 0) + world.glassShock / 90 + (agent.mobbedTicks > 0 ? 0.5 : 0), 0, 1);
    agent.emotion.curiosity = clamp(0.55 - agent.emotion.fear * 0.34 + (agent.energy / spec.maxEnergy) * 0.22, 0.05, 0.92);
    agent.emotion.social = clamp(neighbors / 5 + (agent.birthCooldown === 0 ? 0.18 : 0), 0, 1);

    if (agent.energy <= 0) kill(agent, "starved");
    if (settings.lifecycle && agent.age > spec.maxAge) kill(agent, "aged");
  }

  function perceive(agent) {
    if (!agent.alive) return;
    const spec = SPECIES[agent.species];
    agent.blackboard = {
      tick: world.tick,
      energy: agent.energy,
      hunger: agent.emotion.hunger,
      fear: agent.emotion.fear,
      mailbox: agent.mailbox.length,
      buffer: agent.buffer.length,
      nearbyPredators: 0,
      nearbyPrey: 0,
      nearestFood: "none",
      nearestDanger: "none",
    };

    const predators = findPredators(agent, spec.sense);
    const prey = findPrey(agent, spec.sense);
    agent.blackboard.nearbyPredators = predators.length;
    agent.blackboard.nearbyPrey = prey.length;

    if (predators[0]) {
      const predator = predators[0];
      agent.blackboard.nearestDanger = predator.id;
      learn(agent, {
        kind: "danger",
        targetId: predator.id,
        species: predator.species,
        x: predator.x,
        y: predator.y,
        value: 1,
        source: "sight",
        ttl: 90,
      });
      maybeBroadcast(agent, "danger", predator, distance(agent, predator) < spec.sense * 0.48 ? "hard" : "soft");
    }

    if (prey[0]) {
      const target = prey[0];
      agent.blackboard.nearestFood = target.id;
      learn(agent, {
        kind: "food",
        targetId: target.id,
        species: target.species || target.kind,
        x: target.x,
        y: target.y,
        value: target.value || 1,
        source: "sight",
        ttl: 110,
      });
      maybeBroadcast(agent, "food", target, "soft");
    }
  }

  function decide(agent) {
    if (!agent.alive) return;
    const hasUrgentMail = settings.eventDriven && agent.mailbox.some((message) => message.priority === "hard");
    const targetMissing = agent.action?.targetId && !resolveTarget(agent.action.targetId, agent.action.targetKind);
    const target = currentActionTarget(agent);
    const actionAge = world.tick - agent.actionStarted;
    const arrived = target && actionAge >= MIN_ACTION_AGE && distance(agent, target) <= arrivalRadius(agent, agent.action);
    const actionExpired = world.tick - agent.actionStarted > MAX_ACTION_AGE;
    const stuck = agent.stuckTicks >= STUCK_LIMIT;
    if (!hasUrgentMail && !targetMissing && !arrived && !actionExpired && !stuck && world.tick - agent.lastDecision < DECISION_PERIOD) {
      return;
    }

    agent.bt = createBt();
    setBt(agent, "Root Selector", STATUS.running);
    setBt(agent, "Service: checkMailbox", settings.eventDriven ? STATUS.running : STATUS.failure);
    setBt(agent, "Lifecycle Sequence", settings.lifecycle ? STATUS.running : STATUS.idle);

    const urgent = processMailbox(agent);
    runKnowledgeTransfer(agent);

    const candidates = buildCandidates(agent, urgent);
    const chosen = urgent || chooseCandidate(agent, candidates);
    agent.action = chosen || { type: "idle", label: "idle", target: wanderTarget(agent) };
    agent.actionStarted = world.tick;
    agent.stuckTicks = 0;
    setBt(agent, "Action Manager", agent.action.type === "idle" ? STATUS.failure : STATUS.running);
    agent.lastDecision = world.tick;
  }

  function processMailbox(agent) {
    if (!settings.eventDriven) {
      setBt(agent, "RH: Event Handler", STATUS.failure);
      return null;
    }

    const messages = [...agent.mailbox].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
    if (!messages.length) {
      setBt(agent, "RH: Event Handler", STATUS.failure);
      return null;
    }

    setBt(agent, "RH: Event Handler", STATUS.running);
    for (const message of messages) {
      learn(agent, message.fact);
      if (message.kind === "danger" && message.priority === "hard") {
        const threatDistance = message.fact.targetId === "glass-shock" ? 0 : distance(agent, message.fact);
        const interruptRange = SPECIES[agent.species].sense * 0.5;
        const alreadyEscaping = agent.action.type === "flee" || agent.action.type === "hide";
        const recentlyEscaped = alreadyEscaping && world.tick - agent.actionStarted < 30;
        if (recentlyEscaped && message.fact.targetId !== "glass-shock") {
          agent.mailbox = agent.mailbox.filter((item) => item.id !== message.id);
          continue;
        }
        if (threatDistance > interruptRange && agent.emotion.fear < 0.72) {
          agent.mailbox = agent.mailbox.filter((item) => item.id !== message.id);
          continue;
        }
        const target = fleeTarget(agent, message.fact);
        world.counters.interrupts += 1;
        world.activeTech = "edbt";
        logEvent("RH", tr(`${agent.id} 被 ${message.from} 的 HRS danger 抢占，转入逃逸`, `${agent.id} preempted by HRS danger from ${message.from}, switching to flee`));
        agent.mailbox = agent.mailbox.filter((item) => item.id !== message.id);
        setBt(agent, "Critical Survival Sequence", STATUS.running);
        return {
          type: "flee",
          label: `HRS flee from ${message.fact.targetId}`,
          target,
          priority: 100,
          source: "mailbox",
        };
      }
    }
    agent.mailbox = [];
    return null;
  }

  function runKnowledgeTransfer(agent) {
    setBt(agent, "Tmod: Knowledge Transfer", STATUS.running);
    const hasFood = agent.knowledge.some((fact) => fact.kind === "food");
    const hasDanger = agent.knowledge.some((fact) => fact.kind === "danger");

    if (settings.comm === "ebu" && (!hasFood || !hasDanger) && agent.buffer.length) {
      const merged = mergeBufferedKnowledge(agent);
      if (merged) {
        world.activeTech = "ikt";
        logEvent("EBU", tr(`${agent.id} 按需合并 ${merged} 条缓存知识`, `${agent.id} merges ${merged} buffered facts on demand`));
      }
    }

    if (settings.comm === "qra" && !hasFood && world.tick % 24 === 0) {
      directQuery(agent, false);
    }

    if (settings.comm === "qru" && (!hasFood || !hasDanger) && world.tick % 28 === 0) {
      directQuery(agent, true);
    }
  }

  function buildCandidates(agent, urgent) {
    if (urgent) return [urgent];
    const spec = SPECIES[agent.species];
    const candidates = [];

    // ---- parasite: free-swimming louse seeks a fish host to infest ----
    if (spec.parasite && !agent.host) {
      const host = nearestHost(agent, spec.sense * 1.4);
      if (host) {
        candidates.push({
          type: "infest",
          label: tr(`寄生 ${host.id}`, `Infest ${host.id}`),
          target: host,
          targetId: host.id,
          reward: 22,
          risk: 0.1,
          priority: 60,
        });
      }
    }

    // ---- cleaner: seek a parasitized host to service (mutualism) ----
    if (spec.cleaner) {
      const client = nearestParasitizedHost(agent, spec.sense * 1.5);
      if (client) {
        candidates.push({
          type: "clean",
          label: tr(`清洁 ${client.id}`, `Clean ${client.id}`),
          target: client,
          targetId: client.id,
          reward: 16 + client.parasiteLoad * 3,
          risk: 0.08,
          priority: 46,
        });
      }
    }

    // ---- host with parasites seeks the nearest cleaning station ----
    if (agent.parasiteLoad > 0 && HOST_SPECIES.includes(agent.species)) {
      const cleaner = nearestCleaner(agent, spec.sense * 1.6);
      if (cleaner) {
        candidates.push({
          type: "seek-cleaner",
          label: tr(`前往清洁站 ${cleaner.id}`, `Visit cleaning station ${cleaner.id}`),
          target: cleaner,
          targetId: cleaner.id,
          reward: 10 + agent.parasiteLoad * 2.5,
          risk: 0.12,
          priority: 30 + agent.parasiteLoad * 2,
        });
      }
    }

    const dangerFacts = factsByKind(agent, "danger");
    const predator = findPredators(agent, spec.sense * 0.9)[0];
    if (predator || dangerFacts[0]) {
      const source = predator || dangerFacts[0];
      candidates.push({
        type: "flee",
        label: tr(`逃离 ${source.id || source.targetId}`, `Flee ${source.id || source.targetId}`),
        target: fleeTarget(agent, source),
        reward: 18,
        risk: 0.08,
        priority: 90,
      });
      candidates.push({
        type: "hide",
        label: tr("进入岩洞安全区", "Hide in cave shelter"),
        target: zoneCenter("cave"),
        reward: 13,
        risk: 0.12,
        priority: 76,
      });
    }

    const prey = findPrey(agent, spec.sense * 1.15);
    prey.slice(0, 4).forEach((target) => {
      const action = target.kind === "plant" ? "graze" : target.kind === "food" ? "feed" : "hunt";
      candidates.push({
        type: action,
        label: `${actionLabel(action)} ${target.id}`,
        target,
        targetId: target.id,
        targetKind: target.kind || target.species,
        reward: foodValue(agent, target),
        risk: localRisk(agent, target),
        priority: action === "hunt" ? 42 : 34,
      });
    });

    factsByKind(agent, "food").slice(0, 3).forEach((fact) => {
      if (!candidates.some((candidate) => candidate.targetId === fact.targetId)) {
        candidates.push({
          type: "seek-known-food",
          label: tr(`追踪已知食物 ${fact.targetId}`, `Track known food ${fact.targetId}`),
          target: { x: fact.x, y: fact.y, id: fact.targetId },
          targetId: fact.targetId,
          targetKind: fact.species,
          reward: fact.value * 10,
          risk: localRisk(agent, fact),
          priority: 28,
        });
      }
    });

    const mate = findMate(agent);
    if (settings.lifecycle && mate && agent.energy > spec.spawnEnergy && agent.birthCooldown === 0) {
      candidates.push({
        type: "mate",
        label: tr(`靠近配偶 ${mate.id}`, `Approach mate ${mate.id}`),
        target: mate,
        targetId: mate.id,
        reward: 16,
        risk: localRisk(agent, mate) + 0.18,
        priority: 31,
      });
    }

    if (agent.species === "smallfish" || agent.species === "shrimp") {
      const school = schoolTarget(agent);
      candidates.push({
        type: "school",
        label: tr("靠近同伴形成群体", "School with peers"),
        target: school,
        reward: 7 + agent.emotion.fear * 7,
        risk: 0.26,
        priority: 20,
      });
    }

    candidates.push({
      type: "patrol",
      label: tr("巡游子目标区", "Patrol subgoal zone"),
      target: choosePatrolZone(agent),
      reward: 4 + agent.emotion.curiosity * 6,
      risk: 0.34,
      priority: 12,
    });

    candidates.push({
      type: "rest",
      label: tr("低耗能漂浮", "Low-energy drift"),
      target: { x: agent.x + agent.dir * 30, y: agent.y + Math.sin(world.tick / 20) * 12 },
      reward: 2,
      risk: 0.22,
      priority: 4,
    });
    return candidates;
  }

  function chooseCandidate(agent, candidates) {
    setBt(agent, "Emotional Selector", settings.emotion ? STATUS.running : STATUS.idle);
    setBt(agent, "Search Policy", STATUS.running);
    if (!candidates.length) return null;

    if (settings.search === "mcts") return runMcts(agent, candidates, false);
    if (settings.search === "decmcts") return runMcts(agent, candidates, true);
    if (settings.search === "decsgts") return runDecSgts(agent, candidates);

    let best = candidates[0];
    let bestScore = -Infinity;
    candidates.forEach((candidate) => {
      const score = scoreCandidate(agent, candidate).score;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    agent.weights = scoreCandidate(agent, best).weights;
    agent.searchRows = candidates.map((candidate) => ({
      label: candidate.label,
      visits: 1,
      value: scoreCandidate(agent, candidate).score,
    }));
    world.activeTech = "bt";
    return best;
  }

  function scoreCandidate(agent, candidate) {
    const spec = SPECIES[agent.species];
    const distanceCost = distance(agent, candidate.target) / spec.speed;
    const zone = nearestZone(candidate.target);
    const risk = candidate.risk + (zone?.risk || 0.3) + predatorRiskAt(agent, candidate.target);
    const conflict = intentionConflict(agent, candidate);
    const weights = emotionWeights(agent, candidate, risk, distanceCost);
    let score = candidate.reward + candidate.priority * 0.08 - distanceCost * 0.05 - risk * 9 - conflict;
    if (settings.emotion) {
      score += weights.plan * 2.2 - weights.risk * 2.4 + weights.time * 2;
      if (candidate.type === "flee" || candidate.type === "hide") score += agent.emotion.fear * 16;
      if (candidate.type === "hunt" || candidate.type === "graze" || candidate.type === "feed") score += agent.emotion.hunger * 18;
      if (candidate.type === "mate") score += agent.emotion.social * 7;
      if (candidate.type === "patrol") score += agent.emotion.curiosity * 5;
    }
    return { score, risk, distanceCost, conflict, weights };
  }

  function emotionWeights(agent, candidate, risk, distanceCost) {
    const e = agent.emotion;
    const positive = e.curiosity + e.social * 0.8;
    const negative = e.fear * 0.95 + e.hunger * 0.22;
    const ePlan = positive - negative;
    const eRisk = e.curiosity * 0.35 + e.hunger * 0.52 - e.fear * 1.15;
    const eTime = e.hunger * 0.85 + e.fear * 0.5 - e.social * 0.25;
    const basePlan = candidate.type === "patrol" || candidate.type === "mate" ? 0.72 : 0.55;
    return {
      plan: clamp(basePlan * (1 + 0.5 * ePlan), 0.05, 1.8),
      risk: clamp(risk * (1 - 0.42 * eRisk), 0.03, 2.4),
      time: clamp(1 / (1 + 0.02 * distanceCost * (1 + eTime)), 0.05, 1.4),
      ePlan,
      eRisk,
      eTime,
    };
  }

  function runMcts(agent, candidates, decentralized) {
    const stats = new Map(candidates.map((candidate) => [candidate.label, { candidate, visits: 0, value: 0 }]));
    let trace = null;
    const iterations = 12 + Math.floor(agent.emotion.curiosity * 8);
    for (let i = 0; i < iterations; i += 1) {
      const totalVisits = [...stats.values()].reduce((sum, item) => sum + item.visits, 0) + 1;
      const selected = selectUct([...stats.values()], totalVisits);
      const rollout = rolloutValue(agent, selected.candidate, decentralized);
      selected.visits += 1;
      selected.value += rollout;
      world.counters.rollouts += 1;
      trace = {
        phase: "selection -> expansion -> rollout -> backpropagation",
        selected: selected.candidate.label,
        rollout: rollout.toFixed(2),
        visits: selected.visits,
      };
    }

    const rows = [...stats.values()]
      .map((item) => ({
        label: item.candidate.label,
        visits: item.visits,
        value: item.visits ? item.value / item.visits : -999,
        candidate: item.candidate,
      }))
      .sort((a, b) => b.value - a.value);

    agent.searchRows = rows;
    agent.searchTrace = trace;
    const best = rows[0].candidate;
    agent.weights = scoreCandidate(agent, best).weights;
    if (decentralized) {
      publishIntentions(agent, rows);
      world.activeTech = "decmcts";
    } else {
      world.activeTech = "mcts";
    }
    return best;
  }

  function selectUct(rows, totalVisits) {
    const unvisited = rows.find((row) => row.visits === 0);
    if (unvisited) return unvisited;
    let best = rows[0];
    let bestScore = -Infinity;
    rows.forEach((row) => {
      const avg = row.visits ? row.value / row.visits : 0;
      const explore = Math.sqrt(Math.log(totalVisits + 1) / (row.visits + 1));
      const value = avg + 1.28 * explore;
      if (value > bestScore) {
        best = row;
        bestScore = value;
      }
    });
    return best;
  }

  function rolloutValue(agent, candidate, decentralized) {
    const base = scoreCandidate(agent, candidate).score;
    const futureEnergy = candidate.type === "hunt" || candidate.type === "graze" || candidate.type === "feed" ? 8 : 0;
    const survival = candidate.type === "flee" || candidate.type === "hide" ? agent.emotion.fear * 10 : 0;
    const randomOutcome = (world.rng.next() - 0.5) * 4.2;
    const decPenalty = decentralized ? intentionConflict(agent, candidate) * 0.8 : 0;
    return base + futureEnergy + survival + randomOutcome - decPenalty;
  }

  function runDecSgts(agent, candidates) {
    const plans = candidates.map((candidate) => makeSubgoalPlan(agent, candidate));
    const stats = new Map(plans.map((plan) => [plan.id, { plan, visits: 0, value: 0 }]));
    let trace = null;
    for (let i = 0; i < 14; i += 1) {
      const totalVisits = [...stats.values()].reduce((sum, item) => sum + item.visits, 0) + 1;
      const chosen = selectDuct([...stats.values()], totalVisits);
      const score = scoreCandidate(agent, chosen.plan.candidate).score;
      const value = score / (1 + chosen.plan.pairCost * 0.006) + (world.rng.next() - 0.5) * 2;
      chosen.visits += 1;
      chosen.value += value;
      world.counters.rollouts += 1;
      trace = {
        phase: "subgoal predicate -> pair evaluation -> D-UCT -> intention update",
        route: chosen.plan.subgoals.map((zone) => zone.label).join(" / "),
        pairCost: chosen.plan.pairCost.toFixed(1),
        visits: chosen.visits,
      };
    }

    const rows = [...stats.values()]
      .map((item) => ({
        label: item.plan.label,
        visits: item.visits,
        value: item.visits ? item.value / item.visits : -999,
        candidate: item.plan.candidate,
        plan: item.plan,
      }))
      .sort((a, b) => b.value - a.value);

    const best = rows[0];
    agent.subgoals = best.plan.subgoals;
    agent.searchRows = rows;
    agent.searchTrace = trace;
    agent.weights = scoreCandidate(agent, best.candidate).weights;
    publishIntentions(agent, rows);
    world.activeTech = "decsgts";
    return best.candidate;
  }

  function selectDuct(rows, totalVisits) {
    const unvisited = rows.find((row) => row.visits === 0);
    if (unvisited) return unvisited;
    let best = rows[0];
    let bestValue = -Infinity;
    rows.forEach((row) => {
      const avg = row.visits ? row.value / row.visits : 0;
      const explore = Math.sqrt(Math.log(totalVisits + 1) / (row.visits + 1));
      const duct = avg + 1.06 * explore - row.plan.pairCost * 0.01;
      if (duct > bestValue) {
        best = row;
        bestValue = duct;
      }
    });
    return best;
  }

  function makeSubgoalPlan(agent, candidate) {
    const startZone = nearestZone(agent);
    const targetZone = nearestZone(candidate.target);
    const subgoals = [];
    if (startZone) subgoals.push(startZone);
    if (targetZone && targetZone.id !== startZone?.id) subgoals.push(targetZone);
    if ((candidate.type === "flee" || candidate.type === "hide") && !subgoals.some((zone) => zone.id === "cave")) {
      subgoals.push(zoneById("cave"));
    }
    const route = subgoals.filter(Boolean);
    let pairCost = 0;
    let cursor = agent;
    route.forEach((zone) => {
      const center = zoneCenter(zone.id);
      pairCost += distance(cursor, center);
      cursor = center;
    });
    pairCost += distance(cursor, candidate.target);
    return {
      id: `${candidate.label}:${route.map((zone) => zone.id).join(">")}`,
      label: `${candidate.label} via ${route.map((zone) => zone.label).join(" -> ") || "direct"}`,
      candidate,
      subgoals: route,
      pairCost,
    };
  }

  function publishIntentions(agent, rows) {
    const top = rows.slice(0, 4);
    const max = Math.max(...top.map((row) => row.value));
    const exp = top.map((row) => Math.exp(row.value - max));
    const sum = exp.reduce((acc, value) => acc + value, 0) || 1;
    const dist = {};
    top.forEach((row, index) => {
      const key = row.candidate.targetId || row.candidate.type;
      dist[key] = exp[index] / sum;
    });
    agent.intention = dist;
    world.sharedIntentions[agent.species][agent.id] = dist;
  }

  function executeAction(agent) {
    if (!agent.alive) return;
    // attached louse rides its host — no independent swimming
    if (SPECIES[agent.species].parasite && agent.host) {
      const host = getAgent(agent.host);
      if (host && host.alive) {
        const hv = host.__vis || host;
        const off = agent.__rideOff || (agent.__rideOff = { a: world.rng.range(0, 6.28), r: SPECIES[host.species].size * 0.5 });
        off.a += 0.02;
        agent.x = host.x + Math.cos(off.a) * off.r;
        agent.y = host.y + Math.sin(off.a) * off.r * 0.6 - SPECIES[host.species].size * 0.2;
        agent.vx = host.vx;
        agent.vy = host.vy;
        agent.dir = host.dir;
        return;
      }
      agent.host = null; // host gone — detach
    }

    const target = currentActionTarget(agent) || wanderTarget(agent);
    const spec = SPECIES[agent.species];
    const speedFactor = actionSpeedFactor(agent.action.type);
    const toX = target.x - agent.x;
    const toY = target.y - agent.y;
    const targetDist = Math.hypot(toX, toY);
    const desired = normalize(toX, toY);
    // arrival: ramp the seek force to zero as the agent reaches its target so
    // it decelerates and settles instead of overshooting and bobbing in place.
    const arriveR = arrivalRadius(agent, agent.action);
    const arrive = targetDist < arriveR ? clamp(targetDist / arriveR, 0, 1) : 1;
    const school = schoolingVector(agent);
    const speed = spec.speed * speedFactor * (0.72 + (agent.energy / spec.maxEnergy) * 0.34);
    const beforeX = agent.x;
    const beforeY = agent.y;
    agent.vx = lerp(agent.vx, (desired.x * arrive + school.x * spec.schooling * arrive) * speed, 0.12);
    agent.vy = lerp(agent.vy, (desired.y * arrive + school.y * spec.schooling * arrive) * speed, 0.12);
    agent.x += agent.vx;
    agent.y += agent.vy;
    agent.dir = agent.vx >= 0 ? 1 : -1;
    constrainAgent(agent);
    // benthic crawlers (snails) stay pinned to the substrate
    if (spec.benthic) {
      agent.y = WORLD.floor - spec.size * 0.5;
      agent.vy = 0;
    }
    updateStuckState(agent, beforeX, beforeY, target);
  }

  function actionSpeedFactor(actionType) {
    if (actionType === "flee") return 1.32;
    if (actionType === "hunt") return 1.18;
    if (actionType === "feed" || actionType === "graze") return 1.06;
    if (actionType === "rest") return 0.42;
    return 1;
  }

  function currentActionTarget(agent) {
    if (!agent.action) return null;
    if (agent.action.targetId) {
      const liveTarget = resolveTarget(agent.action.targetId, agent.action.targetKind);
      if (liveTarget) return liveTarget;
    }
    return agent.action.target || null;
  }

  function arrivalRadius(agent, action) {
    const spec = SPECIES[agent.species];
    if (!action) return spec.size;
    if (action.type === "hunt" || action.type === "graze" || action.type === "feed" || action.type === "seek-known-food") {
      return spec.size + 12;
    }
    if (action.type === "infest" || action.type === "clean" || action.type === "seek-cleaner") {
      return spec.size + 16;
    }
    if (action.type === "mate") return spec.size * 2.1;
    if (action.type === "flee" || action.type === "hide") return 28;
    return 22;
  }

  function updateStuckState(agent, beforeX, beforeY, target) {
    const moved = Math.hypot(agent.x - beforeX, agent.y - beforeY);
    const targetDistance = distance(agent, target);
    if (moved < 0.08 && targetDistance > arrivalRadius(agent, agent.action) + 16) {
      agent.stuckTicks += 1;
    } else {
      agent.stuckTicks = Math.max(0, agent.stuckTicks - 2);
    }

    if (agent.stuckTicks >= STUCK_LIMIT) {
      const escape = wanderTarget(agent);
      agent.vx += world.rng.range(-2.4, 2.4);
      agent.vy += world.rng.range(-1.8, 1.8);
      agent.action = {
        type: "patrol",
        label: "stuck recovery",
        target: escape,
        reward: 0,
        risk: 0.2,
        priority: 0,
      };
      agent.actionStarted = world.tick;
      agent.lastDecision = world.tick - DECISION_PERIOD;
      agent.stuckTicks = 0;
      logEvent("replan", `${agent.id} stuck recovery -> new patrol target`);
    }

    agent.lastX = agent.x;
    agent.lastY = agent.y;
  }

  function handleEating(agent) {
    if (!agent.alive) return;
    const action = agent.action.type;
    if (!["hunt", "graze", "feed", "seek-known-food"].includes(action)) return;
    const spec = SPECIES[agent.species];
    const target = resolveTarget(agent.action.targetId, agent.action.targetKind);
    if (!target) return;
    const hitRange = spec.size + (target.size || 8) + 5;
    if (distance(agent, target) > hitRange) return;

    if (target.kind === "plant") {
      const bite = Math.min(10, target.biomass);
      target.biomass -= bite;
      agent.energy = clamp(agent.energy + bite * 0.42, 0, spec.maxEnergy);
      logEvent("graze", tr(`${agent.id} 啃食水草，能量 +${(bite * 0.42).toFixed(1)}`, `${agent.id} grazes plants, energy +${(bite * 0.42).toFixed(1)}`));
      return;
    }

    if (target.kind === "food") {
      const bite = Math.min(9, target.energy);
      target.energy -= bite;
      agent.energy = clamp(agent.energy + bite, 0, spec.maxEnergy);
      logEvent("feed", tr(`${agent.id} 吃到浮游食物`, `${agent.id} eats plankton food`));
      return;
    }

    if (target.alive && SPECIES[agent.species].prey.includes(target.species) && !shouldSparePrey(agent, target)) {
      kill(target, `eaten by ${agent.id}`);
      let gain = SPECIES[target.species].calories;
      // 合作捕食：附近锁定同一猎物的同种伙伴共享收益，围猎效率更高
      const partners = world.organisms.filter((o) =>
        o.alive && o.id !== agent.id && o.species === agent.species &&
        o.action && o.action.targetId === target.id && distance(agent, o) < 200);
      if (partners.length) {
        gain *= 1.25;
        partners.forEach((p) => {
          p.energy = clamp(p.energy + SPECIES[target.species].calories * 0.5, 0, SPECIES[p.species].maxEnergy);
          p.coopPulse = 14;
          addRelLink(agent, p, "cooperation");
        });
        agent.coopPulse = 14;
        world.counters.cooperation += 1;
        logEvent("cooperate", tr(`${agent.id} 与 ${partners.length} 个同伴合作围猎 ${target.id}，共享收益`, `${agent.id} hunts ${target.id} with ${partners.length} partners, sharing the gain`));
      }
      agent.energy = clamp(agent.energy + gain, 0, spec.maxEnergy);
      world.counters.eaten += 1;
      maybeBroadcast(agent, "food", target, "soft");
      logEvent("predation", tr(`${agent.id} 捕食 ${target.id}`, `${agent.id} preys on ${target.id}`));
    }
  }

  function handleReproduction(agent) {
    if (!agent.alive) return;
    const spec = SPECIES[agent.species];
    if (spec.parasite) return; // parasites reproduce on their host (handleParasitism)
    if (countSpecies(agent.species) >= spec.birthLimit) return;
    if (agent.age < spec.matureAge || agent.energy < spec.spawnEnergy || agent.birthCooldown > 0) return;
    const mate = findMate(agent);
    if (!mate || distance(agent, mate) > spec.size * 2.2) return;
    if (mate.energy < spec.spawnEnergy * 0.82 || mate.birthCooldown > 0) return;

    const child = spawnOrganism(agent.species, {
      x: clamp((agent.x + mate.x) / 2 + world.rng.range(-12, 12), SAFE_MARGIN, WORLD.width - SAFE_MARGIN),
      y: clamp((agent.y + mate.y) / 2 + world.rng.range(-10, 10), WORLD.waterTop + 30, WORLD.floor - 20),
    }, { age: 0, energy: spec.maxEnergy * 0.52, birthCooldown: 220 });
    agent.energy *= 0.78;
    mate.energy *= 0.8;
    agent.birthCooldown = 280;
    mate.birthCooldown = 280;
    world.counters.births += 1;
    world.activeTech = "life";
    pushFx({ type: 'birth', f: 0, x: child.x, y: child.y, species: agent.species, label: child.id, seed: Math.random() * 6.28 });
    logEvent("birth", tr(`${agent.id} 和 ${mate.id} 繁殖，${child.id} 出生`, `${agent.id} and ${mate.id} reproduce; ${child.id} is born`));
  }

  function kill(agent, reason) {
    if (!agent.alive) return;
    agent.alive = false;
    agent.deathReason = reason;
    // detaching parasite frees its host of one unit of load
    if (agent.species === "louse" && agent.host) {
      const host = getAgent(agent.host);
      if (host) host.parasiteLoad = Math.max(0, host.parasiteLoad - 1);
      agent.host = null;
    }
    world.counters.deaths += 1;
    const dv = agent.__vis || agent;
    pushFx({
      type: 'death', f: 0,
      x: dv.x, y: dv.y,
      species: agent.species,
      predation: /eaten/.test(reason),
      seed: Math.random() * 6.28,
    });
    nearestPlants(agent, 3).forEach((plant) => {
      plant.nutrients += SPECIES[agent.species].calories * 0.12;
    });
    world.activeTech = "life";
  }

  function cleanupDead() {
    world.organisms = world.organisms.filter((agent) => agent.alive || world.tick - agent.lastDecision < 40);
    if (!getAgent(selectedId)?.alive) {
      selectedId = world.organisms.find((agent) => agent.alive)?.id || "";
    }
  }

  function stabilizeEcosystem() {
    if (!settings.lifecycle) return;

    if (world.tick % 120 === 0 && totalPlantBiomass() < 5200) {
      spawnPlants(6);
      logEvent("eco", "producer biomass regrowth");
    }

    if (world.tick % 90 === 0 && world.food.length < 24) {
      seedFood(10, "plankton pulse");
    }

    // keep the parasite loop alive so the 寄生/共生 story stays visible
    if (world.tick % 150 === 0 && countSpecies("louse") === 0) {
      for (let i = 0; i < 3; i += 1) {
        spawnOrganism("louse", { x: world.rng.range(300, 900), y: world.rng.range(180, 460) }, { age: 0, energy: SPECIES.louse.maxEnergy * 0.6 });
      }
      logEvent("eco", tr("水体重新引入鱼虱幼体，寄生压力回归", "Louse larvae reintroduced; parasite pressure returns"));
    }

    if (world.tick % 90 !== 0) return;
    Object.entries(ECO_VISIBLE_TARGETS).forEach(([species, target]) => {
      const count = countSpecies(species);
      if (count >= target) return;
      const minimum = ECO_MINIMUMS[species];
      const pulseCap = count < minimum ? RECRUITMENT_PACE[species] + 1 : RECRUITMENT_PACE[species];
      const needed = Math.min(target - count, pulseCap);
      for (let i = 0; i < needed; i += 1) {
        const spec = SPECIES[species];
        const agent = spawnOrganism(species, nurseryPosition(species), {
          age: Math.floor(spec.matureAge * world.rng.range(0.55, 0.95)),
          energy: spec.maxEnergy * world.rng.range(0.76, 0.92),
          birthCooldown: Math.floor(world.rng.range(60, 160)),
        });
        logEvent("eco", `${agent.id} nursery recruitment keeps the trophic layer visible`);
      }
    });
  }

  function seedFood(count, reason, log = true) {
    for (let i = 0; i < count; i += 1) {
      world.food.push({
        id: `D${++world.ids.food}`,
        kind: "food",
        x: world.rng.range(210, 940),
        y: WORLD.waterTop + world.rng.range(12, 64),
        energy: world.rng.range(9, 17),
        value: 1.2,
        vy: world.rng.range(0.1, 0.28),
        ttl: 620,
      });
    }
    if (log) logEvent("eco", reason);
  }

  function nurseryPosition(species) {
    if (species === "bigfish") {
      return { x: world.rng.range(780, 1040), y: world.rng.range(150, 390) };
    }
    if (species === "smallfish") {
      return { x: world.rng.range(780, 1020), y: world.rng.range(390, 520) };
    }
    if (species === "cleaner") {
      return { x: world.rng.range(420, 800), y: world.rng.range(220, 460) };
    }
    if (species === "snail") {
      return { x: world.rng.range(120, 380), y: WORLD.floor - world.rng.range(8, 16) };
    }
    return { x: world.rng.range(120, 360), y: world.rng.range(470, 555) };
  }

  function totalPlantBiomass() {
    return world.plants.reduce((sum, plant) => sum + plant.biomass, 0);
  }

  function maybeBroadcast(agent, kind, target, priority) {
    if (!settings.eventDriven && !usesIndirectCommunication()) return;
    const key = `${kind}:${target.id || target.targetId}`;
    if (world.tick - (agent.lastBroadcast[key] || -999) < 42) return;
    agent.lastBroadcast[key] = world.tick;
    const fact = {
      kind,
      targetId: target.id || target.targetId,
      species: target.species || target.kind,
      x: target.x,
      y: target.y,
      value: kind === "danger" ? 1 : foodValue(agent, target) / 10,
      source: `${priority === "hard" ? "HRS" : "SRS"}:${agent.id}`,
      ttl: kind === "danger" ? 95 : 120,
    };
    broadcast(agent, kind, fact, priority);
  }

  function broadcast(agent, kind, fact, priority) {
    const visualTargets = [];
    world.organisms.forEach((other) => {
      if (!other.alive || other.id === agent.id) return;
      if (distance(agent, other) > settings.commRange) return;
      const sameSpecies = other.species === agent.species;
      const message = {
        id: `${world.tick}:${agent.id}:${other.id}:${kind}:${world.counters.messages}`,
        from: agent.id,
        to: other.id,
        kind,
        priority,
        fact,
        acl: `${priority === "hard" ? "request" : "inform"}(${kind}, ${fact.targetId})`,
        ttl: priority === "hard" ? 58 : 78,
        start: { x: agent.x, y: agent.y },
        end: { x: other.x, y: other.y },
      };
      if (settings.eventDriven && sameSpecies) other.mailbox.push(message);
      if (usesIndirectCommunication()) eavesdrop(other, message);
      if (sameSpecies || usesIndirectCommunication()) visualTargets.push(message);
    });

    world.messages.push(...visualTargets.slice(0, 9));
    world.counters.messages += visualTargets.length;
    if (visualTargets.length) {
      world.activeTech = priority === "hard" ? "edbt" : "ikt";
    }
  }

  function eavesdrop(agent, message) {
    if (agent.id === message.from) return;
    world.counters.eavesdrops += 1;
    if (settings.comm === "eu") {
      learn(agent, { ...message.fact, source: `EU:${message.from}` });
    } else if (settings.comm === "ebu") {
      const exists = agent.buffer.some((item) => item.id === message.id);
      if (!exists) agent.buffer.push({ ...message, ttl: Math.max(70, message.ttl) });
    }
  }

  function mergeBufferedKnowledge(agent) {
    let count = 0;
    agent.buffer.forEach((message) => {
      if (learn(agent, { ...message.fact, source: `EBU:${message.from}` })) count += 1;
    });
    agent.buffer = [];
    return count;
  }

  function directQuery(agent, update) {
    const peers = world.organisms.filter((other) => {
      return other.alive && other.id !== agent.id && other.species === agent.species && distance(agent, other) <= settings.commRange;
    });
    if (!peers.length) return;
    const peer = peers.sort((a, b) => distance(agent, a) - distance(agent, b))[0];
    world.counters.queries += 1;
    world.counters.messages += 1;
    world.messages.push({
      id: `${world.tick}:query:${agent.id}:${peer.id}`,
      from: agent.id,
      to: peer.id,
      kind: update ? "QRU" : "QRA",
      priority: "soft",
      fact: { kind: "query", targetId: "knowledge", x: peer.x, y: peer.y, source: agent.id, ttl: 30 },
      acl: `${update ? "query-update" : "query-response"}(${agent.id}, ${peer.id})`,
      ttl: 44,
      start: { x: agent.x, y: agent.y },
      end: { x: peer.x, y: peer.y },
    });

    if (update) {
      peer.knowledge.slice(-5).forEach((fact) => learn(agent, { ...fact, source: `QRU:${peer.id}`, ttl: 90 }));
      logEvent("QRU", tr(`${agent.id} 从 ${peer.id} 直接更新知识`, `${agent.id} updates knowledge directly from ${peer.id}`));
    } else {
      const fact = peer.knowledge.find((item) => item.kind === "food");
      if (fact) {
        learn(agent, { ...fact, source: `QRA:${peer.id}`, ttl: 70 });
        logEvent("QRA", tr(`${agent.id} 查询 ${peer.id} 后得到 ${fact.targetId}`, `${agent.id} queries ${peer.id} and learns ${fact.targetId}`));
      }
    }
    world.activeTech = "ikt";
  }

  function learn(agent, fact) {
    if (!fact || !fact.kind || !fact.targetId) return false;
    const existing = agent.knowledge.find((item) => item.kind === fact.kind && item.targetId === fact.targetId);
    if (existing) {
      existing.x = fact.x;
      existing.y = fact.y;
      existing.ttl = Math.max(existing.ttl, fact.ttl || 60);
      existing.source = fact.source || existing.source;
      return false;
    }
    agent.knowledge.push({ ...fact, ttl: fact.ttl || 70 });
    if (agent.knowledge.length > 16) agent.knowledge.shift();
    world.counters.knowledgeUpdates += 1;
    return true;
  }

  function handleIntervention(action) {
    if (action === "feed") {
      for (let i = 0; i < 8; i += 1) {
        world.food.push({
          id: `D${++world.ids.food}`,
          kind: "food",
          x: world.rng.range(280, 900),
          y: WORLD.waterTop + world.rng.range(8, 38),
          energy: world.rng.range(8, 18),
          value: 1.2,
          vy: world.rng.range(0.12, 0.32),
          ttl: 520,
        });
      }
      logEvent("intervene", tr("投喂浮游食物，水面形成食物事件", "Plankton dropped; food events form at the surface"));
    }
    if (action === "plant") {
      spawnPlants(6);
      logEvent("intervene", tr("新增水草床，虾米会把它写入食物知识", "New plant bed added; shrimp will record it as food knowledge"));
    }
    if (action === "shrimp") spawnAndLog("shrimp");
    if (action === "snail") spawnAndLog("snail");
    if (action === "cleaner") spawnAndLog("cleaner");
    if (action === "smallfish") spawnAndLog("smallfish");
    if (action === "bigfish") spawnAndLog("bigfish", { energy: SPECIES.bigfish.maxEnergy * 0.35 });
    if (action === "louse") {
      for (let i = 0; i < 5; i += 1) {
        spawnOrganism("louse", { x: world.rng.range(300, 900), y: world.rng.range(160, 470) }, { age: 0, energy: SPECIES.louse.maxEnergy * 0.7 });
      }
      logEvent("intervene", tr("释放鱼虱幼体：寄生压力上升，观察清洁鱼共生响应", "Louse larvae released: parasite pressure rises — watch the cleaner-fish mutualism respond"));
    }
    if (action === "tap") {
      world.glassShock = 92;
      world.organisms.filter((agent) => agent.alive).forEach((agent) => {
        const fact = { kind: "danger", targetId: "glass-shock", species: "external", x: agent.x, y: agent.y, value: 1, source: "external", ttl: 65 };
        agent.mailbox.push({ id: `${world.tick}:tap:${agent.id}`, from: "human", to: agent.id, kind: "danger", priority: "hard", fact, acl: "external(glass_shock)", ttl: 52 });
      });
      world.activeTech = "edbt";
      logEvent("intervene", tr("敲击鱼缸：所有个体 mailbox 收到 hard danger", "Tank tapped: every agent's mailbox receives hard danger"));
    }
    renderAll();
  }

  function spawnAndLog(species, options = {}) {
    const agent = spawnOrganism(species, null, options);
    logEvent("intervene", tr(`加入 ${SPECIES[species].label} ${agent.id}`, `Added ${SPECIES[species].label} ${agent.id}`));
  }

  function startScript() {
    world.script = { active: true, phase: 0, phaseStart: world.tick };
    running = true;
    ui.runToggle.textContent = "Pause";
    ui.runToggle.classList.remove("primary");
    applyScriptPhase(0);
    renderAll();
  }

  function updateScript() {
    if (!world.script.active) return;
    const elapsed = world.tick - world.script.phaseStart;
    const phaseLength = [160, 170, 180, 180, 190][world.script.phase] || 150;
    if (elapsed > phaseLength) {
      world.script.phase += 1;
      world.script.phaseStart = world.tick;
      if (world.script.phase > 4) {
        world.script.active = false;
        logEvent("demo", tr("演示脚本结束：可手动切换策略继续观察", "Demo script finished: switch strategies manually to keep exploring"));
      } else {
        applyScriptPhase(world.script.phase);
      }
    }
  }

  function applyScriptPhase(phase) {
    const phases = [
      () => {
        settings.search = "bt";
        settings.comm = "qra";
        world.activeTech = "emotion";
        logEvent("demo", tr("阶段 1：饥饿和恐惧驱动 Emotional BT 权重", "Phase 1: hunger and fear drive Emotional BT weights"));
      },
      () => {
        settings.search = "mcts";
        settings.comm = "qru";
        handleIntervention("tap");
        world.activeTech = "edbt";
        logEvent("demo", tr("阶段 2：敲击鱼缸触发 EDBT 抢占", "Phase 2: a tank tap triggers EDBT preemption"));
      },
      () => {
        settings.search = "mcts";
        settings.comm = "eu";
        handleIntervention("feed");
        world.activeTech = "mcts";
        logEvent("demo", tr("阶段 3：MCTS 在觅食、逃逸、繁殖之间 rollout", "Phase 3: MCTS rollouts across foraging, fleeing and mating"));
      },
      () => {
        settings.search = "decmcts";
        settings.comm = "ebu";
        world.activeTech = "decmcts";
        logEvent("demo", tr("阶段 4：Dec-MCTS 发布意图分布，减少目标冲突", "Phase 4: Dec-MCTS publishes intention distributions to reduce target conflicts"));
      },
      () => {
        settings.search = "decsgts";
        settings.comm = "ebu";
        world.activeTech = "decsgts";
        logEvent("demo", tr("阶段 5：Dec-SGTS 使用水草床、岩洞等子目标规划", "Phase 5: Dec-SGTS plans over subgoals like plant beds and the cave"));
      },
    ];
    phases[phase]?.();
    syncControls();
  }

  function syncControls() {
    ui.searchMode.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.value === settings.search));
    ui.commMode.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.value === settings.comm));
    ui.emotionToggle.checked = settings.emotion;
    ui.eventToggle.checked = settings.eventDriven;
    ui.lifecycleToggle.checked = settings.lifecycle;
    ui.commRange.value = String(settings.commRange);
    ui.commRangeValue.textContent = String(settings.commRange);
  }

  /* =====================================================================
     ARTISTIC RENDER LAYER  (rewritten — simulation logic untouched)
     Render-only smoothing + naturalistic motion + art-directed aquarium.
     All sim state is read-only here; visual state is stashed under __ keys.
     ===================================================================== */

  function hexToRgb(hex) {
    const c = hex.replace('#', '');
    const n = parseInt(c.length === 3 ? c.split('').map(function (x) { return x + x; }).join('') : c, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function draw() {
    resizeCanvas();
    // follow the selected agent when locked on, so zoom tracks its behavior
    if (camera.follow && camera.zoom > 1.02) {
      const a = getAgent(selectedId);
      if (a && a.alive) {
        const v = a.__vis || a;
        camera.cx += (v.x - camera.cx) * 0.16;
        camera.cy += (v.y - camera.cy) * 0.16;
      }
    }

    const ctx = ui.canvas.getContext('2d');
    const fit = canvasFit();
    world.__frame = (world.__frame || 0) + 1;
    const F = world.__frame;

    // per-frame render smoothing toward simulation truth
    stepVisuals();

    // screen shake on glass tap
    let sx = 0, sy = 0;
    if (world.glassShock > 0) {
      const k = world.glassShock / 92;
      sx = Math.sin(F * 1.7) * 7 * k;
      sy = Math.cos(F * 1.9) * 5 * k;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.fillStyle = '#040a10';
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX + sx * fit.scale, fit.offsetY + sy * fit.scale);
    ctx.imageSmoothingEnabled = true;

    // clip to the tank so glows never spill onto the letterbox
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD.width, WORLD.height);
    ctx.clip();

    drawWater(ctx, F);
    drawBackdrop(ctx, F);
    drawGodRays(ctx, F);
    if (settings.overlays.subgoals) drawSubgoals(ctx);
    drawSubstrate(ctx, F);
    drawMarineSnow(ctx, F);
    drawPlants(ctx, F);
    drawFood(ctx, F);
    if (settings.overlays.messages) drawMessages(ctx, F);
    if (settings.overlays.intentions) drawIntentions(ctx);

    // schooling cohesion filaments (group behavior made legible)
    drawSchooling(ctx);

    // painter's-depth ordering: far (small y) first
    const drawList = world.organisms.filter(function (a) { return a.alive; })
      .slice().sort(function (a, b) { return (a.__vis ? a.__vis.y : a.y) - (b.__vis ? b.__vis.y : b.y); });
    drawList.forEach(function (agent) { drawOrganism(ctx, agent, F); });

    // lifecycle FX — death ghosts, birth bursts
    drawFx(ctx, F);

    if (settings.overlays.perception) drawPerception(ctx, F);
    drawSelectionSpotlight(ctx, F);

    drawBubbles(ctx, F);
    drawCausticSurface(ctx, F);
    drawVignette(ctx);

    // glass-tap white flash
    if (world.glassShock > 0) {
      ctx.fillStyle = rgba('#e8fffb', (world.glassShock / 92) * 0.32);
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }
    ctx.restore();
  }

  function resizeCanvas() {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(640, Math.round(rect.width * dpr));
    const height = Math.max(420, Math.round(rect.height * dpr));
    if (ui.canvas.width !== width || ui.canvas.height !== height) {
      ui.canvas.width = width;
      ui.canvas.height = height;
    }
  }

  function canvasFit() {
    const base = Math.min(ui.canvas.width / WORLD.width, ui.canvas.height / WORLD.height);
    const scale = base * camera.zoom;
    // half the viewport measured in world units
    const halfW = ui.canvas.width / 2 / scale;
    const halfH = ui.canvas.height / 2 / scale;
    // clamp camera center so we never pan past the tank walls
    camera.cx = halfW >= WORLD.width / 2 ? WORLD.width / 2 : clamp(camera.cx, halfW, WORLD.width - halfW);
    camera.cy = halfH >= WORLD.height / 2 ? WORLD.height / 2 : clamp(camera.cy, halfH, WORLD.height - halfH);
    return {
      scale: scale,
      base: base,
      offsetX: ui.canvas.width / 2 - camera.cx * scale,
      offsetY: ui.canvas.height / 2 - camera.cy * scale,
    };
  }

  /* ---------- render-only smoothing ---------- */
  function stepVisuals() {
    const running = true;
    world.organisms.forEach(function (a) {
      if (!a.alive) return;
      if (!a.__vis) {
        a.__vis = { x: a.x, y: a.y, ang: 0, spd: 0, tail: Math.random() * 6.28, trail: [], pop: 0 };
      }
      const v = a.__vis;
      v.pop = v.pop == null ? 1 : v.pop + (1 - v.pop) * 0.09;
      const dx = a.x - v.x, dy = a.y - v.y;
      // snap on teleport/spawn to avoid streaks
      if (Math.abs(dx) > 240 || Math.abs(dy) > 240) { v.x = a.x; v.y = a.y; }
      else { v.x += dx * 0.28; v.y += dy * 0.28; }
      const targetSpd = Math.hypot(a.vx, a.vy);
      v.spd += (targetSpd - v.spd) * 0.18;
      // heading eased (shortest angular path)
      let ta = Math.atan2(a.vy, a.vx);
      let da = ta - v.ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      v.ang += da * 0.2;
      v.tail += 0.18 + v.spd * 0.16;
      // motion trail
      v.trail.push({ x: v.x, y: v.y });
      if (v.trail.length > 7) v.trail.shift();
    });
  }
  function vis(a) { return a.__vis || { x: a.x, y: a.y, ang: 0, spd: 0, tail: 0, trail: [] }; }

  /* ---------- environment ---------- */
  function drawWater(ctx, F) {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    g.addColorStop(0, '#1e6a7c');
    g.addColorStop(0.26, '#14526a');
    g.addColorStop(0.58, '#0b3752');
    g.addColorStop(0.86, '#07223a');
    g.addColorStop(1, '#051828');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    // horizontal light falloff — brighter center, darker glass edges
    const hg = ctx.createLinearGradient(0, 0, WORLD.width, 0);
    hg.addColorStop(0, rgba('#02101c', 0.32));
    hg.addColorStop(0.22, rgba('#02101c', 0));
    hg.addColorStop(0.78, rgba('#02101c', 0));
    hg.addColorStop(1, rgba('#02101c', 0.32));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    // surface shimmer band
    const sg = ctx.createLinearGradient(0, 0, 0, WORLD.waterTop + 60);
    sg.addColorStop(0, rgba('#bff6ee', 0.22));
    sg.addColorStop(1, rgba('#bff6ee', 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, WORLD.width, WORLD.waterTop + 60);
    // undulating surface line
    ctx.strokeStyle = rgba('#d7fbf4', 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 12) {
      const y = WORLD.waterTop + Math.sin(x * 0.03 + F * 0.05) * 3 + Math.sin(x * 0.08 - F * 0.03) * 1.6;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawBackdrop(ctx, F) {
    // distant silhouettes for depth — far dune + slow swaying plant shapes
    ctx.save();
    ctx.fillStyle = rgba('#062434', 0.85);
    ctx.beginPath();
    ctx.moveTo(0, WORLD.floor - 26);
    for (let x = 0; x <= WORLD.width; x += 40) {
      ctx.lineTo(x, WORLD.floor - 26 - Math.sin(x * 0.008 + 2) * 16 - Math.sin(x * 0.021) * 8);
    }
    ctx.lineTo(WORLD.width, WORLD.floor + 30);
    ctx.lineTo(0, WORLD.floor + 30);
    ctx.closePath();
    ctx.fill();
    const clumps = [70, 150, 330, 780, 960, 1050];
    clumps.forEach(function (cx, ci) {
      const blades = 4 + (ci % 3);
      for (let i = 0; i < blades; i += 1) {
        const rootX = cx + (i - blades / 2) * 9;
        const h = 90 + ((ci * 37 + i * 53) % 70);
        const sway = Math.sin(F * 0.012 + ci * 1.3 + i * 0.6) * (8 + h * 0.05);
        ctx.strokeStyle = rgba('#07293b', 0.9);
        ctx.lineWidth = 7 - (i % 3) * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(rootX, WORLD.floor - 10);
        ctx.quadraticCurveTo(rootX + sway * 0.4, WORLD.floor - 10 - h * 0.55, rootX + sway, WORLD.floor - 10 - h);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawGodRays(ctx, F) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beams = 5;
    for (let i = 0; i < beams; i += 1) {
      const baseX = (i + 0.5) / beams * WORLD.width;
      const drift = Math.sin(F * 0.006 + i * 1.7) * 70;
      const top = baseX + drift;
      const w = 46 + i * 8;
      const skew = 130 + Math.sin(i) * 40;
      const g = ctx.createLinearGradient(0, WORLD.waterTop, 0, WORLD.floor);
      const a = 0.05 + 0.03 * Math.abs(Math.sin(F * 0.004 + i));
      g.addColorStop(0, rgba('#d8fff7', a));
      g.addColorStop(0.7, rgba('#7fe9dd', a * 0.35));
      g.addColorStop(1, rgba('#7fe9dd', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(top - w / 2, WORLD.waterTop);
      ctx.lineTo(top + w / 2, WORLD.waterTop);
      ctx.lineTo(top + w / 2 + skew, WORLD.floor);
      ctx.lineTo(top - w / 2 + skew, WORLD.floor);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMarineSnow(ctx, F) {
    ctx.save();
    for (let i = 0; i < 90; i += 1) {
      const seed = i * 12.9898;
      const speed = 0.15 + (i % 5) * 0.05;
      const x = (i * 131 + Math.sin(seed) * 40 + F * (0.05 + (i % 3) * 0.02)) % WORLD.width;
      const y = (WORLD.waterTop + (i * 71 + F * speed) % (WORLD.floor - WORLD.waterTop));
      const r = 0.6 + (i % 3) * 0.5;
      ctx.fillStyle = rgba('#cfeeee', 0.05 + (i % 4) * 0.02);
      ctx.beginPath();
      ctx.arc((x + WORLD.width) % WORLD.width, y, r, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSubstrate(ctx, F) {
    // sandy floor with soft dunes
    const fg = ctx.createLinearGradient(0, WORLD.floor - 18, 0, WORLD.height);
    fg.addColorStop(0, '#caa367');
    fg.addColorStop(0.5, '#a8814b');
    fg.addColorStop(1, '#6f5330');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.height);
    ctx.lineTo(0, WORLD.floor + 6);
    for (let x = 0; x <= WORLD.width; x += 26) {
      const y = WORLD.floor + Math.sin(x * 0.02 + 1.2) * 6 + Math.sin(x * 0.06) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WORLD.width, WORLD.height);
    ctx.closePath();
    ctx.fill();
    // dune shading speckle
    ctx.fillStyle = rgba('#5c4327', 0.35);
    for (let i = 0; i < 60; i += 1) {
      const x = (i * 79) % WORLD.width;
      ctx.fillRect(x, WORLD.floor + 8 + (i % 5) * 6, 3, 2);
    }
    // scattered pebbles
    for (let i = 0; i < 26; i += 1) {
      const px = (i * 173 + 40) % WORLD.width;
      const py = WORLD.floor + 6 + (i * 37) % 28;
      const pr = 2.4 + (i % 4) * 1.4;
      ctx.fillStyle = rgba(i % 3 === 0 ? '#8b9694' : '#7a6748', 0.55);
      ctx.beginPath();
      ctx.ellipse(px, py, pr, pr * 0.62, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = rgba('#e8ddc4', 0.18);
      ctx.beginPath();
      ctx.ellipse(px - pr * 0.25, py - pr * 0.22, pr * 0.45, pr * 0.26, 0, 0, 6.283);
      ctx.fill();
    }
    // moving caustic light patches on the sand
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i += 1) {
      const cx2 = ((i / 6) * WORLD.width + Math.sin(F * 0.014 + i * 2.1) * 80 + WORLD.width) % WORLD.width;
      const cg2 = ctx.createRadialGradient(cx2, WORLD.floor + 10, 0, cx2, WORLD.floor + 10, 95);
      cg2.addColorStop(0, rgba('#ffe9b8', 0.05 + 0.03 * Math.abs(Math.sin(F * 0.02 + i))));
      cg2.addColorStop(1, rgba('#ffe9b8', 0));
      ctx.fillStyle = cg2;
      ctx.beginPath();
      ctx.ellipse(cx2, WORLD.floor + 10, 95, 26, 0, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
    // rocks
    drawRock(ctx, 470, 560, 175, 66);
    drawRock(ctx, 636, 566, 132, 50);
    // cave mouth
    ctx.save();
    ctx.fillStyle = '#04101a';
    ctx.beginPath();
    ctx.ellipse(600, 566, 60, 42, 0, Math.PI, 0);
    ctx.fill();
    const cg = ctx.createRadialGradient(600, 560, 6, 600, 560, 66);
    cg.addColorStop(0, rgba('#0a1f2c', 0.9));
    cg.addColorStop(1, rgba('#0a1f2c', 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(600, 560, 60, 46, 0, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawRock(ctx, x, y, w, h) {
    ctx.save();
    const g = ctx.createLinearGradient(0, y - h, 0, y + 4);
    g.addColorStop(0, '#7c8a8b');
    g.addColorStop(0.5, '#586566');
    g.addColorStop(1, '#39474a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x - w / 2 + 8, y - h, x - w * 0.12, y - h * 0.92);
    ctx.quadraticCurveTo(x + w * 0.1, y - h * 1.05, x + w * 0.34, y - h * 0.72);
    ctx.quadraticCurveTo(x + w / 2, y - h * 0.5, x + w / 2, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba('#aebbbb', 0.4);
    ctx.beginPath();
    ctx.ellipse(x - w * 0.1, y - h * 0.62, w * 0.22, h * 0.2, -0.3, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawPlants(ctx, F) {
    world.plants.forEach(function (plant, pi) {
      if (plant.biomass <= 1) return;
      const height = 26 + plant.biomass * 0.85;
      const blades = 2 + Math.floor(plant.biomass / 26);
      for (let i = 0; i < blades; i += 1) {
        const rootX = plant.x + (i - blades / 2) * 6;
        const phase = plant.sway + i * 0.7 + pi * 0.4;
        const h = height * (0.72 + (i % 3) * 0.12);
        const tipX = rootX + Math.sin(phase + F * 0.03) * (10 + h * 0.06);
        const midX = rootX + Math.sin(phase + F * 0.03) * (5 + h * 0.03);
        // depth understroke, then lit blade, then tip glint
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba('#123c22', 0.85);
        ctx.lineWidth = 6.5 - (i % 2);
        ctx.beginPath();
        ctx.moveTo(rootX + 1.5, plant.y + 1);
        ctx.quadraticCurveTo(midX + 1.5, plant.y - h * 0.55, tipX + 1.5, plant.y - h + 2);
        ctx.stroke();
        const g = ctx.createLinearGradient(rootX, plant.y, tipX, plant.y - h);
        g.addColorStop(0, '#2f7a3a');
        g.addColorStop(0.7, '#63c25c');
        g.addColorStop(1, '#b6f28a');
        ctx.strokeStyle = g;
        ctx.lineWidth = 5 - (i % 2);
        ctx.beginPath();
        ctx.moveTo(rootX, plant.y);
        ctx.quadraticCurveTo(midX, plant.y - h * 0.55, tipX, plant.y - h);
        ctx.stroke();
        ctx.fillStyle = rgba('#dcffc0', 0.5);
        ctx.beginPath();
        ctx.arc(tipX, plant.y - h, 1.6, 0, 6.283);
        ctx.fill();
      }
    });
  }

  function drawFood(ctx, F) {
    world.food.forEach(function (food, i) {
      const pulse = 0.6 + 0.4 * Math.sin(F * 0.15 + i);
      const g = ctx.createRadialGradient(food.x, food.y, 0, food.x, food.y, 9);
      g.addColorStop(0, rgba('#fff6cf', 0.95));
      g.addColorStop(0.4, rgba(COLORS.food, 0.8));
      g.addColorStop(1, rgba(COLORS.food, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(food.x, food.y, 9 * pulse, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = '#fffce8';
      ctx.beginPath();
      ctx.arc(food.x, food.y, 1.6, 0, 6.283);
      ctx.fill();
    });
  }

  /* ---------- creatures ---------- */
  function drawOrganism(ctx, agent, F) {
    if (agent.species === 'shrimp') drawShrimp(ctx, agent, F);
    else if (agent.species === 'snail') drawSnail(ctx, agent, F);
    else if (agent.species === 'louse') drawLouse(ctx, agent, F);
    else drawFish(ctx, agent, F);
  }

  function fishState(agent) {
    const t = agent.action ? agent.action.type : 'idle';
    return { fleeing: t === 'flee' || t === 'hide', hunting: t === 'hunt' || t === 'seek-known-food', resting: t === 'rest' || t === 'idle' };
  }

  function drawFish(ctx, agent, F) {
    const spec = SPECIES[agent.species];
    const v = vis(agent);
    const L = spec.size;
    const st = fishState(agent);
    const fear = agent.emotion ? agent.emotion.fear : 0;
    const energyFrac = clamp(agent.energy / spec.maxEnergy, 0, 1);
    const rawBase = COLORS[agent.species] || COLORS.smallfish;
    // low energy reads as desaturation — never as invisibility
    const base = mix(rawBase, '#41606b', (1 - energyFrac) * 0.55);
    const bob = Math.sin(F * 0.05 + (agent.selectedPulse || 0)) * (st.resting ? 2.4 : 1.2);
    const x = v.x, y = v.y + bob;
    const facing = Math.cos(v.ang) >= 0 ? 1 : -1;
    let pitch = Math.atan2(v.vy != null ? v.vy : agent.vy, Math.abs(agent.vx) + 0.01);
    pitch = clamp(pitch, -0.55, 0.55);

    // tail beat: faster when fleeing/fast
    const beatSpeed = 0.55 + v.spd * 0.35 + (st.fleeing ? 0.6 : 0);
    const tailAng = Math.sin(v.tail * beatSpeed) * (0.35 + Math.min(0.5, v.spd * 0.09) + (st.fleeing ? 0.25 : 0));

    // soft contact shadow on the sand
    const floorDist = WORLD.floor - y;
    if (floorDist > 0 && floorDist < 170) {
      const sa = (1 - floorDist / 170) * 0.28;
      ctx.save();
      ctx.fillStyle = rgba('#01080e', sa);
      ctx.beginPath();
      ctx.ellipse(x, WORLD.floor + 6, L * 0.7, 6, 0, 0, 6.283);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.rotate(pitch);
    const pop = 0.45 + 0.55 * (v.pop == null ? 1 : v.pop);
    ctx.scale(pop, pop);
    ctx.globalAlpha = 0.88 + energyFrac * 0.12;

    const halfL = L * 0.62, halfH = L * 0.34;

    // soft contact shadow / depth glow
    // dorsal + belly gradient
    const bg = ctx.createLinearGradient(0, -halfH, 0, halfH);
    bg.addColorStop(0, shade(base, -46));
    bg.addColorStop(0.45, base);
    bg.addColorStop(1, mix(base, '#ffffff', 0.5));

    // tail fin (drawn first, behind body)
    ctx.save();
    ctx.translate(-halfL * 0.92, 0);
    ctx.rotate(tailAng);
    ctx.fillStyle = shade(base, -18);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-halfL * 0.5, -halfH * 0.9, -halfL * 0.72, -halfH * 1.15);
    ctx.quadraticCurveTo(-halfL * 0.4, 0, -halfL * 0.72, halfH * 1.15);
    ctx.quadraticCurveTo(-halfL * 0.5, halfH * 0.9, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // dorsal fin
    ctx.fillStyle = rgba(shade(base, -10), 0.9);
    ctx.beginPath();
    ctx.moveTo(-halfL * 0.1, -halfH * 0.9);
    ctx.quadraticCurveTo(halfL * 0.1, -halfH * 1.7, halfL * 0.34, -halfH * 0.7);
    ctx.closePath();
    ctx.fill();

    // pectoral fin (animated flutter)
    const finFlutter = Math.sin(v.tail * beatSpeed + 1) * 0.3;
    ctx.save();
    ctx.translate(halfL * 0.05, halfH * 0.35);
    ctx.rotate(0.5 + finFlutter);
    ctx.fillStyle = rgba(mix(base, '#ffffff', 0.35), 0.75);
    ctx.beginPath();
    ctx.ellipse(0, halfH * 0.4, halfL * 0.28, halfH * 0.5, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();

    // body (teardrop)
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(halfL, 0);
    ctx.quadraticCurveTo(halfL * 0.4, -halfH, -halfL * 0.55, -halfH * 0.7);
    ctx.quadraticCurveTo(-halfL * 0.95, -halfH * 0.25, -halfL * 0.95, 0);
    ctx.quadraticCurveTo(-halfL * 0.95, halfH * 0.25, -halfL * 0.55, halfH * 0.7);
    ctx.quadraticCurveTo(halfL * 0.4, halfH, halfL, 0);
    ctx.closePath();
    ctx.fill();
    // crisp silhouette edge so fish separate from the water
    ctx.strokeStyle = rgba(shade(base, -58), 0.85);
    ctx.lineWidth = Math.max(1.1, L * 0.035);
    ctx.stroke();

    // top rim-light from the surface
    ctx.strokeStyle = rgba('#eafff6', 0.5);
    ctx.lineWidth = Math.max(1, L * 0.03);
    ctx.beginPath();
    ctx.moveTo(halfL * 0.82, -halfH * 0.18);
    ctx.quadraticCurveTo(halfL * 0.3, -halfH * 0.92, -halfL * 0.5, -halfH * 0.66);
    ctx.stroke();

    // dorsal highlight
    ctx.fillStyle = rgba('#ffffff', 0.22);
    ctx.beginPath();
    ctx.ellipse(-halfL * 0.05, -halfH * 0.4, halfL * 0.42, halfH * 0.22, 0, 0, 6.283);
    ctx.fill();

    // gill stripe
    ctx.strokeStyle = rgba(shade(base, -34), 0.6);
    ctx.lineWidth = Math.max(1, L * 0.05);
    ctx.beginPath();
    ctx.arc(halfL * 0.34, 0, halfH * 0.85, -1.1, 1.1);
    ctx.stroke();

    // eye
    ctx.fillStyle = '#fbfff9';
    ctx.beginPath();
    ctx.arc(halfL * 0.6, -halfH * 0.22, Math.max(2.4, L * 0.11), 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#06121a';
    ctx.beginPath();
    ctx.arc(halfL * 0.63, -halfH * 0.22, Math.max(1.3, L * 0.06) * (st.fleeing ? 1.3 : 1), 0, 6.283);
    ctx.fill();

    // fear rim
    if (fear > 0.25) {
      ctx.globalAlpha = Math.min(0.8, fear);
      ctx.strokeStyle = rgba(COLORS.danger, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(halfL, 0);
      ctx.quadraticCurveTo(halfL * 0.4, -halfH, -halfL * 0.55, -halfH * 0.7);
      ctx.quadraticCurveTo(-halfL * 0.95, -halfH * 0.25, -halfL * 0.95, 0);
      ctx.quadraticCurveTo(-halfL * 0.95, halfH * 0.25, -halfL * 0.55, halfH * 0.7);
      ctx.quadraticCurveTo(halfL * 0.4, halfH, halfL, 0);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    drawStatusMarkers(ctx, agent, x, y, L, st, energyFrac, F);
  }

  /* status markers — flee alert + low-energy bar, drawn in world coords */
  function drawStatusMarkers(ctx, agent, x, y, L, st, energyFrac, F) {
    const top = y - L * 0.62;
    if (st.fleeing) {
      const bounce = Math.sin(F * 0.25) * 2;
      ctx.save();
      ctx.fillStyle = rgba('#170a0d', 0.85);
      ctx.beginPath();
      ctx.arc(x, top - 16 + bounce, 8, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = rgba(COLORS.danger, 0.9);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = COLORS.danger;
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', x, top - 12 + bounce);
      ctx.restore();
    }
    if (energyFrac < 0.38) {
      const w = Math.max(22, L * 0.9);
      const bx = x - w / 2, by = top - 7;
      ctx.save();
      ctx.fillStyle = rgba('#03131c', 0.78);
      roundRectPath(ctx, bx - 1.5, by - 1.5, w + 3, 6, 3);
      ctx.fill();
      ctx.fillStyle = mix(COLORS.danger, '#ffd166', energyFrac / 0.38);
      roundRectPath(ctx, bx, by, Math.max(2.5, w * energyFrac), 3, 1.5);
      ctx.fill();
      ctx.restore();
    }
    // parasite-load pips — purple dots above a burdened host
    if (agent.parasiteLoad > 0) {
      ctx.save();
      const n = Math.min(5, agent.parasiteLoad);
      for (let i = 0; i < n; i += 1) {
        ctx.fillStyle = REL_COLORS.parasitism;
        ctx.beginPath();
        ctx.arc(x - (n - 1) * 3 + i * 6, top - 20, 2.1, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    }
    // relationship event flash ring (共生/寄生/竞争/合作)
    if (agent.relFlash) {
      const rf = agent.relFlash;
      const t = 1 - clamp(rf.f / 30, 0, 1);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = REL_COLORS[rf.type] || '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, L * 0.7 + t * 16, 0, 6.283);
      ctx.stroke();
      ctx.restore();
    }
    // cooperation aura
    if (agent.coopPulse > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(agent.coopPulse / 14, 0, 1) * 0.5;
      ctx.strokeStyle = REL_COLORS.cooperation;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, L * 0.85, 0, 6.283);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function drawShrimp(ctx, agent, F) {
    const v = vis(agent);
    const st = fishState(agent);
    const fear = agent.emotion ? agent.emotion.fear : 0;
    const bob = Math.sin(F * 0.09 + (agent.selectedPulse || 0)) * 1.4;
    const x = v.x, y = v.y + bob;
    const facing = Math.cos(v.ang) >= 0 ? 1 : -1;
    let pitch = clamp(Math.atan2(agent.vy, Math.abs(agent.vx) + 0.01), -0.5, 0.5);
    const legPhase = Math.sin(v.tail * (0.8 + v.spd * 0.4));

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.rotate(pitch);
    const pop = 0.45 + 0.55 * (v.pop == null ? 1 : v.pop);
    ctx.scale(pop, pop);
    const shrimpEnergy = clamp(agent.energy / SPECIES.shrimp.maxEnergy, 0, 1);
    ctx.globalAlpha = 0.9 + shrimpEnergy * 0.1;

    // legs
    ctx.strokeStyle = rgba(shade(COLORS.shrimp, -20), 0.8);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i += 1) {
      const lx = -4 + i * 3;
      ctx.beginPath();
      ctx.moveTo(lx, 3);
      ctx.lineTo(lx - 1 + legPhase * 2, 8 + (i % 2) * 2);
      ctx.stroke();
    }
    // curved body
    const bg = ctx.createLinearGradient(0, -5, 0, 6);
    bg.addColorStop(0, mix(COLORS.shrimp, '#ffffff', 0.35));
    bg.addColorStop(1, shade(COLORS.shrimp, -18));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.quadraticCurveTo(2, -6, -6, -3);
    ctx.quadraticCurveTo(-13, 0, -9, 5);
    ctx.quadraticCurveTo(-4, 3, 2, 3);
    ctx.quadraticCurveTo(6, 3, 8, -2);
    ctx.closePath();
    ctx.fill();
    // tail fan
    ctx.fillStyle = rgba(COLORS.shrimp, 0.7);
    ctx.beginPath();
    ctx.moveTo(-9, 4);
    ctx.lineTo(-14, 1);
    ctx.lineTo(-14, 7);
    ctx.closePath();
    ctx.fill();
    // antennae
    ctx.strokeStyle = rgba('#ffd1db', 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.quadraticCurveTo(15, -5 + legPhase, 20, -8 + legPhase * 2);
    ctx.moveTo(8, -1);
    ctx.quadraticCurveTo(15, -1 + legPhase, 21, -2 + legPhase * 2);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#06121a';
    ctx.beginPath();
    ctx.arc(6, -3, 1.4, 0, 6.283);
    ctx.fill();
    if (fear > 0.3) {
      ctx.strokeStyle = rgba(COLORS.danger, Math.min(0.8, fear));
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-2, 1, 12, 0, 6.283);
      ctx.stroke();
    }
    ctx.restore();

    drawStatusMarkers(ctx, agent, x, y, 22, st, shrimpEnergy, F);
  }

  function drawSnail(ctx, agent, F) {
    const v = vis(agent);
    const facing = Math.cos(v.ang) >= 0 ? 1 : -1;
    const x = v.x, y = v.y;
    const eF = clamp(agent.energy / SPECIES.snail.maxEnergy, 0, 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    const pop = 0.45 + 0.55 * (v.pop == null ? 1 : v.pop);
    ctx.scale(pop, pop);
    // contact shadow
    ctx.fillStyle = rgba('#01080e', 0.3);
    ctx.beginPath();
    ctx.ellipse(0, 6, 12, 3, 0, 0, 6.283);
    ctx.fill();
    // muscular foot
    ctx.fillStyle = mix('#d9c79a', '#8a7550', 1 - eF);
    ctx.beginPath();
    ctx.moveTo(-11, 5);
    ctx.quadraticCurveTo(-13, 1, -8, 0);
    ctx.lineTo(9, 0);
    ctx.quadraticCurveTo(13, 1, 10, 5);
    ctx.closePath();
    ctx.fill();
    // eye stalks
    ctx.strokeStyle = '#c7b78c';
    ctx.lineWidth = 1.2;
    const stalk = Math.sin(F * 0.05) * 0.6;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(13 + stalk, -6);
    ctx.moveTo(7, 0);
    ctx.lineTo(11 + stalk, -7);
    ctx.stroke();
    ctx.fillStyle = '#1a1207';
    ctx.beginPath(); ctx.arc(13 + stalk, -6, 1.1, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(11 + stalk, -7, 1.1, 0, 6.283); ctx.fill();
    // spiral shell
    const sg = ctx.createRadialGradient(-2, -6, 1, -2, -4, 11);
    sg.addColorStop(0, mix(COLORS.snail, '#fff3d0', 0.5));
    sg.addColorStop(1, shade(COLORS.snail, -34));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(-1, -4, 9, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = rgba(shade(COLORS.snail, -50), 0.8);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let a = 0; a < 6.6; a += 0.25) {
      const r = 1.4 + a * 1.15;
      const sx = -1 + Math.cos(a * 1.9) * r * 0.6;
      const sy = -4 + Math.sin(a * 1.9) * r * 0.6;
      if (a === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLouse(ctx, agent, F) {
    const v = vis(agent);
    const x = v.x, y = v.y;
    const wig = Math.sin(F * 0.4 + (agent.selectedPulse || 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(agent.vy, agent.vx));
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
    glow.addColorStop(0, rgba(COLORS.louse, 0.5));
    glow.addColorStop(1, rgba(COLORS.louse, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 6.283); ctx.fill();
    // legs
    ctx.strokeStyle = rgba(shade(COLORS.louse, -30), 0.85);
    ctx.lineWidth = 0.8;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 1.6, -2);
      ctx.lineTo(i * 1.6 - 1 + wig, -5);
      ctx.moveTo(i * 1.6, 2);
      ctx.lineTo(i * 1.6 - 1 + wig, 5);
      ctx.stroke();
    }
    // carapace
    const bg = ctx.createLinearGradient(0, -3, 0, 3);
    bg.addColorStop(0, mix(COLORS.louse, '#ffffff', 0.4));
    bg.addColorStop(1, shade(COLORS.louse, -22));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.4, 3, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#1a0f2e';
    ctx.beginPath(); ctx.arc(2.4, 0, 0.9, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  // ---------- relationship overlay: typed links between interacting agents ----------
  function drawRelationships(ctx, F) {
    if (!world.relLinks || !world.relLinks.length) return;
    ctx.save();
    world.relLinks.forEach(function (link) {
      const a = getAgent(link.from), b = getAgent(link.to);
      if (!a || !b || !a.alive || !b.alive) return;
      const av = a.__vis || a, bv = b.__vis || b;
      const col = REL_COLORS[link.type] || '#fff';
      const dashed = link.type === 'competition' || link.type === 'intraspecific';
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = col;
      ctx.lineWidth = link.type === 'cooperation' ? 1.8 : 2.2;
      ctx.setLineDash(dashed ? [4, 4] : []);
      const mx = (av.x + bv.x) / 2 + (bv.y - av.y) * 0.08;
      const my = (av.y + bv.y) / 2 - (bv.x - av.x) * 0.08;
      ctx.beginPath();
      ctx.moveTo(av.x, av.y);
      ctx.quadraticCurveTo(mx, my, bv.x, bv.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // midpoint marker glyph
      const gx = mx, gy = my;
      const glyph = { mutualism: '✦', parasitism: '✖', competition: '⚔', intraspecific: '⚔', cooperation: '⬢', predation: '▲' }[link.type] || '';
      ctx.globalAlpha = 0.9;
      const pg = ctx.createRadialGradient(gx, gy, 0, gx, gy, 7);
      pg.addColorStop(0, rgba(col, 0.9));
      pg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#06121a';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, gx, gy + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });
    ctx.restore();
  }

  /* ---------- group behavior ---------- */
  function drawSchooling(ctx) {
    ctx.save();
    ctx.lineWidth = 1;
    const groups = { smallfish: [], shrimp: [] };
    world.organisms.forEach(function (a) {
      if (a.alive && groups[a.species]) groups[a.species].push(a);
    });
    Object.keys(groups).forEach(function (sp) {
      const list = groups[sp];
      const col = COLORS[sp];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = vis(list[i]), b = vis(list[j]);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 92) {
            ctx.strokeStyle = rgba(col, (1 - d / 92) * 0.16);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    });
    ctx.restore();
  }

  /* ---------- communication ---------- */
  function drawMessages(ctx, F) {
    world.messages.forEach(function (message) {
      const from = getAgent(message.from) || message.start;
      const to = getAgent(message.to) || message.end;
      if (!from || !to) return;
      const fv = from.__vis || from, tv = to.__vis || to;
      const alpha = clamp(message.ttl / 78, 0.1, 0.85);
      const hard = message.priority === 'hard';
      const col = hard ? COLORS.danger : COLORS.message;
      const mx = (fv.x + tv.x) / 2 + (tv.y - fv.y) * 0.14;
      const my = (fv.y + tv.y) / 2 - (tv.x - fv.x) * 0.14;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = hard ? 2.6 : 1.6;
      ctx.setLineDash(message.kind === 'QRU' || message.kind === 'QRA' ? [6, 5] : []);
      ctx.beginPath();
      ctx.moveTo(fv.x, fv.y);
      ctx.quadraticCurveTo(mx, my, tv.x, tv.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // traveling pulse along the arc
      const life = 1 - clamp(message.ttl / 78, 0, 1);
      const t = life;
      const px = (1 - t) * (1 - t) * fv.x + 2 * (1 - t) * t * mx + t * t * tv.x;
      const py = (1 - t) * (1 - t) * fv.y + 2 * (1 - t) * t * my + t * t * tv.y;
      ctx.globalAlpha = alpha;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, 9);
      pg.addColorStop(0, rgba(hard ? '#ffd0d0' : '#d6fff7', 0.98));
      pg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, 6.283);
      ctx.fill();
      // label the protocol on urgent messages
      if (hard && message.kind) {
        ctx.font = '700 11px "JetBrains Mono", monospace';
        const kw = ctx.measureText(message.kind).width;
        ctx.fillStyle = rgba('#170a0d', 0.85);
        roundRectPath(ctx, px + 8, py - 9, kw + 10, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#ffb3b3';
        ctx.fillText(message.kind, px + 13, py + 3);
      }
      ctx.restore();
    });
  }

  /* ---------- overlays ---------- */
  function drawSubgoals(ctx) {
    ctx.save();
    ZONES.forEach(function (zone) {
      const safe = zone.safety || zone.id === 'cave';
      const col = safe ? '#9ee27d' : COLORS.subgoal;
      const x = zone.x - zone.w / 2, y = zone.y - zone.h / 2;
      const r = 16;
      ctx.fillStyle = rgba(col, 0.05);
      ctx.strokeStyle = rgba(col, 0.4);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 6]);
      ctx.lineCap = 'round';
      roundRectPath(ctx, x, y, zone.w, zone.h, r);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      // label chip
      ctx.font = '600 15px "JetBrains Mono", monospace';
      const tw = ctx.measureText(zone.label).width;
      ctx.fillStyle = rgba('#03141b', 0.88);
      roundRectPath(ctx, x + 8, y + 8, tw + 20, 25, 6);
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rgba(col, 1);
      ctx.fillText(zone.label, x + 18, y + 26);
    });
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPerception(ctx, F) {
    const agent = getAgent(selectedId);
    if (!agent || !agent.alive) return;
    const spec = SPECIES[agent.species];
    const v = vis(agent);
    ctx.save();
    const g = ctx.createRadialGradient(v.x, v.y, spec.sense * 0.2, v.x, v.y, spec.sense);
    g.addColorStop(0, rgba(COLORS.message, 0.02));
    g.addColorStop(0.82, rgba(COLORS.message, 0.06));
    g.addColorStop(1, rgba(COLORS.message, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(v.x, v.y, spec.sense, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.message, 0.3);
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(v.x, v.y, spec.sense, 0, 6.283);
    ctx.stroke();
    ctx.setLineDash([]);
    // sensed dangers
    factsByKind(agent, 'danger').slice(0, 4).forEach(function (fact) {
      ctx.strokeStyle = rgba(COLORS.danger, 0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(fact.x, fact.y);
      ctx.stroke();
      ctx.fillStyle = rgba(COLORS.danger, 0.6);
      ctx.beginPath();
      ctx.arc(fact.x, fact.y, 4, 0, 6.283);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawIntentions(ctx) {
    world.organisms.filter(function (agent) {
      return agent.alive && agent.intention && Object.keys(agent.intention).length;
    }).forEach(function (agent) {
      const targetKey = Object.entries(agent.intention).sort(function (a, b) { return b[1] - a[1]; })[0];
      if (!targetKey) return;
      const target = resolveAnyTarget(targetKey[0]);
      if (!target) return;
      const v = vis(agent);
      const tx = target.__vis ? target.__vis.x : target.x;
      const ty = target.__vis ? target.__vis.y : target.y;
      const col = agent.species === 'bigfish' ? COLORS.bigfish : agent.species === 'smallfish' ? COLORS.smallfish : COLORS.shrimp;
      const mx = (v.x + tx) / 2 + (ty - v.y) * 0.1;
      const my = (v.y + ty) / 2 - (tx - v.x) * 0.1;
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      // arrowhead
      const ang = Math.atan2(ty - my, tx - mx);
      ctx.fillStyle = col;
      ctx.translate(tx, ty);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-7, -3);
      ctx.lineTo(-7, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  function drawSelectionSpotlight(ctx, F) {
    const agent = getAgent(selectedId);
    if (!agent || !agent.alive) return;
    const v = vis(agent);
    const spec = SPECIES[agent.species];
    const r = spec.size * 1.5 + 8;
    ctx.save();
    // pulsing focus ring
    const pulse = 0.5 + 0.5 * Math.sin(F * 0.08);
    ctx.strokeStyle = rgba('#eafff9', 0.55 + pulse * 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r + pulse * 4, 0, 6.283);
    ctx.stroke();
    // tick marks
    ctx.strokeStyle = rgba(COLORS.message, 0.8);
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI / 2 + F * 0.01;
      ctx.beginPath();
      ctx.moveTo(v.x + Math.cos(a) * (r + 2), v.y + Math.sin(a) * (r + 2));
      ctx.lineTo(v.x + Math.cos(a) * (r + 9), v.y + Math.sin(a) * (r + 9));
      ctx.stroke();
    }
    // label
    const label = agent.id + ' ' + spec.label;
    ctx.font = '600 15px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width;
    const lx = v.x - tw / 2 - 10, ly = v.y - r - 38;
    // leader line from chip down to the focus ring
    ctx.strokeStyle = rgba(COLORS.message, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.x, ly + 25);
    ctx.lineTo(v.x, v.y - r - 2);
    ctx.stroke();
    ctx.fillStyle = rgba('#03141b', 0.9);
    roundRectPath(ctx, lx, ly, tw + 20, 25, 6);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.message, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#eafff9';
    ctx.fillText(label, lx + 10, ly + 18);
    ctx.restore();
  }

  /* ---------- lifecycle FX: death & birth ---------- */
  function pushFx(fx) {
    if (!world.__fx) world.__fx = [];
    world.__fx.push(fx);
  }

  function drawFx(ctx, F) {
    if (!world.__fx || !world.__fx.length) return;
    for (let i = world.__fx.length - 1; i >= 0; i -= 1) {
      const fx = world.__fx[i];
      fx.f += 1;
      let done;
      if (fx.type === 'death') done = drawDeathFx(ctx, fx);
      else if (fx.type === 'contest') done = drawContestFx(ctx, fx);
      else done = drawBirthFx(ctx, fx);
      if (done) world.__fx.splice(i, 1);
    }
  }

  function drawContestFx(ctx, fx) {
    const DUR = 30;
    if (fx.f >= DUR) return true;
    const t = fx.f / DUR;
    const col = REL_COLORS[fx.kind] || REL_COLORS.competition;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    // clash spark — radiating slashes
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * (1 - t) + 0.5;
    const ease = 1 - Math.pow(1 - t, 2);
    for (let i = 0; i < 7; i += 1) {
      const a = fx.seed + i * (6.283 / 7);
      const r0 = 3 + ease * 6;
      const r1 = 8 + ease * 20;
      ctx.beginPath();
      ctx.moveTo(fx.x + Math.cos(a) * r0, fx.y + Math.sin(a) * r0);
      ctx.lineTo(fx.x + Math.cos(a) * r1, fx.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
    return false;
  }

  function drawDeathFx(ctx, fx) {
    const DUR = 110;
    if (fx.f >= DUR) return true;
    const t = fx.f / DUR;
    const spec = SPECIES[fx.species];
    const L = (spec && spec.size) || 20;
    const col = COLORS[fx.species] || '#9fb7c4';
    ctx.save();

    // shock ring at the moment of death (red when eaten)
    if (fx.f < 34) {
      const rt = fx.f / 34;
      ctx.strokeStyle = rgba(fx.predation ? COLORS.danger : '#cfe8e4', (1 - rt) * 0.7);
      ctx.lineWidth = 2.4 * (1 - rt) + 0.6;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 6 + rt * (L * 1.9), 0, 6.283);
      ctx.stroke();
    }

    // belly-up ghost drifting upward while fading
    const rise = fx.f * 0.34;
    const flip = fx.f < 26 ? Math.cos((fx.f / 26) * Math.PI) : -1;
    const wob = Math.sin(fx.f * 0.11 + fx.seed) * 0.12;
    const alpha = (1 - t) * 0.66;
    ctx.save();
    ctx.translate(fx.x, fx.y - rise);
    ctx.rotate(wob);
    ctx.scale(1, flip || 0.05);
    const ghost = mix(col, '#c8d8d8', 0.55);
    const halfL = L * 0.62, halfH = L * 0.34;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ghost;
    ctx.beginPath();
    ctx.moveTo(halfL, 0);
    ctx.quadraticCurveTo(halfL * 0.4, -halfH, -halfL * 0.55, -halfH * 0.7);
    ctx.quadraticCurveTo(-halfL * 0.95, -halfH * 0.25, -halfL * 0.95, 0);
    ctx.quadraticCurveTo(-halfL * 0.95, halfH * 0.25, -halfL * 0.55, halfH * 0.7);
    ctx.quadraticCurveTo(halfL * 0.4, halfH, halfL, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba('#0a1c26', alpha * 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    // X eye — universal "dead" glyph
    ctx.strokeStyle = rgba('#122430', Math.min(1, alpha + 0.15));
    ctx.lineWidth = Math.max(1.2, L * 0.05);
    const ex = halfL * 0.6, ey = -halfH * 0.22, er = Math.max(2, L * 0.09);
    ctx.beginPath();
    ctx.moveTo(ex - er, ey - er); ctx.lineTo(ex + er, ey + er);
    ctx.moveTo(ex + er, ey - er); ctx.lineTo(ex - er, ey + er);
    ctx.stroke();
    ctx.restore();

    // rising motes
    for (let i = 0; i < 6; i += 1) {
      const pt = clamp(t * 1.25 - i * 0.05, 0, 1);
      if (pt <= 0 || pt >= 1) continue;
      const px = fx.x + Math.sin(fx.seed + i * 2.1 + pt * 5) * (8 + i * 3);
      const py = fx.y - pt * (70 + i * 9);
      ctx.fillStyle = rgba('#d8f5ee', (1 - pt) * 0.55);
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + (i % 3) * 0.7, 0, 6.283);
      ctx.fill();
    }

    // nutrient wisps sinking to the substrate — 营养回收给水草
    for (let i = 0; i < 4; i += 1) {
      const pt = clamp(t * 1.15 - i * 0.07, 0, 1);
      if (pt <= 0 || pt >= 1) continue;
      const px = fx.x + (i - 1.5) * 14 + Math.sin(pt * 6 + i) * 6;
      const py = fx.y + pt * (WORLD.floor - fx.y);
      ctx.fillStyle = rgba(COLORS.plant, (1 - pt) * 0.5);
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
    return false;
  }

  function drawBirthFx(ctx, fx) {
    const DUR = 80;
    if (fx.f >= DUR) return true;
    const t = fx.f / DUR;
    const col = COLORS[fx.species] || COLORS.message;
    ctx.save();
    // soft glow
    const glow = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, 34);
    glow.addColorStop(0, rgba('#fdfff2', (1 - t) * 0.25));
    glow.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, 34, 0, 6.283);
    ctx.fill();
    // double expanding rings
    for (let k = 0; k < 2; k += 1) {
      const rt = clamp(t * 1.5 - k * 0.22, 0, 1);
      if (rt <= 0 || rt >= 1) continue;
      const ease = 1 - Math.pow(1 - rt, 3);
      ctx.strokeStyle = rgba(col, (1 - rt) * 0.75);
      ctx.lineWidth = 2 - k * 0.7;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 5 + ease * (26 + k * 14), 0, 6.283);
      ctx.stroke();
    }
    // sparkles bursting outward
    for (let i = 0; i < 8; i += 1) {
      const pt = clamp(t * 1.4 - (i % 4) * 0.04, 0, 1);
      if (pt <= 0 || pt >= 1) continue;
      const ease = 1 - Math.pow(1 - pt, 2.4);
      const a = fx.seed + (i / 8) * 6.283;
      const px = fx.x + Math.cos(a) * ease * 30;
      const py = fx.y + Math.sin(a) * ease * 24 - pt * 6;
      const r = 1.4 + (i % 3) * 0.7;
      ctx.fillStyle = rgba(i % 2 ? '#fdfff2' : col, (1 - pt) * 0.85);
      ctx.beginPath();
      ctx.arc(px, py, r * (1 - pt * 0.5), 0, 6.283);
      ctx.fill();
    }
    // child id chip rising
    if (fx.label) {
      const la = t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.55) / 0.45;
      const ly = fx.y - 26 - t * 16;
      ctx.font = '600 13px "JetBrains Mono", monospace';
      const tw = ctx.measureText(fx.label).width;
      ctx.globalAlpha = clamp(la, 0, 1);
      ctx.fillStyle = rgba('#03141b', 0.88);
      roundRectPath(ctx, fx.x - tw / 2 - 8, ly - 15, tw + 16, 21, 5);
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = mix(col, '#ffffff', 0.5);
      ctx.fillText(fx.label, fx.x - tw / 2, ly);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    return false;
  }

  /* ---------- foreground atmosphere ---------- */
  function drawBubbles(ctx, F) {
    if (!world.__bubbles) world.__bubbles = [];
    const b = world.__bubbles;
    if (b.length < 26 && F % 6 === 0) {
      b.push({ x: Math.random() * WORLD.width, y: WORLD.floor - 10, r: 1.5 + Math.random() * 3.5, vy: 0.5 + Math.random() * 0.9, ph: Math.random() * 6.28 });
    }
    ctx.save();
    for (let i = b.length - 1; i >= 0; i -= 1) {
      const bb = b[i];
      bb.y -= bb.vy;
      bb.x += Math.sin(F * 0.05 + bb.ph) * 0.4;
      if (bb.y < WORLD.waterTop + 4) { b.splice(i, 1); continue; }
      ctx.strokeStyle = rgba('#d9fff8', 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bb.x, bb.y, bb.r, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.25);
      ctx.beginPath();
      ctx.arc(bb.x - bb.r * 0.3, bb.y - bb.r * 0.3, bb.r * 0.35, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCausticSurface(ctx, F) {
    // faint moving light caustics near the surface, additive
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i += 1) {
      const x = (i / 7) * WORLD.width + Math.sin(F * 0.02 + i) * 50;
      const w = 90 + Math.sin(i * 2) * 30;
      const g = ctx.createRadialGradient(x, WORLD.waterTop + 8, 0, x, WORLD.waterTop + 8, w);
      g.addColorStop(0, rgba('#bff6ee', 0.05));
      g.addColorStop(1, rgba('#bff6ee', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, WORLD.waterTop + 8, w, 22, 0, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(WORLD.width / 2, WORLD.height / 2, WORLD.height * 0.35, WORLD.width / 2, WORLD.height / 2, WORLD.height * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(3,10,16,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }

  function renderAll() {
    syncControls();
    renderMetrics();
    updateZoomHud();
    renderAgentSelect();
    renderSelected();
    renderScript();
    renderEvents();
    renderPopulation();
    renderBt();
    renderBlackboard();
    renderSearch();
    renderCommunication();
    renderTechMap();
    renderFigures();
    renderRelationshipGraph();
  }

  function renderRelationshipGraph() {
    if (!ui.relationshipGraph) return;
    const N = {
      food: { x: 52, y: 46, label: tr("浮游", "Plankton"), c: COLORS.food, r: 12 },
      louse: { x: 176, y: 40, label: tr("鱼虱", "Louse"), c: COLORS.louse, r: 14 },
      bigfish: { x: 292, y: 68, label: tr("大鱼", "Big fish"), c: COLORS.bigfish, r: 21 },
      cleaner: { x: 292, y: 172, label: tr("清洁鱼", "Cleaner"), c: COLORS.cleaner, r: 16 },
      smallfish: { x: 184, y: 134, label: tr("小鱼", "Small fish"), c: COLORS.smallfish, r: 17 },
      shrimp: { x: 100, y: 202, label: tr("虾米", "Shrimp"), c: COLORS.shrimp, r: 15 },
      snail: { x: 214, y: 236, label: tr("螺", "Snail"), c: COLORS.snail, r: 15 },
      plant: { x: 74, y: 244, label: tr("水草", "Plants"), c: COLORS.plant, r: 15 },
    };
    const edges = [
      ["bigfish", "smallfish", "predation", true],
      ["smallfish", "shrimp", "predation", true],
      ["smallfish", "food", "predation", true],
      ["shrimp", "plant", "predation", true],
      ["snail", "plant", "predation", true],
      ["cleaner", "louse", "predation", true],
      ["cleaner", "food", "predation", true],
      ["louse", "bigfish", "parasitism", true],
      ["louse", "smallfish", "parasitism", true],
      ["cleaner", "bigfish", "mutualism", false],
      ["cleaner", "smallfish", "mutualism", false],
      ["shrimp", "snail", "competition", false],
    ];
    const coopNodes = ["bigfish", "smallfish", "shrimp"];
    const W = 340, H = 288;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${tr("物种关系网络", "Species interaction network")}">`;

    // edges
    edges.forEach(([from, to, type, directed]) => {
      const a = N[from], b = N[to];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const sx = a.x + ux * a.r, sy = a.y + uy * a.r;
      const ex = b.x - ux * (b.r + (directed ? 6 : 0)), ey = b.y - uy * (b.r + (directed ? 6 : 0));
      const nx = -uy, ny = ux;
      const bow = type === "predation" ? 8 : 16;
      const mx = (sx + ex) / 2 + nx * bow, my = (sy + ey) / 2 + ny * bow;
      const col = REL_COLORS[type];
      const isRel = type !== "predation";
      const dash = type === "competition" ? 'stroke-dasharray="4 3"' : "";
      svg += `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${isRel ? 2.4 : 1.3}" stroke-opacity="${isRel ? 0.9 : 0.4}" ${dash} stroke-linecap="round" />`;
      if (directed) {
        const ang = Math.atan2(ey - my, ex - mx);
        const s = 5.5;
        const p1x = ex - Math.cos(ang - 0.5) * s, p1y = ey - Math.sin(ang - 0.5) * s;
        const p2x = ex - Math.cos(ang + 0.5) * s, p2y = ey - Math.sin(ang + 0.5) * s;
        svg += `<path d="M${ex.toFixed(1)} ${ey.toFixed(1)} L${p1x.toFixed(1)} ${p1y.toFixed(1)} L${p2x.toFixed(1)} ${p2y.toFixed(1)} Z" fill="${col}" fill-opacity="${isRel ? 0.95 : 0.5}" />`;
      }
    });

    // cooperation self-loops (种内合作)
    coopNodes.forEach((k) => {
      const n = N[k];
      const lx = n.x, ly = n.y - n.r - 3;
      svg += `<circle cx="${lx}" cy="${ly - 5}" r="7" fill="none" stroke="${REL_COLORS.cooperation}" stroke-width="1.6" stroke-dasharray="3 2.5" />`;
    });

    // nodes with live counts
    Object.entries(N).forEach(([k, n]) => {
      const count = k === "plant" ? Math.round(totalPlantBiomass() / 100) : k === "food" ? world.food.length : countSpecies(k);
      svg += `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}" fill-opacity="0.9" stroke="#06121a" stroke-width="1.5" />`;
      svg += `<text x="${n.x}" y="${n.y + 1}" text-anchor="middle" dominant-baseline="middle" font-family="'Noto Serif SC',serif" font-size="11" font-weight="700" fill="#06121a">${n.label}</text>`;
      svg += `<text x="${n.x}" y="${n.y + n.r + 11}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="10" fill="#9aa">${count}</text>`;
    });
    svg += `</svg>`;

    const legend = [
      [tr("共生", "Mutualism"), "mutualism", world.counters.mutualism],
      [tr("寄生", "Parasitism"), "parasitism", world.counters.parasitism],
      [tr("竞争", "Competition"), "competition", world.counters.competition],
      [tr("合作", "Cooperation"), "cooperation", world.counters.cooperation],
      [tr("捕食", "Predation"), "predation", world.counters.eaten],
    ].map(([label, type, n]) =>
      `<span class="rel-key"><span class="swatch" style="background:${REL_COLORS[type]}"></span>${label}<b>${n}</b></span>`
    ).join("");

    ui.relationshipGraph.innerHTML = `<div class="rel-graph-svg">${svg}</div><div class="rel-legend">${legend}</div>`;
  }

  function renderMetrics() {
    const values = [
      ["Tick", world.tick],
      [tr("大鱼", "Big fish"), countSpecies("bigfish")],
      [tr("小鱼", "Small fish"), countSpecies("smallfish")],
      [tr("虾米", "Shrimp"), countSpecies("shrimp")],
      [tr("螺", "Snail"), countSpecies("snail")],
      [tr("清洁鱼", "Cleaners"), countSpecies("cleaner")],
      [tr("鱼虱", "Lice"), countSpecies("louse")],
      [tr("水草", "Plants"), Math.round(totalPlantBiomass() / 100)],
      [tr("共生", "Mutualism"), world.counters.mutualism],
      [tr("寄生", "Parasitism"), world.counters.parasitism],
      [tr("竞争", "Competition"), world.counters.competition],
      [tr("合作", "Cooperation"), world.counters.cooperation],
    ];
    ui.metricStrip.innerHTML = values
      .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
      .join("");
  }

  function renderAgentSelect() {
    const alive = world.organisms.filter((agent) => agent.alive);
    if (!alive.some((agent) => agent.id === selectedId)) selectedId = alive[0]?.id || "";
    ui.agentSelect.innerHTML = alive
      .map((agent) => `<option value="${agent.id}">${agent.id} ${SPECIES[agent.species].label}</option>`)
      .join("");
    ui.agentSelect.value = selectedId;
  }

  function renderSelected() {
    const agent = getAgent(selectedId);
    if (!agent) {
      ui.selectedName.textContent = tr("未选择", "None selected");
      ui.selectedSummary.innerHTML = tr("<p>点击生态缸中的个体，或从下拉框选择。</p>", "<p>Click an organism in the tank, or pick one from the dropdown.</p>");
      return;
    }
    ui.selectedName.textContent = `${agent.id} ${SPECIES[agent.species].label}`;
    const spec = SPECIES[agent.species];
    ui.selectedSummary.innerHTML = `
      <div class="chip-list">
        <span class="chip live">${agent.action.label}</span>
        <span class="chip">${agent.sex === "F" ? "female" : "male"}</span>
        <span class="chip">age ${agent.age}</span>
      </div>
      ${barRow("energy", agent.energy / spec.maxEnergy, COLORS.green)}
      ${barRow("hunger", agent.emotion.hunger, COLORS.amber)}
      ${barRow("fear", agent.emotion.fear, COLORS.red)}
      ${barRow("social", agent.emotion.social, COLORS.blue)}
      <p>knowledge: ${agent.knowledge.length} | mailbox: ${agent.mailbox.length} | buffer: ${agent.buffer.length}</p>
      <p>weights: plan ${agent.weights.plan.toFixed(2)} / risk ${agent.weights.risk.toFixed(2)} / time ${agent.weights.time.toFixed(2)}</p>
    `;
  }

  function renderScript() {
    const phase = world.script.phase;
    const steps = [
      tr("Emotional BT: 饥饿和恐惧改变优先级", "Emotional BT: hunger and fear reshape priorities"),
      tr("EDBT: hard danger 抢占当前行为", "EDBT: hard danger preempts the current behavior"),
      tr("MCTS: rollout 评估捕食和逃逸", "MCTS: rollouts evaluate hunting vs fleeing"),
      tr("Dec-MCTS: 同类共享意图分布", "Dec-MCTS: conspecifics share intention distributions"),
      tr("Dec-SGTS + EBU: 子目标和缓存知识", "Dec-SGTS + EBU: subgoals and buffered knowledge"),
    ];
    ui.scriptPanel.innerHTML = steps
      .map((step, index) => `<div class="script-step ${world.script.active && phase === index ? "active" : ""}">${index + 1}. ${step}</div>`)
      .join("");
  }

  function renderEvents() {
    ui.eventFeed.innerHTML = world.events
      .slice(-16)
      .reverse()
      .map((event) => `<div class="event-line"><strong>${event.tick}</strong><span>${event.type}: ${event.text}</span></div>`)
      .join("");
  }

  function renderPopulation() {
    const rows = Object.entries(SPECIES)
      .map(([species, spec]) => {
        const count = countSpecies(species);
        const limit = spec.birthLimit;
        return `<div class="species-row"><span>${spec.label}</span><span class="bar"><span class="bar-fill" style="width:${Math.min(100, (count / limit) * 100)}%; background:${COLORS[species]}"></span></span><span>${count}/${limit}</span></div>`;
      })
      .join("");
    ui.populationPanel.innerHTML = `
      ${rows}
      <div class="data-row"><span>${tr("水草", "Plants")}</span><span class="bar"><span class="bar-fill" style="width:${Math.min(100, world.plants.length * 2.8)}%; background:${COLORS.plant}"></span></span><span>${world.plants.length}</span></div>
      <p>${tr("生命周期会让能量、年龄、繁殖冷却、死亡营养回收进入行为树决策。", "Lifecycle feeds energy, age, mating cooldown and death recycling into behavior-tree decisions.")}</p>
    `;
  }

  function renderBt() {
    const agent = getAgent(selectedId);
    if (!agent) {
      ui.btTree.innerHTML = tr("<p>无选中个体。</p>", "<p>No agent selected.</p>");
      return;
    }
    const rows = [
      ["Root Selector", 0],
      ["Service: checkMailbox", 14],
      ["RH: Event Handler", 28],
      ["Critical Survival Sequence", 28],
      ["Emotional Selector", 14],
      ["Search Policy", 14],
      ["Tmod: Knowledge Transfer", 14],
      ["Lifecycle Sequence", 14],
      ["Action Manager", 14],
    ];
    ui.btTree.innerHTML = rows
      .map(([name, indent]) => {
        const status = agent.bt[name] || STATUS.idle;
        return `<div class="tree-row" style="--indent:${indent + 8}px"><span>${name}</span><span class="status ${status}">${status}</span></div>`;
      })
      .join("");
  }

  function renderBlackboard() {
    const agent = getAgent(selectedId);
    if (!agent) {
      ui.blackboardPanel.innerHTML = tr("<p>无选中个体。</p>", "<p>No agent selected.</p>");
      return;
    }
    const facts = agent.knowledge
      .slice(-8)
      .map((fact) => `<tr><td>${fact.kind}</td><td>${fact.targetId}</td><td>${fact.source}</td><td>${fact.ttl}</td></tr>`)
      .join("");
    ui.blackboardPanel.innerHTML = `
      <div class="blackboard-grid">
        <div class="mini-panel">
          <h3>Blackboard</h3>
          ${Object.entries(agent.blackboard)
            .map(([key, value]) => `<div class="data-row"><span>${key}</span><span class="mono">${formatValue(value)}</span><span></span></div>`)
            .join("")}
        </div>
        <div class="mini-panel">
          <h3>Emotion Selector</h3>
          ${barRow("hunger", agent.emotion.hunger, COLORS.amber)}
          ${barRow("fear", agent.emotion.fear, COLORS.red)}
          ${barRow("curiosity", agent.emotion.curiosity, COLORS.teal)}
          ${barRow("social", agent.emotion.social, COLORS.blue)}
          <p>plan ${agent.weights.plan.toFixed(2)} | risk ${agent.weights.risk.toFixed(2)} | time ${agent.weights.time.toFixed(2)}</p>
        </div>
        <div class="mini-panel">
          <h3>Knowledge Facts</h3>
          <table class="table"><thead><tr><th>kind</th><th>target</th><th>source</th><th>ttl</th></tr></thead><tbody>${facts || "<tr><td colspan='4'>empty</td></tr>"}</tbody></table>
        </div>
        <div class="mini-panel">
          <h3>Lifecycle</h3>
          <p>age ${agent.age}, energy ${agent.energy.toFixed(1)}, birth cooldown ${agent.birthCooldown}</p>
          <p>${tr("死亡会转为附近水草营养；繁殖会降低父母能量并生成幼体。", "Death becomes nutrients for nearby plants; reproduction drains parent energy and spawns young.")}</p>
        </div>
      </div>
    `;
  }

  function renderSearch() {
    const agent = getAgent(selectedId);
    if (!agent) {
      ui.searchPanel.innerHTML = tr("<p>无选中个体。</p>", "<p>No agent selected.</p>");
      return;
    }
    const rows = agent.searchRows
      .slice(0, 8)
      .map((row) => `<tr><td>${row.label}</td><td>${row.visits}</td><td>${row.value.toFixed(2)}</td></tr>`)
      .join("");
    const subgoals = agent.subgoals.length ? agent.subgoals.map((zone) => zone.label).join(" -> ") : "direct / none";
    const trace = agent.searchTrace
      ? Object.entries(agent.searchTrace).map(([key, value]) => `<p><strong>${key}</strong>: <span class="mono">${value}</span></p>`).join("")
      : tr("<p>等待下一次决策。</p>", "<p>Waiting for the next decision.</p>");
    const intentions = Object.entries(agent.intention || {})
      .map(([key, value]) => `<span class="chip live">${key}: ${value.toFixed(2)}</span>`)
      .join("");
    ui.searchPanel.innerHTML = `
      <div class="search-grid">
        <div class="mini-panel">
          <h3>${settings.search.toUpperCase()} samples</h3>
          <table class="table"><thead><tr><th>candidate</th><th>visits</th><th>value</th></tr></thead><tbody>${rows || "<tr><td colspan='3'>no samples</td></tr>"}</tbody></table>
        </div>
        <div class="mini-panel">
          <h3>Trace</h3>
          ${trace}
          <p>${tr("reward = 能量收益 - 距离成本 - 风险 - 意图冲突。", "reward = energy gain − distance cost − risk − intention conflict.")}</p>
        </div>
        <div class="mini-panel">
          <h3>Subgoal Route</h3>
          <p>${subgoals}</p>
          <p>${tr("Dec-SGTS 将连续水域压缩为子目标序列，再用 D-UCT 采样。", "Dec-SGTS compresses continuous water into a subgoal sequence, then samples it with D-UCT.")}</p>
        </div>
        <div class="mini-panel">
          <h3>Intention Distribution</h3>
          <div class="chip-list">${intentions || "<span class='chip'>empty</span>"}</div>
        </div>
      </div>
    `;
  }

  function renderCommunication() {
    const agent = getAgent(selectedId);
    const rows = world.organisms
      .filter((item) => item.alive)
      .slice(0, 12)
      .map((item) => {
        return `<tr><td>${item.id}</td><td>${item.mailbox.length}</td><td>${item.buffer.length}</td><td>${item.knowledge.length}</td><td>${item.action.type}</td></tr>`;
      })
      .join("");
    const peerIntentions = Object.entries(world.sharedIntentions[agent?.species || "smallfish"] || {})
      .slice(0, 6)
      .map(([id, dist]) => `<p>${id}: ${Object.entries(dist).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" | ")}</p>`)
      .join("");
    ui.communicationPanel.innerHTML = `
      <div class="communication-grid">
        <div class="mini-panel">
          <h3>Mode ${settings.comm.toUpperCase()}</h3>
          <p>${tr("QRA 查询响应；QRU 查询并更新；EU 窃听即更新；EBU 窃听进入 episodic buffer，知识缺口时合并。", "QRA query-response; QRU query & update; EU eavesdrop-and-update; EBU eavesdrops into an episodic buffer, merged when knowledge gaps appear.")}</p>
          <p>queries ${world.counters.queries} | eavesdrops ${world.counters.eavesdrops} | updates ${world.counters.knowledgeUpdates}</p>
        </div>
        <div class="mini-panel">
          <h3>Mailboxes / Buffers</h3>
          <table class="table"><thead><tr><th>agent</th><th>mail</th><th>buf</th><th>know</th><th>act</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <div class="mini-panel">
          <h3>ACL Messages</h3>
          ${world.messages.slice(-8).map((m) => `<p><span class="mono">${m.acl}</span></p>`).join("") || "<p>no live messages</p>"}
        </div>
        <div class="mini-panel">
          <h3>Shared Intentions</h3>
          ${peerIntentions || "<p>no shared intentions</p>"}
        </div>
      </div>
    `;
  }

  function renderTechMap() {
    const active = activeTechKeys();
    ui.techMap.innerHTML = TECH_POINTS.map((point) => {
      return `
        <article class="tech-card ${active.has(point.key) ? "active" : ""}">
          <h3>${point.title}</h3>
          <p>${point.body}</p>
          <div class="tag-row">${point.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        </article>
      `;
    }).join("");
  }

  function activeTechKeys() {
    const keys = new Set(["bt"]);
    if (settings.emotion) keys.add("emotion");
    if (settings.eventDriven) keys.add("edbt");
    if (settings.lifecycle) keys.add("life");
    if (settings.search === "mcts") keys.add("mcts");
    if (settings.search === "decmcts") keys.add("decmcts");
    if (settings.search === "decsgts") keys.add("decsgts");
    keys.add("ikt");
    if (world.activeTech) keys.add(world.activeTech);
    return keys;
  }

  function renderFigures() {
    ui.paperFigures.innerHTML = FIGURES.map(([file, caption]) => {
      return `<figure><img src="./assets/paper/${file}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`;
    }).join("");
  }

  function selectFromCanvas(event) {
    const rect = ui.canvas.getBoundingClientRect();
    const fit = canvasFit();
    const px = (event.clientX - rect.left) * (ui.canvas.width / rect.width);
    const py = (event.clientY - rect.top) * (ui.canvas.height / rect.height);
    const x = (px - fit.offsetX) / fit.scale;
    const y = (py - fit.offsetY) / fit.scale;
    const picked = world.organisms
      .filter((agent) => agent.alive)
      .map((agent) => ({ agent, d: distance(agent, { x, y }) }))
      .sort((a, b) => a.d - b.d)[0];
    if (picked && picked.d < SPECIES[picked.agent.species].size * 1.7) {
      selectedId = picked.agent.id;
      if (camera.follow) centerOnSelected();
      updateZoomHud();
      renderAll();
    }
  }

  /* =====================================================================
     RELATIONSHIP SYSTEMS — 共生 / 寄生 / 竞争 / 种内竞争 / 合作
     ===================================================================== */

  function addRelLink(a, b, type) {
    if (!world.relLinks) world.relLinks = [];
    world.relLinks.push({ from: a.id, to: b.id, type });
  }

  function nearestHost(agent, range) {
    return world.organisms
      .filter((o) => o.alive && HOST_SPECIES.includes(o.species) && distance(agent, o) <= range)
      .sort((x, y) => distance(agent, x) - distance(agent, y))[0] || null;
  }

  function nearestCleaner(agent, range) {
    return world.organisms
      .filter((o) => o.alive && o.species === "cleaner" && distance(agent, o) <= range)
      .sort((x, y) => distance(agent, x) - distance(agent, y))[0] || null;
  }

  function nearestParasitizedHost(agent, range) {
    return world.organisms
      .filter((o) => o.alive && o.parasiteLoad > 0 && HOST_SPECIES.includes(o.species) && distance(agent, o) <= range)
      .sort((x, y) => distance(agent, x) - distance(agent, y))[0] || null;
  }

  // ---- 寄生：鱼虱附着宿主、持续吸取能量、在体表繁殖 ----
  function handleParasitism(agent) {
    const spec = SPECIES[agent.species];
    if (!spec.parasite) return;

    if (agent.host) {
      const host = getAgent(agent.host);
      if (!host || !host.alive) { agent.host = null; return; }
      const drain = 0.05;
      host.energy = clamp(host.energy - drain, -4, SPECIES[host.species].maxEnergy);
      agent.energy = clamp(agent.energy + drain * 0.9, 0, spec.maxEnergy);
      addRelLink(agent, host, "parasitism");
      if (agent.energy > spec.spawnEnergy && agent.birthCooldown === 0 && countSpecies("louse") < spec.birthLimit) {
        const child = spawnOrganism("louse", {
          x: clamp(host.x + world.rng.range(-16, 16), SAFE_MARGIN, WORLD.width - SAFE_MARGIN),
          y: clamp(host.y + world.rng.range(-12, 12), WORLD.waterTop + 20, WORLD.floor - 12),
        }, { age: 0, energy: spec.maxEnergy * 0.4, birthCooldown: 150 });
        agent.energy *= 0.55;
        agent.birthCooldown = 160;
        world.counters.births += 1;
        logEvent("parasite", tr(`${agent.id} 在宿主 ${host.id} 体表繁殖 → ${child.id}`, `${agent.id} breeds on host ${host.id} → ${child.id}`));
      }
      return;
    }

    const host = nearestHost(agent, spec.size + 34);
    if (host && distance(agent, host) <= SPECIES[host.species].size + spec.size + 8) {
      agent.host = host.id;
      host.parasiteLoad = (host.parasiteLoad || 0) + 1;
      agent.relFlash = { type: "parasitism", f: 30 };
      host.relFlash = { type: "parasitism", f: 22 };
      world.counters.parasitism += 1;
      logEvent("parasite", tr(`${agent.id} 附着到 ${host.id}，宿主寄生负荷 ${host.parasiteLoad}`, `${agent.id} attaches to ${host.id}; host parasite load ${host.parasiteLoad}`));
    }
  }

  // ---- 共生：清洁鱼为宿主清除鱼虱，双方获益 ----
  function handleCleaning(agent) {
    const spec = SPECIES[agent.species];
    if (!spec.cleaner || agent.cleanCooldown > 0) return;
    const host = world.organisms.find((o) =>
      o.alive && o.parasiteLoad > 0 && HOST_SPECIES.includes(o.species) &&
      distance(agent, o) <= SPECIES[o.species].size + spec.size + 16);
    if (!host) return;
    const louse = world.organisms.find((o) => o.alive && o.species === "louse" && o.host === host.id);
    if (!louse) { host.parasiteLoad = 0; return; }
    kill(louse, `cleaned by ${agent.id}`);
    host.energy = clamp(host.energy + 5, -4, SPECIES[host.species].maxEnergy);
    agent.energy = clamp(agent.energy + 8, 0, spec.maxEnergy);
    agent.cleanCooldown = 26;
    agent.coopPulse = 12;
    agent.relFlash = { type: "mutualism", f: 26 };
    host.relFlash = { type: "mutualism", f: 26 };
    addRelLink(agent, host, "mutualism");
    world.counters.mutualism += 1;
    logEvent("mutualism", tr(`${agent.id} 为 ${host.id} 清除鱼虱 ${louse.id}（互利共生）`, `${agent.id} removes louse ${louse.id} from ${host.id} (mutualism)`));
  }

  function dominance(a) {
    const s = SPECIES[a.species];
    return s.size * 0.5 + (a.energy / s.maxEnergy) * 6 + clamp(a.age / s.matureAge, 0, 2) * 2 + world.rng.range(0, 2.5);
  }

  // ---- 竞争：争夺同一份食物/水草/配偶 —— 种内 vs 跨物种 ----
  function resolveContests(agents) {
    const contenders = agents.filter((a) => {
      const t = a.action && a.action.type;
      return a.contestCooldown === 0 && a.action && a.action.targetId &&
        (t === "graze" || t === "feed" || t === "seek-known-food" || t === "mate");
    });
    for (let i = 0; i < contenders.length; i += 1) {
      for (let j = i + 1; j < contenders.length; j += 1) {
        const a = contenders[i], b = contenders[j];
        if (a.contestCooldown > 0 || b.contestCooldown > 0) continue;
        if (a.action.targetId !== b.action.targetId) continue;
        if (distance(a, b) > 48) continue;
        const sameSpecies = a.species === b.species;
        const type = sameSpecies ? "intraspecific" : "competition";
        const winner = dominance(a) >= dominance(b) ? a : b;
        const loser = winner === a ? b : a;
        loser.energy = clamp(loser.energy - 2.2, -4, SPECIES[loser.species].maxEnergy);
        const away = normalize(loser.x - winner.x, loser.y - winner.y);
        loser.vx += away.x * 2.6;
        loser.vy += away.y * 1.9;
        loser.action = { type: "patrol", label: tr("竞争失利·让位", "Lost contest · yielding"), target: wanderTarget(loser), reward: 0, risk: 0.2, priority: 0 };
        loser.actionStarted = world.tick;
        loser.lastDecision = world.tick - DECISION_PERIOD;
        loser.contestCooldown = 42;
        winner.contestCooldown = 24;
        winner.relFlash = { type, f: 22 };
        loser.relFlash = { type, f: 22 };
        addRelLink(a, b, type);
        world.counters.competition += 1;
        pushFx({ type: "contest", f: 0, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: type, seed: Math.random() * 6.28 });
        const kindLabel = type === "intraspecific" ? tr("种内竞争", "intraspecific competition") : tr("跨物种竞争", "interspecific competition");
        logEvent("compete", tr(`${winner.id} 在争夺 ${a.action.targetId} 中胜过 ${loser.id}（${kindLabel}）`, `${winner.id} beats ${loser.id} in the contest over ${a.action.targetId} (${kindLabel})`));
      }
    }
  }

  // ---- 合作：同种捕食者围猎同一猎物时协同（收益共享在 handleEating） ----
  function handleCooperation(agents) {
    const hunters = agents.filter((a) => a.action && a.action.type === "hunt" && a.action.targetId &&
      (a.species === "bigfish" || a.species === "smallfish"));
    const groups = {};
    hunters.forEach((a) => {
      const key = a.action.targetId + ":" + a.species;
      (groups[key] || (groups[key] = [])).push(a);
    });
    Object.values(groups).forEach((group) => {
      if (group.length < 2) return;
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i], b = group[j];
          if (distance(a, b) > 230) continue;
          a.coopPulse = Math.max(a.coopPulse, 10);
          b.coopPulse = Math.max(b.coopPulse, 10);
          addRelLink(a, b, "cooperation");
        }
      }
    });
  }

  // ---- 合作防御：猎物成群围攻捕食者，将其驱离 ----
  function handleMobbing(agents) {
    agents.forEach((pred) => {
      if (pred.species !== "bigfish" && pred.species !== "smallfish") return;
      const preyTypes = SPECIES[pred.species].prey.filter((t) => SPECIES[t]);
      if (!preyTypes.length) return;
      const mob = agents.filter((o) => o.alive && preyTypes.includes(o.species) && distance(pred, o) < 98);
      if (mob.length < 4) return;
      pred.mobbedTicks = 20;
      pred.energy = clamp(pred.energy - 0.06, -4, SPECIES[pred.species].maxEnergy);
      const cx = mob.reduce((s, o) => s + o.x, 0) / mob.length;
      const cy = mob.reduce((s, o) => s + o.y, 0) / mob.length;
      const away = normalize(pred.x - cx, pred.y - cy);
      pred.vx += away.x * 1.3;
      pred.vy += away.y * 1.0;
      pred.relFlash = { type: "cooperation", f: 18 };
      mob.slice(0, 7).forEach((o) => { o.coopPulse = Math.max(o.coopPulse, 9); addRelLink(o, pred, "cooperation"); });
      if (world.tick % 24 === 0) {
        world.counters.cooperation += 1;
        logEvent("mob", tr(`${mob.length} 只${SPECIES[mob[0].species].label}围攻 ${pred.id}（合作防御驱离捕食者）`, `${mob.length} ${SPECIES[mob[0].species].label} mob ${pred.id} (cooperative defense drives the predator off)`));
      }
    });
  }

  function findPredators(agent, range) {
    const predators = SPECIES[agent.species].predators;
    return world.organisms
      .filter((other) => other.alive && predators.includes(other.species) && distance(agent, other) <= range)
      .sort((a, b) => distance(agent, a) - distance(agent, b));
  }

  function findPrey(agent, range) {
    const preyTypes = SPECIES[agent.species].prey;
    const items = [];
    world.organisms.forEach((other) => {
      if (other.species === "louse" && other.host) return; // attached lice are handled by cleaning, not predation
      if (other.alive && preyTypes.includes(other.species) && !shouldSparePrey(agent, other) && distance(agent, other) <= range) {
        items.push({ ...other, kind: other.species, value: SPECIES[other.species].calories / 10 });
      }
    });
    if (preyTypes.includes("plant")) {
      world.plants.forEach((plant) => {
        if (plant.biomass > 8 && distance(agent, plant) <= range) items.push({ ...plant, kind: "plant", value: plant.biomass / 22 });
      });
    }
    if (preyTypes.includes("food")) {
      world.food.forEach((food) => {
        if (distance(agent, food) <= range) items.push({ ...food, kind: "food", value: food.energy / 10 });
      });
    }
    return items.sort((a, b) => distance(agent, a) - distance(agent, b));
  }

  function findMate(agent) {
    const spec = SPECIES[agent.species];
    if (agent.age < spec.matureAge) return null;
    return world.organisms
      .filter((other) => {
        return other.alive && other.id !== agent.id && other.species === agent.species && other.sex !== agent.sex && other.age >= spec.matureAge;
      })
      .sort((a, b) => distance(agent, a) - distance(agent, b))[0] || null;
  }

  function shouldSparePrey(agent, prey) {
    const minimum = ECO_MINIMUMS[prey.species];
    if (!minimum) return false;
    if (countSpecies(prey.species) > minimum) return false;
    return agent.emotion.hunger < 0.82;
  }

  function findNeighbors(agent, species, range) {
    return world.organisms.filter((other) => {
      return other.alive && other.id !== agent.id && other.species === species && distance(agent, other) <= range;
    });
  }

  function nearestPlants(point, limit) {
    return [...world.plants].sort((a, b) => distance(point, a) - distance(point, b)).slice(0, limit);
  }

  function factsByKind(agent, kind) {
    return agent.knowledge.filter((fact) => fact.kind === kind).sort((a, b) => b.ttl - a.ttl);
  }

  function actionLabel(action) {
    return { hunt: tr("追捕", "chase"), graze: tr("啃食", "graze"), feed: tr("进食", "feed") }[action] || action;
  }

  function foodValue(agent, target) {
    if (target.kind === "plant") return target.biomass / 4;
    if (target.kind === "food") return target.energy * (agent.species === "smallfish" ? 0.74 : 1);
    if (target.species) {
      const base = SPECIES[target.species].calories;
      if (agent.species === "smallfish" && target.species === "shrimp") return base * 1.35;
      if (agent.species === "bigfish" && target.species === "smallfish") return base * 1.18;
      return base;
    }
    return 8;
  }

  function localRisk(agent, target) {
    return predatorRiskAt(agent, target) + (nearestZone(target)?.risk || 0.3) * 0.35;
  }

  function predatorRiskAt(agent, point) {
    return world.organisms
      .filter((other) => other.alive && SPECIES[agent.species].predators.includes(other.species))
      .reduce((risk, predator) => {
        const d = distance(point, predator);
        return risk + clamp((210 - d) / 210, 0, 1) * 0.85;
      }, 0);
  }

  function intentionConflict(agent, candidate) {
    const key = candidate.targetId || candidate.type;
    const peers = world.sharedIntentions[agent.species] || {};
    return Object.entries(peers).reduce((sum, [id, dist]) => {
      if (id === agent.id) return sum;
      return sum + (dist[key] || 0) * 5.5;
    }, 0);
  }

  function fleeTarget(agent, source) {
    const danger = source.x != null ? source : { x: source.x || WORLD.width / 2, y: source.y || WORLD.height / 2 };
    if (agent.species !== "bigfish" && distance(agent, zoneCenter("cave")) < 260) return zoneCenter("cave");
    const dx = agent.x - danger.x;
    const dy = agent.y - danger.y;
    const dir = normalize(dx, dy || 0.01);
    return {
      x: clamp(agent.x + dir.x * 190, SAFE_MARGIN, WORLD.width - SAFE_MARGIN),
      y: clamp(agent.y + dir.y * 120, WORLD.waterTop + SAFE_MARGIN, WORLD.floor - SAFE_MARGIN),
    };
  }

  function schoolTarget(agent) {
    const neighbors = findNeighbors(agent, agent.species, 180);
    if (!neighbors.length) return wanderTarget(agent);
    const center = neighbors.reduce((acc, other) => ({ x: acc.x + other.x, y: acc.y + other.y }), { x: agent.x, y: agent.y });
    return { x: center.x / (neighbors.length + 1), y: center.y / (neighbors.length + 1) };
  }

  function schoolingVector(agent) {
    const neighbors = findNeighbors(agent, agent.species, 82);
    if (!neighbors.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    neighbors.forEach((other) => {
      const d = Math.max(1, distance(agent, other));
      sx += (agent.x - other.x) / (d * d);
      sy += (agent.y - other.y) / (d * d);
    });
    return normalize(sx, sy);
  }

  function choosePatrolZone(agent) {
    let zones = ZONES;
    if (agent.species === "shrimp") zones = ZONES.filter((zone) => zone.food || zone.safety);
    if (agent.species === "bigfish") zones = ZONES.filter((zone) => zone.id !== "cave" && zone.id !== "nursery");
    const scored = zones.map((zone) => {
      const center = zoneCenter(zone.id);
      const score = distance(agent, center) - (zone.food || 0) * 70 - (zone.safety || 0) * agent.emotion.fear * 90 + world.rng.range(0, 80);
      return { center, score };
    });
    return scored.sort((a, b) => a.score - b.score)[0].center;
  }

  function wanderTarget(agent) {
    return {
      x: clamp(agent.x + agent.dir * world.rng.range(34, 120), SAFE_MARGIN, WORLD.width - SAFE_MARGIN),
      y: clamp(agent.y + world.rng.range(-65, 65), WORLD.waterTop + SAFE_MARGIN, WORLD.floor - SAFE_MARGIN),
    };
  }

  function resolveTarget(id, kind) {
    if (!id) return null;
    if (kind === "plant" || id.startsWith("P")) return world.plants.find((plant) => plant.id === id && plant.biomass > 0);
    if (kind === "food" || id.startsWith("D")) return world.food.find((food) => food.id === id && food.energy > 0);
    return world.organisms.find((agent) => agent.id === id && agent.alive);
  }

  function resolveAnyTarget(key) {
    if (!key) return null;
    return world.organisms.find((agent) => agent.id === key && agent.alive)
      || world.plants.find((plant) => plant.id === key)
      || world.food.find((food) => food.id === key)
      || zoneById(key)
      || null;
  }

  function nearestZone(point) {
    return [...ZONES].sort((a, b) => distance(point, zoneCenter(a.id)) - distance(point, zoneCenter(b.id)))[0] || null;
  }

  function zoneById(id) {
    return ZONES.find((zone) => zone.id === id) || null;
  }

  function zoneCenter(id) {
    const zone = zoneById(id);
    return zone ? { x: zone.x, y: zone.y, id: zone.id, label: zone.label } : { x: WORLD.width / 2, y: WORLD.height / 2 };
  }

  function countSpecies(species) {
    return world.organisms.filter((agent) => agent.alive && agent.species === species).length;
  }

  function getAgent(id) {
    return world.organisms.find((agent) => agent.id === id);
  }

  function constrainAgent(agent) {
    if (agent.x < SAFE_MARGIN || agent.x > WORLD.width - SAFE_MARGIN) {
      agent.vx *= -0.55;
      agent.x = clamp(agent.x, SAFE_MARGIN, WORLD.width - SAFE_MARGIN);
      agent.dir *= -1;
    }
    if (agent.y < WORLD.waterTop + SAFE_MARGIN || agent.y > WORLD.floor - SAFE_MARGIN) {
      agent.vy *= -0.55;
      agent.y = clamp(agent.y, WORLD.waterTop + SAFE_MARGIN, WORLD.floor - SAFE_MARGIN);
    }
  }

  function setBt(agent, node, status) {
    agent.bt[node] = status;
  }

  function priorityRank(priority) {
    return priority === "hard" ? 10 : 1;
  }

  function usesIndirectCommunication() {
    return settings.comm === "eu" || settings.comm === "ebu";
  }

  function activeTab() {
    return ui.demoTab.classList.contains("active") ? "demo" : "monitor";
  }

  function logEvent(type, text) {
    world.events.push({ tick: world.tick, type, text });
    if (world.events.length > 120) world.events.shift();
  }

  function barRow(label, value, color) {
    const width = clamp(value, 0, 1) * 100;
    return `<div class="data-row"><span>${label}</span><span class="bar"><span class="bar-fill" style="width:${width}%; background:${color}"></span></span><span>${Math.round(width)}%</span></div>`;
  }

  function formatValue(value) {
    if (typeof value === "number") return value.toFixed(Math.abs(value) >= 10 ? 0 : 2);
    return String(value);
  }

  function distance(a, b) {
    return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
  }

  function normalize(x, y) {
    const length = Math.hypot(x, y);
    if (length < 0.0001) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function shade(hex, delta) {
    const clean = hex.replace("#", "");
    const n = Number.parseInt(clean, 16);
    const r = clamp(((n >> 16) & 255) + delta, 0, 255);
    const g = clamp(((n >> 8) & 255) + delta, 0, 255);
    const b = clamp((n & 255) + delta, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  window.addEventListener("beforeunload", () => cancelAnimationFrame(frameHandle));
})();
