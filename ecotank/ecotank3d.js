/* =========================================================================
   EcoTank · bioluminescent ecosphere
   -------------------------------------------------------------------------
   A ball of near-black water. Nothing in here is lit by a lamp — every
   organism, blade and mote is its own emitter, and bloom does the rest.

   The ball is polar: light enters at the top pole, and the bottom pole is a
   rocky seabed cap. The simulation in ecotank.js stays strictly 2D:

     tank x   -> longitude  (0..2pi; the two side walls meet at the seam)
     tank y   -> latitude   (waterTop = lit pole, floor = seabed cap)
     vis.z    -> radius     (render-only axis, advected in ecotank.js)

   Depth is latitude rather than radius so the sphere has an actual top and
   bottom: swim up and you rise toward the light, sink and you land on the
   rock. Radius only gives the shell its thickness, and it is pushed out to
   the cap as depth approaches the floor so benthic species sit *on* the
   seabed instead of floating above it.

   The sun is a fixed world-space direction and the camera orbits, so the
   terminator is welded to the ball: spin it and the lit pole turns away.

   Everything is real geometry: bodies are swept tubes with separate fins,
   plants are tapered ribbons, and both bend in the vertex shader. There are
   no billboards left.
   ========================================================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const R = 100;             // the water ball
const MAX_LAT = 1.25;      // ~72deg: the latitude the tank floor maps to
const CAP_LAT = 1.02;      // seabed cap covers everything below this latitude
const INNER = 0.56;        // living shell runs from INNER*R out to the skin
const HOME_DIST = R * 3.3;
const SUN = new THREE.Vector3(0, 1, 0);   // recomputed every frame by the day cycle

/* Day cycle and weather. The sun arcs east->west over the lit pole, dips below
   it at night, and the weather states only ever move four numbers, so the whole
   system is a handful of uniforms rather than a simulation. */
const DAY_SECONDS = 168;
const WEATHER = {
  clear:    { label: ['晴', 'Clear'],    sun: 1.00, waves: 1.00, murk: 0.00, tint: [0.30, 0.86, 0.98] },
  overcast: { label: ['阴', 'Overcast'], sun: 0.46, waves: 1.45, murk: 0.42, tint: [0.44, 0.66, 0.76] },
  rain:     { label: ['雨', 'Rain'],     sun: 0.30, waves: 2.05, murk: 0.62, tint: [0.34, 0.60, 0.74] },
  storm:    { label: ['暴雨', 'Storm'],  sun: 0.15, waves: 3.10, murk: 0.84, tint: [0.26, 0.46, 0.68] },
};
const WEATHER_KEYS = Object.keys(WEATHER);

/* ------------------------------------------------------------ GLSL chunks */

// Sum-of-sines instead of simplex noise: five octaves is enough swell for a
// ball this size, costs a fifth of the instructions, and has no texture or
// permutation table to ship.
const WAVE = /* glsl */`
  float wave(vec3 p, float t) {
    return sin(p.x * 0.055 + t * 0.90) * 0.55
         + sin(p.y * 0.071 - t * 0.70) * 0.42
         + sin(p.z * 0.063 + t * 1.15) * 0.38
         + sin((p.x + p.z) * 0.110 - t * 1.60) * 0.20
         + sin((p.y - p.x) * 0.130 + t * 1.90) * 0.14;
  }`;

// Interference of three drifting wave sets, raised to a high power so only the
// crests survive — the classic cheap caustic, and it tiles a sphere fine
// because it is evaluated in 3D rather than uv space.
const CAUSTIC = /* glsl */`
  float caustic(vec3 p, float t) {
    vec3 q = p * 0.055;
    float a = sin(q.x * 2.1 + t * 0.80) + sin(q.y * 2.7 - t * 0.60) + sin(q.z * 3.3 + t * 1.10);
    float b = sin((q.x + q.y) * 2.9 - t * 1.00) + sin((q.y + q.z) * 2.3 + t * 0.90);
    float c = 0.5 + 0.5 * sin(a * 1.7 + b * 1.3);
    return pow(c, 6.0);
  }`;

const boot = () => {
  const E = window.EcoTank;
  if (!E) return;
  const { WORLD, SPECIES, COLORS, REL_COLORS, ZONES, settings, view } = E;

  const canvas = document.getElementById('tankCanvas');
  if (!canvas) return;

  /* ---------------------------------------------------------------- stage */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x010306, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // low exposure on purpose: the water is meant to be near-black so the
  // emissive organisms are the only thing with any real luminance
  renderer.toneMappingExposure = 0.75;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  camera.position.set(HOME_DIST * 0.55, HOME_DIST * 0.42, HOME_DIST * 0.72);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.5;
  controls.enablePan = false;            // a ball has no meaningful pan
  controls.minDistance = R * 0.30;       // deepest dive, inside the living shell
  controls.maxDistance = R * 5;

  // RenderPass -> bloom -> OutputPass, on the composer's own buffer. OutputPass
  // is what tone-maps and encodes, so the passes in front of it stay linear.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.30, 0.50, 0.80);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------------------------------------------------- coordinate mapping */
  const LON_K = (Math.PI * 2) / WORLD.width;
  const DEPTH_SPAN = WORLD.floor - WORLD.waterTop;
  const PX = (Math.PI * 2 * R) / WORLD.width;   // one tank pixel in world units
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function lonLatRad(x, y, z) {
    const t = clamp((y - WORLD.waterTop) / DEPTH_SPAN, 0, 1);   // 0 surface, 1 floor
    const zf = clamp((z || 0) / WORLD.depth, 0, 1);
    // radius gives the shell its thickness, but bottom-dwellers get pressed out
    // onto the seabed cap — a snail floating above the rock reads as a bug
    const free = R * (INNER + (0.98 - INNER) * zf);
    return {
      lon: x * LON_K,
      lat: (0.5 - t) * 2 * MAX_LAT,
      r: free + (R * 0.985 - free) * (t * t),
    };
  }

  function toSphere(x, y, z, out) {
    const { lon, lat, r } = lonLatRad(x, y, z);
    const cl = Math.cos(lat);
    return out.set(r * cl * Math.cos(lon), r * Math.sin(lat), r * cl * Math.sin(lon));
  }

  const agentPos = (a, out) => {
    const v = E.vis(a);
    return toSphere(v.x, v.y, v.z == null ? WORLD.depth / 2 : v.z, out);
  };

  /* ================================================================ WATER */

  const shellGeo = new THREE.SphereGeometry(R, 128, 84);

  const surfaceMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: 2.6 }, uSun: { value: SUN.clone() },
      uSunI: { value: 1 }, uMurk: { value: 0 }, uFlash: { value: 0 },
      uTint: { value: new THREE.Color(0.30, 0.86, 0.98) },
    },
    vertexShader: `
      uniform float uTime; uniform float uAmp;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${WAVE}
      void main() {
        float d = wave(position, uTime);
        vec3 p = position + normal * d * uAmp;
        // finite-difference the displacement along two surface tangents,
        // otherwise the swell only shows on the silhouette
        vec3 t1 = normalize(cross(normal, abs(normal.y) > 0.9 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0)));
        vec3 t2 = normalize(cross(normal, t1));
        float e = 3.0;
        float da = wave(position + t1 * e, uTime);
        float db = wave(position + t2 * e, uTime);
        vec3 n = normalize(normal - (t1 * (da - d) + t2 * (db - d)) * uAmp / e);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * n);
        vView = normalize(-mv.xyz);
        vPos = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform float uSunI;
      uniform float uMurk; uniform float uFlash; uniform vec3 uTint;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${CAUSTIC}
      void main() {
        vec3 n = normalize(vN); vec3 v = normalize(vView);
        // the hemisphere the sun is over is daylight, the far side is night,
        // and both sweep round as the sun arcs from east to west
        vec3 dir = normalize(vPos);
        float lit = smoothstep(-0.35, 0.75, dot(dir, uSun)) * uSunI;
        float fres = pow(1.0 - abs(dot(n, v)), 2.6);
        float spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 40.0);
        float film = caustic(vPos * 1.6, uTime * 0.7) * 0.5;
        vec3 rim  = mix(vec3(0.04, 0.11, 0.19), uTint, lit) * fres * 1.15;
        vec3 glint = vec3(0.72, 1.00, 0.98) * spec * 0.9 * lit * (1.0 - uMurk * 0.7);
        vec3 skin = uTint * 0.55 * film * (0.20 + fres) * lit;
        vec3 bolt = vec3(0.72, 0.86, 1.0) * uFlash * (0.35 + fres);
        gl_FragColor = vec4(rim + glint + skin + bolt,
          clamp(fres * (0.30 + 0.75 * lit) + film * 0.20 * lit + spec * lit + uFlash * 0.5, 0.0, 1.0));
      }`,
  });
  const surface = new THREE.Mesh(shellGeo, surfaceMat);
  surface.renderOrder = 24;
  scene.add(surface);

  // Inner face of the same shell. Carries the volume tint, the caustic net and
  // the light shafts, so the whole "there is water in here" read is one mesh.
  const volumeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: 2.6 },
      uSun: { value: SUN.clone() }, uInside: { value: 0 },
      uSunI: { value: 1 }, uMurk: { value: 0 }, uFlash: { value: 0 },
      uTint: { value: new THREE.Color(0.30, 0.86, 0.98) },
    },
    vertexShader: `
      uniform float uTime; uniform float uAmp;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${WAVE}
      void main() {
        vec3 p = position + normal * wave(position, uTime) * uAmp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vPos = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform float uInside;
      uniform float uSunI; uniform float uMurk; uniform float uFlash; uniform vec3 uTint;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${CAUSTIC}
      void main() {
        vec3 dir = normalize(vPos);
        // depth still darkens the column, but which hemisphere is in daylight
        // is the sun's call, so the two effects multiply rather than compete
        float depth = smoothstep(-0.95, 0.85, dir.y);
        float lit = smoothstep(-0.30, 0.80, dot(dir, uSun)) * uSunI * (0.35 + 0.65 * depth);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.8);
        vec3 body = mix(vec3(0.004, 0.012, 0.022), uTint * 0.17, lit * (0.45 + fres));
        // shafts: a cone around the sun, cut into blades by the angle around it
        // so it reads as light coming through a broken surface
        float axis = max(dot(dir, uSun), 0.0);
        float blades = 0.55 + 0.45 * sin(atan(dir.z, dir.x) * 13.0 + uTime * 0.35);
        float shaft = pow(axis, 4.0) * blades * uSunI * (1.0 - uMurk * 0.55);
        float net = caustic(vPos, uTime) * lit;
        gl_FragColor = vec4(
          body + uTint * shaft * 0.34 + uTint * 0.82 * net * 0.20 + vec3(0.6, 0.75, 1.0) * uFlash * 0.35,
          (0.08 + 0.30 * lit + shaft * 0.34 + net * 0.16 + uFlash * 0.3) * mix(1.0, 0.40, uInside));
      }`,
  });
  const volume = new THREE.Mesh(shellGeo, volumeMat);
  volume.renderOrder = 1;
  scene.add(volume);

  /* Seabed: a rocky cap closing the bottom pole. Everything the simulation
     calls "floor" lands on it, so it is where the plants root and where the
     snails graze. Lit only by what filters down from the pole above. */
  const CAP_THETA = Math.PI / 2 + CAP_LAT;      // polar angle where the rock starts
  const seabedGeo = new THREE.SphereGeometry(
    R * 0.995, 128, 40, 0, Math.PI * 2, CAP_THETA, Math.PI - CAP_THETA,
  );
  {
    const p = seabedGeo.attributes.position;
    const n = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 1) {
      n.fromBufferAttribute(p, i);
      // dunes and boulders, biggest away from the rim so the seam stays flush
      const rim = Math.min(1, (-n.y / R - Math.sin(CAP_LAT)) * 4.5);
      const k = 1 + Math.max(0, rim) * (
        0.055 * Math.sin(n.x * 0.11) * Math.cos(n.z * 0.09)
        + 0.030 * Math.sin(n.z * 0.23 + n.x * 0.07)
        + 0.016 * Math.sin(n.x * 0.47 + n.z * 0.39));
      p.setXYZ(i, n.x * k, n.y * k, n.z * k);
    }
    seabedGeo.computeVertexNormals();
  }
  const seabed = new THREE.Mesh(seabedGeo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uSun: { value: SUN.clone() },
      uSunI: { value: 1 }, uFlash: { value: 0 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vPos; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vPos = position; vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform float uSunI; uniform float uFlash;
      varying vec3 vN; varying vec3 vPos; varying vec3 vView;
      ${CAUSTIC}
      void main() {
        // The cap is a bowl at the bottom of the ball, so its outward face points
        // away from the sun and lighting it by that normal renders it invisible.
        // What actually lights a seabed is downwelling light on the face turned
        // up into the water, so flip the normal on backfaces and use that.
        vec3 n = normalize(vN);
        // Front faces of the cap point out of the ball, i.e. downward, so the
        // face turned up into the water is the negated one. Using the *displaced*
        // normal here (not the smooth radial) is what makes the dunes read as
        // relief rather than a flat grey disc.
        vec3 nUp = gl_FrontFacing ? -n : n;
        float lam = max(dot(nUp, uSun), 0.0) * uSunI;
        float net = caustic(vPos * 2.4, uTime * 1.1) * (0.35 + 0.65 * uSunI);
        float fres = pow(1.0 - abs(dot(n, normalize(vView))), 2.0);
        vec3 rock = vec3(0.026, 0.036, 0.044) + vec3(0.055, 0.080, 0.086) * lam;
        vec3 wet  = vec3(0.13, 0.52, 0.60) * net * (0.22 + lam * 0.78);
        vec3 rim  = vec3(0.10, 0.44, 0.54) * fres * 0.70;
        gl_FragColor = vec4(rock + wet + rim + vec3(0.5, 0.62, 0.8) * uFlash * 0.4, 1.0);
      }`,
  }));
  scene.add(seabed);

  /* ========================================================== GEOMETRY KIT */

  // Small accumulator so every organism part lands in one buffer and one
  // draw call per species. aSpine drives the swim wave: 0 at the tail, 1 at
  // the nose, and the fins inherit the value of whatever they hang off.
  function Builder() {
    return { pos: [], nrm: [], spn: [], idx: [], n: 0 };
  }

  function finish(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
    g.setAttribute('aSpine', new THREE.Float32BufferAttribute(B.spn, 1));
    g.setIndex(B.idx);
    return g;
  }

  /* swept tube: rings of an ellipse whose half-width/half-height come from
     profile(t), optionally arched by bend(t) */
  function sweep(B, opt) {
    const { len, seg, ring, profile, bend } = opt;
    const base = B.n;
    for (let i = 0; i <= seg; i += 1) {
      const t = i / seg;
      const [hw, hh] = profile(t);
      const cx = (t - 0.5) * len;
      const cy = bend ? bend(t) : 0;
      for (let j = 0; j < ring; j += 1) {
        const a = (j / ring) * Math.PI * 2;
        B.pos.push(cx, cy + hh * Math.sin(a), hw * Math.cos(a));
        B.nrm.push(0, Math.sin(a), Math.cos(a));
        B.spn.push(t);
        B.n += 1;
      }
    }
    for (let i = 0; i < seg; i += 1) {
      for (let j = 0; j < ring; j += 1) {
        const a = base + i * ring + j;
        const b = base + i * ring + ((j + 1) % ring);
        const c = a + ring, d = b + ring;
        B.idx.push(a, c, b, b, c, d);
      }
    }
  }

  /* flat polygon fan — fins, tail flukes, antennae. `plane` picks which two
     body axes the outline lives in, so the same routine makes a vertical
     dorsal and a horizontal pectoral. */
  function fan(B, outline, plane, spine, offset) {
    const base = B.n;
    const o = offset || [0, 0, 0];
    outline.forEach(([u, v]) => {
      const p = plane === 'xy' ? [u, v, 0] : plane === 'xz' ? [u, 0, v] : [0, u, v];
      B.pos.push(p[0] + o[0], p[1] + o[1], p[2] + o[2]);
      B.nrm.push(plane === 'xy' ? 0 : 0, plane === 'xz' ? 1 : 0, plane === 'xy' ? 1 : 0);
      B.spn.push(spine);
      B.n += 1;
    });
    for (let i = 1; i < outline.length - 1; i += 1) B.idx.push(base, base + i, base + i + 1);
  }

  /* ---- fish: bigfish, smallfish, cleaner ---- */
  function fishGeometry(k) {
    const B = Builder();
    const L = 1.0;
    sweep(B, {
      len: L, seg: 26, ring: 12,
      profile: (t) => {
        // teardrop: widest a third back from the nose, pinched at the peduncle
        const s = Math.sin(Math.pow(t, 0.72) * Math.PI);
        const pinch = 0.30 + 0.70 * Math.pow(t, 0.5);
        return [0.115 * k.girth * s * pinch, 0.185 * k.depth * s * pinch];
      },
    });
    const tl = 0.30 * k.tail;
    // forked caudal fin
    fan(B, [[-0.50, 0], [-0.50 - tl, 0.26 * k.tail], [-0.50 - tl * 0.55, 0],
      [-0.50 - tl, -0.26 * k.tail]], 'xy', 0.0);
    // dorsal
    fan(B, [[-0.10, 0.10], [0.02, 0.10 + 0.20 * k.dorsal], [0.24, 0.09]], 'xy', 0.5);
    // anal
    fan(B, [[-0.16, -0.09], [-0.06, -0.09 - 0.13 * k.dorsal], [0.06, -0.08]], 'xy', 0.42);
    // pectorals, one per side
    fan(B, [[0.16, 0.03], [0.02, 0.16 * k.pect], [0.00, 0.02]], 'xz', 0.72);
    fan(B, [[0.16, -0.03], [0.00, -0.02], [0.02, -0.16 * k.pect]], 'xz', 0.72);
    return finish(B);
  }

  /* ---- shrimp: arched carapace, fanned uropods, antennae ---- */
  function shrimpGeometry() {
    const B = Builder();
    sweep(B, {
      len: 0.9, seg: 20, ring: 10,
      profile: (t) => {
        const s = Math.sin(Math.pow(t, 0.85) * Math.PI);
        return [0.10 * s, 0.15 * s * (0.6 + 0.6 * t)];
      },
      bend: (t) => Math.pow(1.0 - t, 2.0) * 0.20,   // curled abdomen
    });
    // tail fan
    fan(B, [[-0.44, 0.20], [-0.72, 0.30], [-0.80, 0], [-0.72, -0.30], [-0.44, -0.20]], 'xy', 0.0);
    fan(B, [[-0.44, 0.10], [-0.74, 0.16], [-0.80, 0], [-0.74, -0.16], [-0.44, -0.10]], 'xz', 0.0);
    // antennae, long enough to read at this size
    fan(B, [[0.42, 0.02], [1.00, 0.26], [0.42, -0.01]], 'xy', 1.0);
    fan(B, [[0.42, 0.01], [1.02, -0.10], [0.42, -0.02]], 'xy', 1.0);
    // swimmerets
    for (let i = 0; i < 4; i += 1) {
      const x = -0.30 + i * 0.13;
      fan(B, [[x, -0.06], [x - 0.05, -0.19], [x + 0.05, -0.17]], 'xy', 0.3);
    }
    return finish(B);
  }

  /* ---- snail: logarithmic-spiral shell over a flat foot ---- */
  function snailGeometry() {
    const B = Builder();
    const TURNS = 2.35, SEG = 68, RING = 12;
    const base = B.n;
    for (let i = 0; i <= SEG; i += 1) {
      const t = i / SEG;
      const a = t * TURNS * Math.PI * 2;
      const rad = 0.09 + 0.30 * t;           // distance from the shell axis
      const tube = 0.035 + 0.16 * t * t;     // whorl thickness
      const cx = Math.cos(a) * rad;
      const cy = Math.sin(a) * rad + 0.16;
      const cz = (0.5 - t) * 0.10;           // slight cone, so it is not flat
      for (let j = 0; j < RING; j += 1) {
        const b = (j / RING) * Math.PI * 2;
        B.pos.push(cx + Math.cos(b) * tube * 0.75, cy + Math.sin(b) * tube, cz + Math.cos(b) * tube * 0.35);
        B.nrm.push(Math.cos(b) * 0.8, Math.sin(b), Math.cos(b) * 0.4);
        B.spn.push(1.0);                     // shell never bends
        B.n += 1;
      }
    }
    for (let i = 0; i < SEG; i += 1) {
      for (let j = 0; j < RING; j += 1) {
        const a = base + i * RING + j, b = base + i * RING + ((j + 1) % RING);
        B.idx.push(a, a + RING, b, b, a + RING, b + RING);
      }
    }
    // the foot, which does creep
    sweep(B, {
      len: 0.86, seg: 14, ring: 10,
      profile: (t) => { const s = Math.sin(Math.pow(t, 0.8) * Math.PI); return [0.11 * s, 0.045 * s]; },
      bend: () => -0.09,
    });
    // eye stalks
    fan(B, [[0.34, -0.06], [0.56, 0.14], [0.36, -0.09]], 'xy', 0.9);
    fan(B, [[0.34, -0.06], [0.54, 0.02], [0.36, -0.09]], 'xz', 0.9);
    return finish(B);
  }

  /* ---- louse: flat oval with legs; 5px on screen, so nothing more ---- */
  function louseGeometry() {
    const B = Builder();
    sweep(B, {
      len: 0.8, seg: 12, ring: 10,
      profile: (t) => { const s = Math.sin(Math.pow(t, 0.7) * Math.PI); return [0.22 * s, 0.09 * s]; },
    });
    for (let i = 0; i < 3; i += 1) {
      const x = -0.18 + i * 0.18;
      fan(B, [[x, 0.14], [x - 0.06, 0.34], [x + 0.06, 0.30]], 'xz', 0.5);
      fan(B, [[x, -0.14], [x + 0.06, -0.30], [x - 0.06, -0.34]], 'xz', 0.5);
    }
    return finish(B);
  }

  const GEOMETRY = {
    bigfish: fishGeometry({ girth: 1.15, depth: 1.20, tail: 1.15, dorsal: 1.25, pect: 1.1 }),
    smallfish: fishGeometry({ girth: 0.95, depth: 1.00, tail: 1.00, dorsal: 0.95, pect: 1.0 }),
    cleaner: fishGeometry({ girth: 0.70, depth: 0.72, tail: 0.95, dorsal: 0.60, pect: 0.9 }),
    shrimp: shrimpGeometry(),
    snail: snailGeometry(),
    louse: louseGeometry(),
  };

  /* ===================================================== ORGANISM MATERIAL */

  // Dark body, emissive rim, luminous flank stripes that pulse with energy.
  // aTint/aPhase/aGlow are per-instance so one material serves a whole species.
  function organismMaterial(species, swim, freq) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 }, uSwim: { value: swim }, uFreq: { value: freq },
        uBase: { value: new THREE.Color(COLORS[species]) },
      },
      vertexShader: `
        attribute float aSpine;
        attribute float aPhase;
        attribute float aGlow;
        attribute float aBeat;
        uniform float uTime; uniform float uSwim; uniform float uFreq;
        varying vec3 vN; varying vec3 vView; varying float vSpine; varying float vGlow;
        void main() {
          // travelling wave down the body; amplitude vanishes at the head so
          // the fish swims instead of shearing sideways
          float k = pow(1.0 - aSpine, 1.7);
          float w = sin(aSpine * uFreq - uTime * aBeat + aPhase) * uSwim * k;
          vec3 p = position; p.z += w;
          vec4 world = instanceMatrix * vec4(p, 1.0);
          vec4 mv = modelViewMatrix * world;
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vView = normalize(-mv.xyz);
          vSpine = aSpine; vGlow = aGlow;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uBase; uniform float uTime;
        varying vec3 vN; varying vec3 vView; varying float vSpine; varying float vGlow;
        void main() {
          vec3 n = normalize(vN); vec3 v = normalize(vView);
          float fres = pow(1.0 - abs(dot(n, v)), 2.2);
          float stripe = smoothstep(0.62, 0.98, abs(sin(vSpine * 16.0)));
          float pulse = 0.78 + 0.22 * sin(uTime * 2.2 + vSpine * 3.0);
          vec3 col = uBase * 0.055                       // near-black body
                   + uBase * fres * 1.55 * vGlow         // emissive rim
                   + uBase * stripe * 0.55 * vGlow * pulse;
          gl_FragColor = vec4(col, 0.30 + fres * 0.70 + stripe * 0.3);
        }`,
    });
  }

  const SWIM = {
    bigfish: [0.075, 7.0], smallfish: [0.085, 8.0], cleaner: [0.090, 9.0],
    shrimp: [0.055, 6.0], snail: [0.004, 2.0], louse: [0.030, 10.0],
  };

  // per-species instanced pool; capacity is the birth ceiling plus slack for
  // the ecosystem top-ups, which can briefly overshoot it
  const pools = {};
  Object.keys(SPECIES).forEach((species) => {
    const cap = Math.max(8, Math.ceil(SPECIES[species].birthLimit * 2 + 12));
    const [swim, freq] = SWIM[species];
    const mesh = new THREE.InstancedMesh(GEOMETRY[species], organismMaterial(species, swim, freq), cap);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const phase = new Float32Array(cap);
    const glow = new Float32Array(cap);
    const beat = new Float32Array(cap);
    for (let i = 0; i < cap; i += 1) phase[i] = Math.random() * 6.283;
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    mesh.geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 1));
    mesh.geometry.setAttribute('aBeat', new THREE.InstancedBufferAttribute(beat, 1));
    mesh.count = 0;
    mesh.renderOrder = 10;
    scene.add(mesh);
    pools[species] = { mesh, glow, beat, cap, ids: [] };
  });

  /* --------------------------------------------------- placing an organism
     Orientation comes from the local sphere frame: tank +x runs east along
     the longitude circle, tank +y runs *inward* (deeper = smaller radius),
     and the dorsal side points out of the ball. */
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const P = new THREE.Vector3();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();

  function placeOrganism(agent, index, pool) {
    const v = E.vis(agent);
    const z = v.z == null ? WORLD.depth / 2 : v.z;
    const { lon, lat, r } = lonLatRad(v.x, v.y, z);
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const co = Math.cos(lon), so = Math.sin(lon);

    radial.set(cl * co, sl, cl * so);          // straight out of the ball
    east.set(-so, 0, co);                      // along the latitude circle
    north.set(-co * sl, cl, -so * sl);         // toward the lit pole
    P.copy(radial).multiplyScalar(r);

    // Tank +x runs east and tank +y runs *down* the sphere, so a heading of 0
    // is due east and a dive is southward. The lateral axis is the radial one:
    // in a side-view tank the flattened axis is the one facing the viewer.
    const ang = v.ang || 0;
    fwd.copy(east).multiplyScalar(Math.cos(ang))
      .addScaledVector(north, -Math.sin(ang))
      .addScaledVector(radial, (v.zVel || 0) * 0.05)
      .normalize();
    up.crossVectors(fwd, radial).normalize();  // dorsal, toward the light
    side.crossVectors(fwd, up).normalize();
    M.makeBasis(fwd, up, side);
    Q.setFromRotationMatrix(M);

    const spec = SPECIES[agent.species];
    const grow = clamp(0.45 + 0.55 * (agent.age / Math.max(1, spec.matureAge)), 0.45, 1);
    const len = spec.size * 3.1 * PX * grow;
    S.set(len, len, len);
    M.compose(P, Q, S);
    pool.mesh.setMatrixAt(index, M);

    const energyFrac = clamp(agent.energy / spec.maxEnergy, 0, 1);
    const fleeing = agent.action && (agent.action.type === 'flee' || agent.action.type === 'hide');
    // a starving animal dims; a frightened one flares and beats faster
    pool.glow[index] = 0.30 + energyFrac * 0.85 + (fleeing ? 0.45 : 0);
    pool.beat[index] = 3.2 + Math.min(6.0, (v.spd || 0) * 1.5) + (fleeing ? 3.0 : 0);
  }

  function syncOrganisms(world) {
    Object.keys(pools).forEach((s) => { pools[s].ids.length = 0; });
    world.organisms.forEach((agent) => {
      if (!agent.alive) return;
      const pool = pools[agent.species];
      if (!pool || pool.ids.length >= pool.cap) return;
      const i = pool.ids.length;
      pool.ids.push(agent.id);
      placeOrganism(agent, i, pool);
    });
    Object.keys(pools).forEach((s) => {
      const pool = pools[s];
      pool.mesh.count = pool.ids.length;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.mesh.geometry.getAttribute('aGlow').needsUpdate = true;
      pool.mesh.geometry.getAttribute('aBeat').needsUpdate = true;
    });
  }

  /* ================================================================ PLANTS
     One tapered ribbon, instanced. Each blade is rooted on the core and
     points radially out; the sway is a quadratic bend in the vertex shader
     so the base stays anchored and the tip travels. */
  const BLADE_SEG = 10;
  const bladeGeo = (() => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= BLADE_SEG; i += 1) {
      const t = i / BLADE_SEG;
      const w = 0.5 * (1 - t * 0.85) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 2.4) * 1.57));
      pos.push(-w, t, 0, w, t, 0);
      uv.push(0, t, 1, t);
    }
    for (let i = 0; i < BLADE_SEG; i += 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  })();

  const PLANT_CAP = 460;
  const plantMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
    uniforms: { uTime: { value: 0 }, uBase: { value: new THREE.Color(COLORS.plant) } },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying vec2 vUv; varying float vT;
      void main() {
        vec3 p = position;
        float t = position.y;
        float bend = sin(uTime * 0.85 + aPhase) * 0.30 + sin(uTime * 1.9 + aPhase * 1.7) * 0.10;
        p.x += bend * t * t;
        p.z += cos(uTime * 0.7 + aPhase * 1.3) * 0.16 * t * t;
        vUv = uv; vT = t;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uBase; uniform float uTime;
      varying vec2 vUv; varying float vT;
      void main() {
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
        // luminous margin and tip, dark centre — reads as a glowing leaf
        float rib = smoothstep(0.0, 0.35, edge);
        float tip = pow(vT, 2.2);
        vec3 col = uBase * (0.10 + 0.55 * tip) + uBase * (1.0 - rib) * 0.85 + vec3(0.55, 1.0, 0.75) * tip * 0.22;
        gl_FragColor = vec4(col, 0.35 + rib * 0.5 + tip * 0.3);
      }`,
  });
  const plants = new THREE.InstancedMesh(bladeGeo, plantMat, PLANT_CAP);
  plants.frustumCulled = false;
  plants.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  {
    const ph = new Float32Array(PLANT_CAP);
    for (let i = 0; i < PLANT_CAP; i += 1) ph[i] = Math.random() * 6.283;
    bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  }
  plants.count = 0;
  scene.add(plants);

  const POLE = new THREE.Vector3(0, 1, 0);
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();

  /* Plants live on the seabed cap. Their tank y is all bunched at the floor,
     which would stack every bed on one thin latitude ring and leave the bottom
     pole bare, so the latitude is spread across the cap by a hash of the plant
     id — stable per plant, so beds do not swim about between rebuilds. */
  function rebuildPlants(world) {
    let i = 0;
    for (const plant of world.plants) {
      if (plant.biomass <= 1 || i >= PLANT_CAP) continue;
      const h1 = Math.sin((plant.x + 1) * 12.9898 + (plant.y + 1) * 78.233) * 43758.5453;
      const spread = h1 - Math.floor(h1);                    // stable 0..1
      const lat = -(CAP_LAT + 0.04 + spread * (Math.PI / 2 - CAP_LAT - 0.10));
      const lon = plant.x * LON_K;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const co = Math.cos(lon), so = Math.sin(lon);
      radial.set(cl * co, sl, cl * so);
      north.set(-co * sl, cl, -so * sl);
      // Root just inside the skin and grow mostly *along* the sphere toward the
      // lit pole. Growing radially pushed every blade straight out through the
      // surface, which read as a beard hanging off the bottom of the ball.
      P.copy(radial).multiplyScalar(R * 0.93);
      up.copy(north).multiplyScalar(0.94).addScaledVector(radial, -0.10).normalize();
      tA.copy(Math.abs(up.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : POLE).cross(up).normalize();
      tB.copy(up).cross(tA).normalize();

      const blades = 2 + Math.min(2, Math.floor(plant.biomass / 30));
      for (let b = 0; b < blades && i < PLANT_CAP; b += 1, i += 1) {
        const spin = (b / blades) * Math.PI * 2 + plant.sway;
        fwd.copy(tA).multiplyScalar(Math.cos(spin)).addScaledVector(tB, Math.sin(spin)).normalize();
        side.crossVectors(fwd, up).normalize();
        M.makeBasis(fwd, up, side);
        Q.setFromRotationMatrix(M);
        // capped: an unclamped blade on a fat bed reached past the water surface
        // A blade leaves the rock along a tangent, so its tip sits at
        // hypot(rootR, hgt) — longer than the radius. Root deeper and cap the
        // length so sqrt(93^2 + 26^2) stays inside the skin.
        const hgt = Math.min(R * 0.26, (14 + plant.biomass * 0.40) * PX)
          * (0.72 + 0.28 * ((b * 7) % 5) / 4);
        S.set(hgt * 0.42, hgt, hgt * 0.42);
        M.compose(P, Q, S);
        plants.setMatrixAt(i, M);
      }
    }
    plants.count = i;
    plants.instanceMatrix.needsUpdate = true;
  }

  /* ============================================================== SUN SHAFTS
     The shell shader already brightens toward the sun, but a gradient is not a
     beam. These are real tapered quads fanning down from the lit pole, additive
     and fading out along their length. Cheaper and far more legible than
     raymarching the volume, and they vanish with uSunI so night stays dark. */
  const SHAFT_COUNT = 15;
  const shaftGeo = (() => {
    const pos = [], along = [], seed = [];
    for (let i = 0; i < SHAFT_COUNT; i += 1) {
      const a = (i / SHAFT_COUNT) * Math.PI * 2 + i * 0.37;
      const tilt = 0.20 + ((i * 7) % 5) / 5 * 0.55;      // how far off the pole
      const len = R * (1.20 + ((i * 11) % 4) / 4 * 0.55);
      const halfW = R * (0.030 + ((i * 5) % 3) / 3 * 0.035);
      // top of the beam sits just under the surface at the pole
      const top = new THREE.Vector3(0, R * 0.94, 0);
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), -Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
      const perp = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const bot = top.clone().addScaledVector(dir, len);
      const quad = [
        [top.clone().addScaledVector(perp, -halfW * 0.35), 0],
        [top.clone().addScaledVector(perp, halfW * 0.35), 0],
        [bot.clone().addScaledVector(perp, halfW), 1],
        [top.clone().addScaledVector(perp, -halfW * 0.35), 0],
        [bot.clone().addScaledVector(perp, halfW), 1],
        [bot.clone().addScaledVector(perp, -halfW), 1],
      ];
      for (const [v, t] of quad) { pos.push(v.x, v.y, v.z); along.push(t); seed.push(i); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    return g;
  })();

  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uSunI: { value: 1 }, uMurk: { value: 0 },
      uTint: { value: new THREE.Color(0.30, 0.86, 0.98) },
    },
    vertexShader: `
      attribute float aAlong; attribute float aSeed;
      varying float vAlong; varying float vSeed;
      void main() {
        vAlong = aAlong; vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uSunI; uniform float uMurk; uniform vec3 uTint;
      varying float vAlong; varying float vSeed;
      void main() {
        float fade = pow(1.0 - vAlong, 1.9);                       // dies out with depth
        float flick = 0.62 + 0.38 * sin(uTime * 0.7 + vSeed * 2.3);
        float a = fade * flick * uSunI * (1.0 - uMurk * 0.5) * 0.16;
        gl_FragColor = vec4(uTint * a, a);
      }`,
  });
  const shafts = new THREE.Mesh(shaftGeo, shaftMat);
  shafts.frustumCulled = false;
  shafts.renderOrder = 6;
  scene.add(shafts);

  /* ========================================================= MOTES & FOOD */
  function motePoints(count, size, color, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size, color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  }

  const foodPoints = motePoints(400, 3.4, new THREE.Color(COLORS.food), 0.95);
  const snowPoints = motePoints(700, 1.1, new THREE.Color(0x4ff0ff), 0.34);

  function setPoints(pts, list) {
    const attr = pts.geometry.getAttribute('position');
    const n = Math.min(list.length, attr.count);
    for (let i = 0; i < n; i += 1) {
      const it = list[i];
      toSphere(it.x, it.y, it.z == null ? WORLD.depth / 2 : it.z, P);
      attr.setXYZ(i, P.x, P.y, P.z);
    }
    attr.needsUpdate = true;
    pts.geometry.setDrawRange(0, n);
  }

  const SNOW = Array.from({ length: 700 }, () => ({
    x: Math.random() * WORLD.width,
    y: WORLD.waterTop + Math.random() * DEPTH_SPAN,
    z: Math.random() * WORLD.depth,
    v: 0.10 + Math.random() * 0.30,
  }));

  function stepSnow() {
    for (const s of SNOW) {
      s.y += s.v;
      if (s.y > WORLD.floor) { s.y = WORLD.waterTop; s.x = Math.random() * WORLD.width; }
    }
    setPoints(snowPoints, SNOW);
  }

  /* ============================================================ LINK LINES
     Relationships, schooling, messages, subgoals, intentions — all of them
     are line work, so they share one dynamic buffer and one draw call. */
  const MAX_SEG = 4000;
  const linePos = new Float32Array(MAX_SEG * 6);
  const lineCol = new Float32Array(MAX_SEG * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lines.frustumCulled = false;
  lines.renderOrder = 12;
  scene.add(lines);

  let segCount = 0;
  const cA = new THREE.Color();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  function seg(ax, ay, az, bx, by, bz, color, alpha) {
    if (segCount >= MAX_SEG) return;
    const i = segCount * 6;
    linePos[i] = ax; linePos[i + 1] = ay; linePos[i + 2] = az;
    linePos[i + 3] = bx; linePos[i + 4] = by; linePos[i + 5] = bz;
    cA.set(color).multiplyScalar(alpha);
    lineCol[i] = cA.r; lineCol[i + 1] = cA.g; lineCol[i + 2] = cA.b;
    lineCol[i + 3] = cA.r; lineCol[i + 4] = cA.g; lineCol[i + 5] = cA.b;
    segCount += 1;
  }

  // bulged outward so links travel through water rather than through the core
  function arc(a, b, color, alpha, steps) {
    const n = steps || 8;
    let px = a.x, py = a.y, pz = a.z;
    const bulge = 1 + 0.12 * (a.distanceTo(b) / R);
    for (let i = 1; i <= n; i += 1) {
      const t = i / n;
      const lift = Math.sin(t * Math.PI) * (bulge - 1) + 1;
      const x = (a.x + (b.x - a.x) * t) * lift;
      const y = (a.y + (b.y - a.y) * t) * lift;
      const z = (a.z + (b.z - a.z) * t) * lift;
      seg(px, py, pz, x, y, z, color, alpha);
      px = x; py = y; pz = z;
    }
  }

  function buildLines(world) {
    segCount = 0;
    const sel = E.selectedId;

    (world.relLinks || []).forEach((link) => {
      const a = E.getAgent(link.from), b = E.getAgent(link.to);
      if (!a || !b || !a.alive || !b.alive) return;
      arc(agentPos(a, pA), agentPos(b, pB), REL_COLORS[link.type] || '#ffffff', 0.8);
    });

    const groups = { smallfish: [], shrimp: [] };
    world.organisms.forEach((a) => { if (a.alive && groups[a.species]) groups[a.species].push(a); });
    Object.keys(groups).forEach((sp) => {
      const list = groups[sp];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const va = E.vis(list[i]), vb = E.vis(list[j]);
          const d = Math.hypot(va.x - vb.x, va.y - vb.y);
          if (d >= 92) continue;
          agentPos(list[i], pA); agentPos(list[j], pB);
          seg(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, COLORS[sp], (1 - d / 92) * 0.20);
        }
      }
    });

    if (settings.overlays.messages) {
      world.messages.forEach((m) => {
        const from = E.getAgent(m.from), to = E.getAgent(m.to);
        if (!from || !to || !from.alive || !to.alive) return;
        arc(agentPos(from, pA), agentPos(to, pB),
          m.priority === 'hard' ? COLORS.danger : COLORS.message,
          clamp(m.ttl / 78, 0.12, 0.85), 10);
      });
    }

    if (settings.overlays.subgoals) {
      ZONES.forEach((zone) => zoneOutline(zone, zone.safety || zone.id === 'cave' ? '#4dffc3' : COLORS.subgoal, 0.45));
      const a = E.getAgent(sel);
      if (a && a.alive && a.subgoals && a.subgoals.length) {
        agentPos(a, pA);
        a.subgoals.forEach((zone) => {
          toSphere(zone.x, zone.y, WORLD.depth / 2, pB);
          arc(pA, pB, COLORS.subgoal, 0.85, 10);
          pA.copy(pB);
        });
      }
    }

    if (settings.overlays.intentions) {
      world.organisms.forEach((a) => {
        if (!a.alive || !a.intention) return;
        const t = a.action && a.action.target;
        if (!t) return;
        agentPos(a, pA);
        toSphere(t.x, t.y, E.vis(a).z, pB);
        arc(pA, pB, COLORS.subgoal, 0.5, 6);
      });
    }

    if (settings.overlays.perception) {
      const a = E.getAgent(sel);
      if (a && a.alive) perceptionShell(a);
    }

    lineGeo.getAttribute('position').needsUpdate = true;
    lineGeo.getAttribute('color').needsUpdate = true;
    lineGeo.setDrawRange(0, segCount * 2);
  }

  function zoneOutline(zone, color, alpha) {
    const x0 = zone.x - zone.w / 2, x1 = zone.x + zone.w / 2;
    const y0 = zone.y - zone.h / 2, y1 = zone.y + zone.h / 2;
    const lat = WORLD.depth / 2, N = 14;
    const edge = (ax, ay, bx, by) => {
      let px = null, py = null, pz = null;
      for (let i = 0; i <= N; i += 1) {
        const t = i / N;
        toSphere(ax + (bx - ax) * t, ay + (by - ay) * t, lat, pA);
        if (px !== null) seg(px, py, pz, pA.x, pA.y, pA.z, color, alpha);
        px = pA.x; py = pA.y; pz = pA.z;
      }
    };
    edge(x0, y0, x1, y0); edge(x1, y0, x1, y1);
    edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
  }

  /* Sense radius is a distance in *tank* space, and the tank is wrapped, so
     here it is an arc length, not a straight line. A big fish senses 210 of
     1120 tank pixels — about 68 degrees of circumference — and drawing that
     as a Euclidean ball gives radius 118 against a sphere of radius 100,
     swallowing the view. Walk the circle in tank space instead. */
  function perceptionShell(agent) {
    const v = E.vis(agent);
    const rad = SPECIES[agent.species].sense;
    const z = v.z == null ? WORLD.depth / 2 : v.z;
    const N = 48;
    let px = null, py = null, pz = null;
    for (let i = 0; i <= N; i += 1) {
      const t = (i / N) * Math.PI * 2;
      toSphere(v.x + Math.cos(t) * rad, clamp(v.y + Math.sin(t) * rad, WORLD.waterTop, WORLD.floor), z, pA);
      if (px !== null) seg(px, py, pz, pA.x, pA.y, pA.z, COLORS.message, 0.4);
      px = pA.x; py = pA.y; pz = pA.z;
    }
  }

  /* ============================================================ SELECTION */
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.94, 64),
    new THREE.MeshBasicMaterial({
      color: 0x46f0d8, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.renderOrder = 30;
  halo.visible = false;
  scene.add(halo);

  /* lifecycle FX: an expanding shockwave ring, tinted per event type.
     ponytail: one ring for all three events. Split it only if the demo
     script ever needs to call out a specific death. */
  const FX_COLOR = { death: 0xff4d6d, birth: 0x7dffb0, contest: 0xffa23a };
  const FX_POOL = [];
  function fxRing() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.80, 1.0, 48),
      new THREE.MeshBasicMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.renderOrder = 28;
    m.visible = false;
    scene.add(m);
    FX_POOL.push(m);
    return m;
  }

  // Births, deaths and contests all fire often, and at full size they carpeted
  // the ball in rings. Keep them small, and only ever show the newest few.
  const FX_VISIBLE = 4;

  function syncFx(world) {
    const list = world.__fx || [];
    FX_POOL.forEach((m) => { m.visible = false; });
    let shown = 0;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const fx = list[i];
      fx.f = (fx.f || 0) + 1;
      const life = fx.f / 30;
      if (life >= 1) { list.splice(i, 1); continue; }
      if (shown >= FX_VISIBLE) continue;
      const m = FX_POOL[shown] || fxRing();
      shown += 1;
      toSphere(fx.x, fx.y, WORLD.depth / 2, P);
      m.position.copy(P);
      m.lookAt(camera.position);
      const size = (3 + life * 14) * PX;
      m.scale.set(size, size, 1);
      m.material.color.setHex(FX_COLOR[fx.type] || 0xffffff);
      m.material.opacity = (1 - life) * 0.75;
      m.visible = true;
    }
  }

  /* ============================================================== CONTROLS */
  const dolly = (factor) => {
    camera.position.setLength(clamp(camera.position.length() * factor,
      controls.minDistance, controls.maxDistance));
  };
  const byId = (id) => document.getElementById(id);
  byId('zoomIn') && byId('zoomIn').addEventListener('click', () => dolly(1 / 1.4));
  byId('zoomOut') && byId('zoomOut').addEventListener('click', () => dolly(1.4));
  byId('zoomReset') && byId('zoomReset').addEventListener('click', () => {
    view.follow = false;
    controls.target.set(0, 0, 0);
    camera.position.set(HOME_DIST * 0.55, HOME_DIST * 0.42, HOME_DIST * 0.72);
    E.syncHud();
  });
  byId('zoomFollow') && byId('zoomFollow').addEventListener('click', () => {
    view.follow = !view.follow;
    if (view.follow && camera.position.length() > R * 1.4) dolly(R * 1.1 / camera.position.length());
    E.syncHud();
  });

  /* --------------------------------------------------------------- picking */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickable = Object.keys(pools).map((s) => pools[s].mesh);
  let downAt = null;

  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return;                        // that was an orbit drag
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickable, false)[0];
    if (!hit || hit.instanceId == null) return;
    const species = Object.keys(pools).find((s) => pools[s].mesh === hit.object);
    const id = species && pools[species].ids[hit.instanceId];
    if (id) E.select(id);
  });

  /* ---------------------------------------------------------------- resize */
  let lastW = 0, lastH = 0;
  function resize() {
    const host = canvas.parentElement;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight || Math.round(w * 0.57));
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // ResizeObserver is the fast path, but it is not guaranteed to have fired
  // before the first frames, and a stale size means a stretched sphere. The
  // per-frame check is two integer reads and exits immediately when unchanged.
  new ResizeObserver(resize).observe(canvas.parentElement);

  /* ---------------------------------------------------------------- the sky
     One arc of the sun per DAY_SECONDS, plus a weather state that is re-rolled
     whenever the current one expires and then eased into over a few seconds.
     Everything it produces is a uniform, so weather costs nothing to render. */
  const sky = {
    phase: 0.26,                                  // 0 = midnight, 0.5 = noon
    from: WEATHER.clear, to: WEATHER.clear, blend: 1, hold: 40,
    sun: 1, waves: 1, murk: 0, flash: 0,
    tint: new THREE.Color(0.30, 0.86, 0.98),
    key: 'clear',
  };
  const tintA = new THREE.Color();
  const tintB = new THREE.Color();

  function stepSky(dt) {
    sky.phase = (sky.phase + dt / DAY_SECONDS) % 1;
    // sun arc: due east at dawn, overhead at noon, due west at dusk, and under
    // the seabed all night. The pole tilt keeps it off a perfect great circle.
    const a = sky.phase * Math.PI * 2 - Math.PI / 2;
    SUN.set(Math.cos(a), Math.sin(a), 0.22).normalize();
    const daylight = clamp((Math.sin(a) + 0.18) / 0.85, 0, 1);

    sky.hold -= dt;
    if (sky.hold <= 0) {
      sky.from = sky.to;
      sky.key = WEATHER_KEYS[Math.floor(Math.random() * WEATHER_KEYS.length)];
      sky.to = WEATHER[sky.key];
      sky.blend = 0;
      sky.hold = 26 + Math.random() * 40;
    }
    sky.blend = Math.min(1, sky.blend + dt / 6);
    const k = sky.blend * sky.blend * (3 - 2 * sky.blend);

    sky.sun = (sky.from.sun + (sky.to.sun - sky.from.sun) * k) * daylight;
    sky.waves = sky.from.waves + (sky.to.waves - sky.from.waves) * k;
    sky.murk = sky.from.murk + (sky.to.murk - sky.from.murk) * k;
    tintA.setRGB(...sky.from.tint); tintB.setRGB(...sky.to.tint);
    sky.tint.copy(tintA).lerp(tintB, k);

    // lightning: only in a storm, and only a few frames of it
    sky.flash = Math.max(0, sky.flash - dt * 3.4);
    if (sky.to.waves > 2.5 && k > 0.5 && Math.random() < dt * 0.55) sky.flash = 0.9;
  }

  function pushSky() {
    const set = (mat) => {
      const u = mat.uniforms;
      if (u.uSun) u.uSun.value.copy(SUN);
      if (u.uSunI) u.uSunI.value = sky.sun;
      if (u.uMurk) u.uMurk.value = sky.murk;
      if (u.uFlash) u.uFlash.value = sky.flash;
      if (u.uTint) u.uTint.value.copy(sky.tint);
      if (u.uAmp) u.uAmp.value = 2.6 * sky.waves;
    };
    set(surfaceMat); set(volumeMat); set(seabed.material); set(shaftMat);
    // bioluminescence is what you see at night, so let bloom off the leash then
    bloom.strength = 0.30 + (1 - sky.sun) * 0.35;
  }

  const HUD = document.getElementById('skyHud');
  const ZH = document.documentElement.lang !== 'en';
  function pushHudLabel() {
    if (!HUD) return;
    const mins = Math.round(sky.phase * 1440);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    HUD.textContent = `${hh}:${mm} · ${sky.to.label[ZH ? 0 : 1]}`;
  }

  /* ------------------------------------------------------------ frame loop */
  const UP_Y = new THREE.Vector3(0, 1, 0);
  const followTarget = new THREE.Vector3();
  let plantTimer = 0;
  let hudTimer = 0;
  let clock = 0;

  function frame() {
    const world = E.world;
    if (!world) return;
    resize();
    const dt = 1 / 60;
    clock += dt;
    stepSky(dt);
    // the beams hang off the sun, so they swing across the day
    shafts.quaternion.setFromUnitVectors(UP_Y, SUN);
    if (hudTimer-- <= 0) { pushHudLabel(); hudTimer = 30; }

    if (view.follow) {
      const a = E.getAgent(E.selectedId);
      if (a && a.alive) {
        agentPos(a, followTarget);
        controls.target.lerp(followTarget, 0.12);
      }
    } else if (controls.target.lengthSq() > 0.01) {
      controls.target.multiplyScalar(0.88);
    }

    syncOrganisms(world);
    setPoints(foodPoints, world.food);
    stepSnow();
    if (plantTimer-- <= 0) { rebuildPlants(world); plantTimer = 20; }
    buildLines(world);
    syncFx(world);

    const a = E.getAgent(E.selectedId);
    if (a && a.alive) {
      agentPos(a, P);
      halo.position.copy(P);
      halo.lookAt(camera.position);
      const s = SPECIES[a.species].size * 2.1 * PX * (1 + 0.07 * Math.sin(clock * 7));
      halo.scale.set(s, s, 1);
      halo.visible = true;
    } else {
      halo.visible = false;
    }

    // once the camera is inside the ball the shell would wash out the view
    const dist = camera.position.length();
    const inside = dist < R;
    surface.visible = !inside;
    volumeMat.uniforms.uInside.value = inside ? 1 : 0;

    surfaceMat.uniforms.uTime.value = clock;
    volumeMat.uniforms.uTime.value = clock;
    seabed.material.uniforms.uTime.value = clock;
    shaftMat.uniforms.uTime.value = clock;
    plantMat.uniforms.uTime.value = clock;
    pushSky();
    Object.keys(pools).forEach((s) => { pools[s].mesh.material.uniforms.uTime.value = clock; });

    controls.update();
    composer.render();

    const zoom = HOME_DIST / Math.max(dist, 1);
    if (Math.abs(zoom - view.zoom) > 0.02) { view.zoom = zoom; E.syncHud(); }
  }

  // Handle for tuning the look from the console — every value in here is a
  // shader constant that has to be judged by eye, not derived.
  window.__eco3d = {
    scene, camera, renderer, composer, bloom, sky, SUN,
    surface, volume, seabed, shafts, plants, pools, lines, foodPoints, snowPoints, halo,
  };
  E.setRenderer({ frame, resize });
};

if (window.EcoTank) boot();
else document.addEventListener('DOMContentLoaded', boot, { once: true });
