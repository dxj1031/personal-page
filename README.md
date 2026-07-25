# Xiaojie Deng — Personal Page

Live: **https://dxj1031.github.io/personal-page/**

A personal homepage built as a single narrative: **game AI → behavior simulation →
cognition and emotion → multi-agent collective decision-making**. The chapters
trace one question I kept arriving at from different directions — *can a society
of flawed agents decide better than one rational agent?*

Two of the chapters are not screenshots. They link to demos you can actually run,
both in this repo.

## Demos

### Ch 01 · [EcoTank](https://dxj1031.github.io/personal-page/ecotank/)

An interactive multi-agent aquarium, written from scratch in HTML/CSS/JS with no
dependencies. It maps the technical path of *Coordination of NPCs in Multi-Agent
Systems Based on Behavior Trees* onto something you can watch and poke at.

- **Behavior Trees for structure, MCTS for look-ahead** — per-agent decisions under
  uncertainty, coordinated into world-level emergent behavior.
- Eight species with predation, parasitism, mutualist cleaning, resource
  competition, cooperative hunting and group defense.
- Full lifecycle: energy, age, reproduction, death, nutrient recycling.
- Inspectable runtime — behavior-tree state, blackboard, emotion, local knowledge,
  MCTS samples, mailbox queue and the relationship graph are all live panels.
- Visualization layers for perception range, messages, sub-goals and intent;
  canvas zoom/pan/follow; run, pause, step, reset and a five-stage guided script.

The simulation lives in [`ecotank/ecotank.js`](ecotank/ecotank.js) — perception,
decision, communication, relationships and rendering. See
[`ecotank/README.md`](ecotank/README.md) for the loop breakdown.

### Ch 03 · [The Ministers](https://dxj1031.github.io/personal-page/ministers/)

*My Ministers* — a society of eleven LLM agents that argue their way to a
collective decision, framed as a daily courtroom comedy. Everyday dilemmas
("should I quit without a plan?") go to the floor, the ministers deliberate in
character, and the court rules.

This page is the product prototype: cast, petition, debate, intervention and
verdict screens, ZH/EN. It's the interaction design and the deliberation shape —
the agent backend is a separate work in progress and not published here yet.

## Stack

Static, no build step, no package manager. Clone it and open `index.html`.

- The homepage is a self-contained bundle — fonts and scripts are inlined, so it
  renders offline once loaded.
- The Ministers page runs on a small component runtime (`ministers/support.js`,
  generated) and pulls React from a CDN at load time, so it needs network.
- Deployed straight from `main` by GitHub Pages.

```text
personal-page/
├─ index.html          # homepage — the narrative, chapter interactions, canvas scenes
├─ ecotank/            # Ch 01 demo
│  ├─ index.html
│  ├─ ecotank.css
│  ├─ ecotank.js       # simulation, decision, communication, rendering
│  └─ assets/paper/    # figures from the source paper
└─ ministers/          # Ch 03 demo
   ├─ index.html
   └─ support.js       # component runtime (generated)
```

## Contact

xdeng713@usc.edu · [GitHub](https://github.com/dxj1031) ·
[LinkedIn](https://www.linkedin.com/in/xiaojie-deng-103100dxj/)
