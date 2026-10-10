# Xiaojie Deng — Personal Page

Live: **https://dxj1031.github.io/personal-page/**

Xiaojie Deng, AI Agent Engineer and M.S. Computer Engineering student at USC.
I build LLM agents together with the evaluation and fallbacks that make them
trustworthy. My way in was game AI: I am co-first author of a review on
behavior-tree NPC coordination (Applied and Computational Engineering, 2024).

This page is a scroll-driven narrative through my side projects. Each one is
labelled for what it is: a teaching demo, a one-day prototype, or a local
prototype. None of them is a reproduced research result.

## Demos

### [EcoTank](https://dxj1031.github.io/personal-page/ecotank/) — AI-assisted interactive teaching demo

An interactive multi-agent aquarium built on *Coordination of NPCs in Multi-Agent
Systems Based on Behavior Trees*, a review paper I co-authored as co-first
author. I designed the concept, interaction flow, visual explanations and
evaluation scenarios, then tested and refined the implementation, which was
written with AI assistance.

The demo uses heuristic approximations to visualize selected concepts from the
review. It is **not** a reproduction of the reviewed algorithms:

- the behavior tree is a teaching state mapping, not a general BT runtime;
- "MCTS" is MCTS-style candidate sampling, not a full search tree;
- MDP / MMDP / Dec-POMDP are described, not formally implemented.

What you can do with it: watch eight species interact (predation, cleaning,
competition, group defense), inspect each agent's state, blackboard and messages
in live panels, and step through a five-stage guided script. See
[`ecotank/README.md`](ecotank/README.md) for the mechanism-by-mechanism mapping
and its limits.

### [The Ministers](https://dxj1031.github.io/personal-page/ministers/) — local prototype

Eleven LLM "ministers" debate an everyday dilemma you file, live, and you rule
on it: cast, petition, debate, intervention and verdict, in ZH/EN. Code decides
who clashes, who lobbies whom and who defects; the model (qwen2.5:14b on Ollama)
only writes the lines.

The backend (`ministers/server/`) runs on my own desktop and is reached through
a Cloudflare quick tunnel, so the live court is only open while that machine is
on. When it is not, the page plays a scripted demo instead. The
[console](ministers/console.html) shows every LLM call, latency and fallback.
There is no evaluation of decision quality yet.

### Early prototypes (not linked here)

State Tides: a one-day product prototype exploring how an LLM API can structure
reflective journal entries, built with synthetic data and a heuristic fallback.
Not a clinical or research system.

## Stack

Static, no build step, no package manager. Clone it and open `index.html`.

- The homepage is a self-contained bundle — fonts and scripts are inlined, so it
  renders offline once loaded.
- The Ministers page runs on a small component runtime (`ministers/support.js`,
  generated) and pulls React from a CDN at load time, so it needs network.
- The Ministers backend is Python (FastAPI + SQLite + Ollama). Start it with
  `powershell -ExecutionPolicy Bypass -File ministers\server\serve.ps1`, which
  opens the tunnel and pushes its address into the pages' `ministers-api` meta.
  `python ministers/server/test_court.py` runs a whole court with no model.
- Deployed straight from `main` by GitHub Pages.

```text
personal-page/
├─ index.html          # homepage — the narrative, chapter interactions, canvas scenes
├─ ecotank/            # EcoTank demo
│  ├─ index.html
│  ├─ ecotank.css
│  ├─ ecotank.js       # simulation, decision, communication, rendering
│  └─ assets/paper/    # figures from the source paper
└─ ministers/          # The Ministers
   ├─ index.html
   ├─ console.html     # observability: calls, latency, retrieval
   ├─ support.js       # component runtime (generated)
   └─ server/          # backend: app.py, court.py, llm.py, store.py, serve.ps1
```

## Contact

xdeng713@usc.edu · [GitHub](https://github.com/dxj1031) ·
[LinkedIn](https://www.linkedin.com/in/xiaojie-deng-103100dxj/)
