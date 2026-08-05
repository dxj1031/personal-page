/* =========================================================================
   EcoTank · printed ecosphere
   -------------------------------------------------------------------------
   A ball of water printed on aged paper. Nothing in here emits: zine.js runs
   last and turns luminance into ink coverage, so this scene's only job is to
   lay down a *printable* tonal range — flat mid-tone fills and hard edges.
   Near-black becomes a solid ink blob, anything glowing becomes a white hole,
   and a smooth gradient becomes a smear of dot sizes. So there are none.

   Every colour in here is authored as an sRGB ink coverage k (see inkTone):
   0 is bare paper, 1 is solid ink. cov ~= 0.11 + 0.77k once it reaches the
   press, which is close enough that k can be read as "how dark it prints".

   One thing to know before touching a colour: the print pass hands any pixel
   with HSV saturation over ~0.16 to a *spot* plate. Fluorescent orange is the
   poster's single anchor, so everything that is not meant to be the anchor is
   kept under that threshold and stays on the ink plate.

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
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { zinePass } from './zine.js';

const R = 100;             // the water ball
const MAX_LAT = 1.25;      // ~72deg: the latitude the tank floor maps to
const CAP_LAT = 1.02;      // seabed cap covers everything below this latitude
const INNER = 0.56;        // living shell runs from INNER*R out to the skin
// A zine poster is 70-90% negative space, so the ball is a modest anchor in a
// quiet field rather than the subject filling the plate. At 4.8R and a 42deg
// lens it stands about 57% of the frame height: roughly a quarter of the area
// inked, three quarters bare paper.
const HOME_DIST = R * 3.9;   // quiet field around the ball, but the shoal still reads
const SUN = new THREE.Vector3(0, 1, 0);
const SWIM_MODES = ['eel', 'carangiform', 'power', 'burst'];
const RIPPLES = 6;          // concurrent drag disturbances tracked on the shell   // recomputed every frame by the day cycle

/* Day cycle and weather. The sun arcs east->west over the lit pole, dips below
   it at night, and the weather states only ever move four numbers, so the whole
   system is a handful of uniforms rather than a simulation. */
const DAY_SECONDS = 168;
const WEATHER = {
  clear:    { label: ['晴', 'Clear'],    sun: 1.00, waves: 1.00, murk: 0.00 },
  overcast: { label: ['阴', 'Overcast'], sun: 0.46, waves: 1.45, murk: 0.42 },
  rain:     { label: ['雨', 'Rain'],     sun: 0.30, waves: 2.05, murk: 0.62 },
  storm:    { label: ['暴雨', 'Storm'],  sun: 0.15, waves: 3.10, murk: 0.84 },
};
const WEATHER_KEYS = Object.keys(WEATHER);

/* ------------------------------------------------------------- the palette
   Four inks, shared verbatim with zine.js and ecotank.css. Nothing else gets
   invented: a riso deck is short, and a fifth colour is a fifth pass. */
const PAPER = 0xefe6d2;      // aged cream
const INK = 0x22201c;        // warm near-black
const SPOT_WARM = 0xff4d1f;  // fluorescent orange-red — the one anchor
const SPOT_COOL = 0x2a4fd6;  // federal blue, sparingly

/* Shader colours skip THREE.Color on purpose: it decodes sRGB into the linear
   working space, and every tone in here is authored in sRGB because that is
   the space the plate separation reads. A vec3 carries the literal bytes. */
const srgbVec = (hex) => {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* ------------------------------------------------------------ GLSL chunks */

/* Ink authoring. Everything downstream of OutputPass is raw sRGB, and the
   print pass reads luminance, so tones are mixed in sRGB and only pushed to
   linear on the way out. k is ink coverage: 0 bare paper, 1 solid ink.

   `flat_()` is the whole art direction in one line — the press has no ramps,
   so neither does the scene. Quantise before you tint. (The trailing
   underscore is not style: `flat` is a reserved interpolation qualifier.) */
const INK_GLSL = /* glsl */`
  const vec3 PAPER_S = vec3(0.937, 0.902, 0.824);
  const vec3 INK_S   = vec3(0.133, 0.125, 0.109);
  vec3 inkTone(float k, vec3 hue) {
    return pow(mix(PAPER_S, hue, clamp(k, 0.0, 1.0)), vec3(2.2));
  }
  vec3 inkTone(float k) { return inkTone(k, INK_S); }
  float flat_(float v, float steps) { return floor(v * steps + 0.5) / steps; }
  // Saturation is a plate assignment, not a mood: keep the body inks under the
  // pass's ~0.16 spot threshold or the whole ball prints fluorescent.
  vec3 desat(vec3 c, float keep) {
    return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, keep);
  }`;

/* Drag interaction. Instead of a standing swell deforming the shell, the water
   answers the pointer: each drag sample drops a disturbance on the sphere and
   the shading carries an expanding ring away from it. Angular distance is used
   rather than euclidean, so a ring travels *over* the surface at a constant
   rate however the ball is turned, and the geometry stays a true sphere. */
const RIPPLE_GLSL = /* glsl */`
  uniform vec3 uRipOrigin[${RIPPLES}];
  uniform float uRipAge[${RIPPLES}];      // seconds alive; negative = free slot
  uniform float uRipAmp[${RIPPLES}];

  float rippleAt(vec3 dir) {
    float sum = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      float age = uRipAge[i];
      if (age < 0.0) continue;
      float d = acos(clamp(dot(dir, uRipOrigin[i]), -1.0, 1.0));
      float front = age * 1.05;                       // radians per second
      float w = d - front;
      // a lead crest plus one trailing wave, both dying with age and distance
      float crest = exp(-w * w * 120.0);
      float trail = exp(-(w + 0.16) * (w + 0.16) * 190.0) * 0.45;
      sum += (crest + trail) * exp(-age * 1.15) * uRipAmp[i];
    }
    return sum;
  }`;

const boot = () => {
  const E = window.EcoTank;
  if (!E) return;
  const { WORLD, SPECIES, COLORS, REL_COLORS, ZONES, settings, view } = E;

  const canvas = document.getElementById('tankCanvas');
  if (!canvas) return;

  /* ---------------------------------------------------------------- stage */
  // preserveDrawingBuffer costs a per-frame copy, so it is only on for local
  // development, where it is the difference between being able to read the
  // rendered frame back out of the canvas and not. Production never pays it.
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, preserveDrawingBuffer: isDev,
  });
  // The empty frame is the poster's negative space, so it has to be the
  // *no-ink* value rather than the paper swatch: the pass paints the stock
  // itself and reads 1-luminance as coverage, so clearing to PAPER flat would
  // lay an 11% screen over the whole sheet. This is paper's white end, and it
  // still reads as cream if the print pass is ever taken off.
  // White, not cream: the pass paints the paper, and anything the clear leaves
  // above zero coverage screens the negative space. uWhite would swallow a
  // little of it anyway, but the dropout is there for the shading, not to hide
  // a background that should not have been inked in the first place.
  renderer.setClearColor(0xffffff, 1);
  // No tone mapping. A filmic curve is a gradient generator, and every value in
  // here was chosen as an ink coverage — it has to land where it was put.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  camera.position.set(HOME_DIST * 0.55, HOME_DIST * 0.42, HOME_DIST * 0.72);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.5;
  controls.enablePan = false;            // a ball has no meaningful pan
  controls.minDistance = R * 0.30;       // deepest dive, inside the living shell
  controls.maxDistance = R * 9;          // far enough to print the ball as a stamp

  // RenderPass -> OutputPass -> zine. OutputPass encodes to sRGB, and the zine
  // plate separates that sRGB frame into ink, so it has to come after. There is
  // no bloom: glow is the exact opposite of ink on paper.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  const zine = zinePass();
  composer.addPass(zine);

  /* ------------------------------------------------------------- ripples */
  const ripOrigin = Array.from({ length: RIPPLES }, () => new THREE.Vector3(0, 1, 0));
  const ripAge = new Float32Array(RIPPLES).fill(-1);
  const ripAmp = new Float32Array(RIPPLES).fill(0);
  let ripCursor = 0;
  const rippleUniforms = () => ({
    uRipOrigin: { value: ripOrigin },
    uRipAge: { value: ripAge },
    uRipAmp: { value: ripAmp },
  });

  function spawnRipple(pointOnSphere, strength) {
    ripOrigin[ripCursor].copy(pointOnSphere).normalize();
    ripAge[ripCursor] = 0;
    ripAmp[ripCursor] = strength;
    ripCursor = (ripCursor + 1) % RIPPLES;
  }

  function ageRipples(dt) {
    for (let i = 0; i < RIPPLES; i += 1) {
      if (ripAge[i] < 0) continue;
      ripAge[i] += dt;
      if (ripAge[i] > 3.4) ripAge[i] = -1;          // ring has faded out
    }
  }

  /* ---------------------------------------------------- coordinate mapping */
  const LON_K = (Math.PI * 2) / WORLD.width;
  const DEPTH_SPAN = WORLD.floor - WORLD.waterTop;
  const PX = (Math.PI * 2 * R) / WORLD.width;   // one tank pixel in world units
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* Measured on a settled world: ~89% of organisms sit in the bottom 20% of the
     tank, because the plants and the food are on the floor and the grazers —
     and then their predators — follow. Two things compound to bury the whole
     ecosystem in a thumbnail of sphere:

       1. a linear depth->latitude map keeps that crowd inside one narrow band;
       2. the area of a latitude band goes as cos(lat), so a band near the pole
          is the *smallest* patch on the ball.

     So warp depth before mapping it, letting the crowded floor band claim most
     of the range, then go through asin so equal warped-depth intervals cover
     equal surface area. The simulation is untouched; this is only how its
     vertical axis gets laid out on the sphere. */
  const SIN_MAX_LAT = Math.sin(MAX_LAT);
  const DEPTH_WARP = 2.6;

  function lonLatRad(x, y, z) {
    const t = clamp((y - WORLD.waterTop) / DEPTH_SPAN, 0, 1);   // 0 surface, 1 floor
    const zf = clamp((z || 0) / WORLD.depth, 0, 1);
    const warped = Math.pow(t, DEPTH_WARP);
    // radius gives the shell its thickness, but bottom-dwellers get pressed out
    // onto the seabed cap — a snail floating above the rock reads as a bug
    const free = R * (INNER + (0.98 - INNER) * zf);
    return {
      lon: x * LON_K,
      lat: Math.asin(clamp((1 - 2 * warped) * SIN_MAX_LAT, -1, 1)),
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
    // Normal blending, not additive: adding light to a light ground only ever
    // washes it out. The shell now *draws* rather than glows.
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 }, uSun: { value: SUN.clone() },
      uSunI: { value: 1 }, uMurk: { value: 0 }, uFlash: { value: 0 },
      uChop: { value: 1 },
      ...rippleUniforms(),
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      void main() {
        // A true sphere. The swell used to displace this shell along its
        // normal, which made the vessel lumpy rather than turned.
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform float uSunI;
      uniform float uMurk; uniform float uFlash;
      uniform float uChop;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${INK_GLSL}
      ${RIPPLE_GLSL}
      void main() {
        vec3 n = normalize(vN); vec3 v = normalize(vView);
        vec3 dir = normalize(vPos);
        // The fresnel wrap is gone. A printed sphere is a filled shape with a
        // drawn contour, so all this shell does now is lay that contour down —
        // one hard band at the silhouette, nothing across the face.
        float f = 1.0 - abs(dot(n, v));
        float rim = smoothstep(0.66, 0.80, f);
        // and the drag wake, as a hard light line scratched back to paper
        float wake = smoothstep(0.26, 0.44, rippleAt(dir));
        float a = clamp(rim * 0.88 + wake * 0.60 + uFlash * 0.25, 0.0, 1.0);
        // contour is ink, wake is paper; whichever is present wins the pixel
        vec3 col = mix(inkTone(0.05), inkTone(0.92), rim / max(rim + wake, 0.001));
        col = mix(col, inkTone(0.0), uFlash * 0.7);   // lightning knocks it to blank stock
        gl_FragColor = vec4(col, a * (1.0 - uMurk * 0.10));
      }`,
  });
  const surface = new THREE.Mesh(shellGeo, surfaceMat);
  surface.renderOrder = 24;
  scene.add(surface);

  // Inner face of the same shell, and the poster's main fill: one flat body of
  // ink in five steps. Everything else in the ball is judged against this tone.
  const volumeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN.clone() }, uInside: { value: 0 },
      uSunI: { value: 1 }, uMurk: { value: 0 }, uFlash: { value: 0 },
      ...rippleUniforms(),
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform float uInside;
      uniform float uSunI; uniform float uMurk; uniform float uFlash;
      varying vec3 vN; varying vec3 vView; varying vec3 vPos;
      ${INK_GLSL}
      ${RIPPLE_GLSL}
      void main() {
        vec3 dir = normalize(vPos);
        float depth = smoothstep(-0.95, 0.85, dir.y);   // 0 seabed .. 1 lit pole
        float lam = dot(dir, uSun) * 0.5 + 0.5;
        // Day and night are ink density, not room brightness: the shaded side
        // and the small hours simply take more ink. Keep the whole body between
        // 0.24 and 0.62 so organisms have somewhere darker to sit.
        // The water is the *field*, not the subject. Hold it between 0.12 and
        // 0.38 so the ecosystem has three quarters of the scale to itself —
        // at 0.24..0.62 the shell printed as a grey slab and a fish laid on top
        // of it had nowhere darker to go.
        float k = mix(0.38, 0.12, depth * 0.72 + 0.28 * lam);
        k += (1.0 - uSunI) * 0.10;          // night: a heavier plate
        k += uMurk * 0.08;                  // storm: murkier, not darker
        k = flat_(k, 5.0);                  // five tones, no ramp between them
        // Warmth is the other half of the clock. The cool ink is matched to the
        // warm one in luminance on purpose: swapping temperature must not
        // quietly change how much coverage the plate asks for.
        vec3 hue = mix(INK_S, vec3(0.098, 0.126, 0.178),
                       clamp(0.30 * uMurk + 0.45 * (1.0 - uSunI), 0.0, 1.0));
        vec3 body = inkTone(k, hue);
        // ripples lift ink off the plate instead of adding light to it
        body = mix(body, inkTone(k * 0.35, hue), smoothstep(0.18, 0.55, rippleAt(dir)));
        gl_FragColor = vec4(mix(body, inkTone(0.0), uFlash * 0.55), 1.0);
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
      ${INK_GLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 nUp = gl_FrontFacing ? -n : n;
        // Rock prints heavier than water, in four steps. The dunes read through
        // which step a face lands in — that stepping *is* the modelling now,
        // which is why the shading has to quantise rather than ramp.
        float lam = dot(nUp, uSun) * 0.5 + 0.5;
        float k = mix(0.52, 0.28, lam) + (1.0 - uSunI) * 0.08;
        gl_FragColor = vec4(mix(inkTone(flat_(k, 4.0)), inkTone(0.0), uFlash * 0.4), 1.0);
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

  /* Catmull-Rom resample: fins authored as a few control points come out as
     smooth curves rather than hard polygons. Rounding the silhouette is most
     of what stops a low-poly mesh reading as faceted. */
  function smoothOutline(pts, n) {
    if (pts.length < 3) return pts;
    const out = [];
    const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < n; k += 1) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
            + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
            + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
            + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
            + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
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
    // Short, deep body: the mass sits forward and the peduncle pinches hard, so
    // the oversized tail reads as the thing doing the work.
    const L = 0.84;
    sweep(B, {
      len: L, seg: 34, ring: 20,          // 12 rings still read as facets
      profile: (t) => {
        // rounder teardrop: fuller belly, blunter nose than the old 0.62 power
        const s = Math.pow(Math.sin(Math.pow(t, 0.80) * Math.PI), 0.78);
        const pinch = 0.18 + 0.82 * Math.pow(t, 0.55);
        return [0.140 * k.girth * s * pinch, 0.235 * k.depth * s * pinch];
      },
    });
    const tl = 0.28 * k.tail;                      // fan, not a kite
    const th = 0.20 * k.tail;
    // deeply forked caudal fan, swept back so it trails the beat
    fan(B, smoothOutline([[-L / 2 + 0.01, 0],
            [-L / 2 - tl * 0.75, th], [-L / 2 - tl, th * 1.12],
            [-L / 2 - tl * 0.48, 0],
            [-L / 2 - tl, -th * 1.12], [-L / 2 - tl * 0.75, -th]], 6), 'xy', 0.0);
    // tall thin dorsal, set well back
    fan(B, smoothOutline([[-0.14, 0.075], [-0.06, 0.075 + 0.15 * k.dorsal],
            [0.02, 0.075 + 0.17 * k.dorsal], [0.14, 0.065]], 6), 'xy', 0.46);
    fan(B, smoothOutline([[-0.17, -0.065], [-0.10, -0.065 - 0.15 * k.dorsal],
            [-0.04, -0.065 - 0.16 * k.dorsal], [0.02, -0.055]], 6), 'xy', 0.40);
    // long gauzy pectorals, the thing that sells a turn
    fan(B, smoothOutline([[0.15, 0.02], [0.07, 0.11 * k.pect],
            [0.00, 0.15 * k.pect], [0.04, 0.02]], 5), 'xz', 0.74);
    fan(B, smoothOutline([[0.15, -0.02], [0.04, -0.02],
            [0.00, -0.15 * k.pect], [0.07, -0.11 * k.pect]], 5), 'xz', 0.74);
    return finish(B);
  }

  /* ---- shrimp: arched carapace, fanned uropods, antennae ---- */
  function shrimpGeometry() {
    const B = Builder();
    sweep(B, {
      len: 0.9, seg: 28, ring: 16,
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
    const TURNS = 2.35, SEG = 92, RING = 18;
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
      len: 0.86, seg: 20, ring: 16,
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
      len: 0.8, seg: 18, ring: 14,
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
    bigfish: fishGeometry({ girth: 1.00, depth: 1.15, tail: 1.10, dorsal: 1.20, pect: 1.05 }),
    smallfish: fishGeometry({ girth: 0.80, depth: 0.92, tail: 1.05, dorsal: 0.90, pect: 1.10 }),
    cleaner: fishGeometry({ girth: 0.62, depth: 0.66, tail: 1.00, dorsal: 0.58, pect: 0.95 }),
    shrimp: shrimpGeometry(),
    snail: snailGeometry(),
    louse: louseGeometry(),
  };

  /* ===================================================== ORGANISM MATERIAL */

  /* The swim deformation is needed by both the body and its outline hull, so it
     lives in one string that both vertex shaders include. */
  const SWIM_VERT = /* glsl */`
    attribute float aSpine;
    attribute float aGlow;
    attribute float aBeat;
    attribute float aTurn;
    uniform float uTime; uniform float uSwim; uniform float uMode;

    /* Four swimming gaits. The thing that decides whether a fish reads as
       swimming or as vibrating is how many wavelengths sit on the body: real
       fish carry well under one, and the first version of this used 1.4-2,
       which is why it looked like tail jitter. aBeat is normalised effort
       (0 idle .. ~1.6 fleeing), not a frequency, so each gait sets its own
       tempo and stays slow.                                                */
    vec3 swim(vec3 pos, float spine, float phase) {
      float body = 1.0 - spine;              // 0 at the nose, 1 at the tail
      float effort = clamp(aBeat, 0.0, 1.6);
      // gentler: half the throw, and effort barely widens it. A fish should
      // read as unhurried even when it is moving quickly.
      float amp = uSwim * (0.38 + 0.22 * effort);
      float env, wave, gate = 1.0;

      if (uMode < 0.5) {
        // 0 — anguilliform: the whole body undulates, eel-like. Amplitude
        // never fully dies at the head, so nothing is rigid.
        float W = 0.95 * (0.65 + 0.45 * effort);
        env = 0.22 + 0.78 * body;
        wave = sin(body * 4.0 - uTime * W + phase);
      } else if (uMode < 1.5) {
        // 1 — carangiform: front third stiff, rear half does the work. The
        // classic trout/tuna gait.
        float W = 1.15 * (0.65 + 0.50 * effort);
        env = pow(body, 2.0);
        wave = sin(body * 3.1 - uTime * W + phase);
      } else if (uMode < 2.5) {
        // 2 — power stroke: same travelling wave, but time is skewed so the
        // fish sweeps fast through the middle of the stroke and lingers at
        // the extremes. That asymmetry is what reads as a push.
        float W = 0.85 * (0.65 + 0.45 * effort);
        float ph = uTime * W - phase;
        float sk = ph + 0.40 * sin(ph);      // fast through zero, slow at the ends
        env = 0.26 + 0.74 * pow(body, 1.35);
        wave = sin(body * 2.9 - sk);
      } else {
        // 3 — glide and burst: a short beat, then a long coast. The body
        // holds its curve through the glide instead of going limp.
        float W = 1.35 * (0.65 + 0.55 * effort);
        float cyc = fract(uTime * 0.19 * (0.6 + 0.5 * effort) + phase * 0.15);
        gate = smoothstep(0.0, 0.10, cyc) * (1.0 - smoothstep(0.30, 0.68, cyc));
        gate = 0.16 + 0.84 * gate;
        env = 0.20 + 0.80 * pow(body, 1.5);
        wave = sin(body * 3.3 - uTime * W + phase);
      }

      pos.z += wave * env * amp * gate;
      // and the whole body arcs through a turn, tail swinging widest
      pos.z += aTurn * 0.085 * pow(body, 1.3);
      return pos;
    }
    // stable per-fish phase from where it is, not which instance slot it landed
    // in — the slot reshuffles every frame, the position does not
    float phaseFromPos(mat4 im) {
      vec3 t = vec3(im[3][0], im[3][1], im[3][2]);
      return t.x * 0.7 + t.y * 1.3 + t.z * 0.9;
    }`;

  /* Printed specimen. Three flat tones and a hard contour — a woodcut of a
     fish, not a lit model of one. The species colour survives only as a hint of
     temperature: it is desaturated hard so the body stays on the ink plate
     instead of being promoted to the fluorescent spot, which is reserved. */
  function organismMaterial(species, swim, freq) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uSwim: { value: swim }, uMode: { value: 2 },
        uSun: { value: SUN.clone() }, uSunI: { value: 1 },
        uBase: { value: srgbVec(COLORS[species]) },
      },
      vertexShader: `
        ${SWIM_VERT}
        varying vec3 vN; varying vec3 vView; varying float vSpine; varying float vGlow;
        varying float vDorsal;
        void main() {
          // where this vertex sits between belly and back, for countershading
          vDorsal = clamp(position.y * 4.2, -1.0, 1.0);
          vec4 world = instanceMatrix * vec4(swim(position, aSpine, phaseFromPos(instanceMatrix)), 1.0);
          vec4 mv = modelViewMatrix * world;
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vView = normalize(-mv.xyz);
          vSpine = aSpine; vGlow = aGlow;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uBase; uniform float uTime; uniform vec3 uSun; uniform float uSunI;
        varying vec3 vN; varying vec3 vView; varying float vSpine; varying float vGlow;
        varying float vDorsal;
        ${INK_GLSL}
        void main() {
          vec3 n = normalize(vN); vec3 v = normalize(vView);
          float lam = dot(n, uSun) * 0.5 + 0.5;
          // Three tones across the body and a fourth at the contour. Any more
          // and the screen turns them back into a gradient of dot sizes.
          // Sit well below the water's 0.24..0.62: a body that shares the
          // shell's tone is a body you cannot find, and at this camera distance
          // the contour alone is two pixels wide.
          float k = mix(0.82, 0.58, flat_(lam, 3.0));
          // countershading survives as one step, not a ramp: pale belly, dark back
          k += 0.10 * step(0.0, vDorsal) - 0.08 * step(vDorsal, 0.0);
          k -= (1.0 - uSunI) * 0.06;        // at night the water darkens past them
          // hard inked edge — the silhouette is what a print has instead of light
          k += smoothstep(0.55, 0.78, 1.0 - abs(dot(n, v))) * 0.30;
          // condition reads as a lighter, hungrier plate
          k *= 0.86 + 0.14 * clamp(vGlow, 0.0, 1.6);
          gl_FragColor = vec4(inkTone(k, desat(uBase * 0.42 + INK_S * 0.58, 0.22)), 1.0);
        }`,
    });
  }

  const SWIM = {
    bigfish: [0.065, 0], smallfish: [0.080, 0], cleaner: [0.085, 0],
    shrimp: [0.050, 0], snail: [0.004, 0], louse: [0.030, 0],
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
    const glow = new Float32Array(cap);
    const beat = new Float32Array(cap);
    const turn = new Float32Array(cap);
    mesh.geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 1));
    mesh.geometry.setAttribute('aTurn', new THREE.InstancedBufferAttribute(turn, 1));
    mesh.geometry.setAttribute('aBeat', new THREE.InstancedBufferAttribute(beat, 1));
    mesh.count = 0;
    mesh.renderOrder = 10;
    scene.add(mesh);

    pools[species] = { mesh, glow, beat, turn, cap, ids: [] };
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
    // Bank: roll the dorsal axis about the heading, proportional to how hard
    // the agent is turning. This is the single biggest tell between a fish and
    // a model being dragged along a path.
    const bank = clamp(-(v.turn || 0) * 3.4, -0.40, 0.40);
    if (bank !== 0) {
      const cb = Math.cos(bank), sb = Math.sin(bank);
      const ux = up.x, uy = up.y, uz = up.z;
      up.set(ux * cb + side.x * sb, uy * cb + side.y * sb, uz * cb + side.z * sb).normalize();
      side.crossVectors(fwd, up).normalize();
    }
    M.makeBasis(fwd, up, side);
    Q.setFromRotationMatrix(M);

    const spec = SPECIES[agent.species];
    const grow = clamp(0.45 + 0.55 * (agent.age / Math.max(1, spec.matureAge)), 0.45, 1);
    const len = spec.size * 2.3 * PX * grow;
    S.set(len, len, len);
    M.compose(P, Q, S);
    pool.mesh.setMatrixAt(index, M);

    const energyFrac = clamp(agent.energy / spec.maxEnergy, 0, 1);
    const fleeing = agent.action && (agent.action.type === 'flee' || agent.action.type === 'hide');
    // a starving animal dims; a frightened one flares and beats faster
    pool.glow[index] = 0.30 + energyFrac * 0.85 + (fleeing ? 0.45 : 0);
    // normalised effort, not a frequency: each gait picks its own tempo
    pool.beat[index] = clamp((v.spd || 0) / 3.2, 0, 1) + (fleeing ? 0.6 : 0);
    pool.turn[index] = clamp((v.turn || 0) * 3.0, -1, 1);
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
      pool.mesh.geometry.getAttribute('aTurn').needsUpdate = true;
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

  const PLANT_CAP = 260;
  const SWAY_VERT = /* glsl */`
    uniform float uTime;
    vec3 sway(vec3 p, mat4 im) {
      float ph = im[3][0] * 0.6 + im[3][2] * 1.1;   // per-blade, from position
      float t = p.y;
      float bend = sin(uTime * 0.85 + ph) * 0.30 + sin(uTime * 1.9 + ph * 1.7) * 0.10;
      p.x += bend * t * t;
      p.z += cos(uTime * 0.7 + ph * 1.3) * 0.16 * t * t;
      return p;
    }`;

  const plantMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uSunI: { value: 1 },
      uBase: { value: srgbVec(COLORS.plant) },
    },
    vertexShader: `
      ${SWAY_VERT}
      varying vec2 vUv; varying float vT;
      void main() {
        vUv = uv; vT = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(sway(position, instanceMatrix), 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uBase; uniform float uTime; uniform float uSunI;
      varying vec2 vUv; varying float vT;
      ${INK_GLSL}
      void main() {
        // Two tones per blade, split at half height, plus an inked spine down
        // the middle. Blades print darker than the rock they root in, which is
        // the only thing keeping a bed from dissolving into the seabed.
        float k = mix(0.80, 0.58, flat_(vT, 2.0)) - (1.0 - uSunI) * 0.05;
        k += (1.0 - smoothstep(0.0, 0.22, abs(vUv.x * 2.0 - 1.0))) * 0.10;
        gl_FragColor = vec4(inkTone(k, desat(uBase * 0.40 + INK_S * 0.60, 0.24)), 1.0);
      }`,
  });

  const plants = new THREE.InstancedMesh(bladeGeo, plantMat, PLANT_CAP);
  plants.frustumCulled = false;
  plants.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  plants.count = 0;
  plants.renderOrder = 10;
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
      let lat, lon = plant.x * LON_K, rootR;
      if (plant.benthic === false) {
        // drifting bed: sits where its own depth maps to, like any organism
        const ll = lonLatRad(plant.x, plant.y, plant.z == null ? WORLD.depth / 2 : plant.z);
        lat = ll.lat; rootR = ll.r;
      } else {
        // rooted on the cap; latitude spread by a stable hash so beds cover the
        // seabed instead of stacking on one ring
        const h1 = Math.sin((plant.x + 1) * 12.9898 + (plant.y + 1) * 78.233) * 43758.5453;
        const spread = h1 - Math.floor(h1);                  // stable 0..1
        lat = -(CAP_LAT + 0.04 + spread * (Math.PI / 2 - CAP_LAT - 0.10));
        rootR = R * 0.93;
      }
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const co = Math.cos(lon), so = Math.sin(lon);
      radial.set(cl * co, sl, cl * so);
      north.set(-co * sl, cl, -so * sl);
      // Root just inside the skin and grow mostly *along* the sphere toward the
      // lit pole. Growing radially pushed every blade straight out through the
      // surface, which read as a beard hanging off the bottom of the ball.
      P.copy(radial).multiplyScalar(rootR);
      up.copy(north).multiplyScalar(0.94).addScaledVector(radial, -0.10).normalize();
      tA.copy(Math.abs(up.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : POLE).cross(up).normalize();
      tB.copy(up).cross(tA).normalize();

      const blades = 1 + Math.min(1, Math.floor(plant.biomass / 40));
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
    // Not additive any more: a beam on paper is stock left unprinted, so these
    // are paper-coloured wedges laid *over* the water body, knocking it back.
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uSunI: { value: 1 }, uMurk: { value: 0 },
    },
    vertexShader: `
      attribute float aAlong; attribute float aSeed;
      varying float vAlong; varying float vSeed;
      void main() {
        vAlong = aAlong; vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uSunI; uniform float uMurk;
      varying float vAlong; varying float vSeed;
      ${INK_GLSL}
      void main() {
        // A hard stop where the beam ends, not a falloff. The flicker is gone:
        // a print does not shimmer, and the plate would only chatter.
        float a = (1.0 - smoothstep(0.30, 0.92, vAlong))
                * uSunI * (1.0 - uMurk * 0.7) * 0.16;
        gl_FragColor = vec4(inkTone(0.0), a);
      }`,
  });
  const shafts = new THREE.Mesh(shaftGeo, shaftMat);
  shafts.frustumCulled = false;
  shafts.renderOrder = 6;
  scene.add(shafts);

  /* =============================================================== SKY BODIES
     Sun, cloud deck and rain. The rain is the interesting one: a drop that
     reaches the shell spawns a ripple through the same path a mouse drag uses,
     so weather and pointer disturb the water through one mechanism. */

  const SKY_R = R * 1.34;           // cloud deck radius
  const RAIN_COUNT = 900;

  /* One flat disc, white so the material colour can tint it, with the softness
     confined to a single pixel of anti-aliasing. The old halo texture went with
     the halo: a soft radial falloff is precisely what the screen cannot print. */
  const discTexture = (() => {
    const px = 128;
    const c = Object.assign(document.createElement('canvas'), { width: px, height: px });
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.94, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, px, px);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // --- sun: one flat spot-orange disc, the poster's single high-chroma anchor.
  // depthTest is on now that it is opaque: an ink disc pasted over the ball when
  // the sun is behind it read as a sticker.
  const sunGroup = new THREE.Group();
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTexture, color: SPOT_WARM,
    transparent: true, depthWrite: false,
  }));
  sunDisc.scale.setScalar(R * 0.30);
  sunGroup.add(sunDisc);
  sunGroup.renderOrder = 2;
  scene.add(sunGroup);

  // --- cloud deck: flat puffs scattered over a cap above the ball ---
  const CLOUDS = 130;
  const cloudGeo = new THREE.BufferGeometry();
  const cloudPos = new Float32Array(CLOUDS * 3);
  const cloudSeed = [];
  for (let i = 0; i < CLOUDS; i += 1) {
    // clustered into a handful of banks rather than an even dusting
    const bank = Math.floor(i / 11);
    cloudSeed.push({
      lon: (bank * 1.9 + (i % 11) * 0.16) % (Math.PI * 2),
      lat: 0.55 + ((bank * 7) % 5) / 5 * 0.75 + ((i % 11) - 5) * 0.035,
      drift: 0.012 + ((bank * 3) % 4) / 4 * 0.02,
      size: R * (0.20 + ((i * 5) % 7) / 7 * 0.26),
    });
  }
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(cloudPos, 3));
  cloudGeo.setAttribute('size', new THREE.BufferAttribute(
    new Float32Array(cloudSeed.map((c) => c.size)), 1));
  // a light flat tone (k ~0.22) so a bank of overlapping discs stacks into two
  // or three steps of grey on bare paper rather than into a soft mass
  const cloudMat = new THREE.PointsMaterial({
    map: discTexture, transparent: true, depthWrite: false,
    size: R * 0.34, sizeAttenuation: true, opacity: 0.0,
    color: new THREE.Color(0xc4bba7),
  });
  const clouds = new THREE.Points(cloudGeo, cloudMat);
  clouds.frustumCulled = false;
  clouds.renderOrder = 3;
  scene.add(clouds);

  // --- rain: falls from the deck onto the shell, then rings the water ---
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  const drops = [];
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    drops.push({ dir: new THREE.Vector3(), r: 0, v: 0, live: false });
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  // rain is ink specks on paper — pale blue drops simply vanish off a light ground
  const rainMat = new THREE.PointsMaterial({
    color: INK, size: 1.7, transparent: true, opacity: 0.55,
    depthWrite: false, sizeAttenuation: true,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  scene.add(rain);

  function seedDrop(d) {
    // start somewhere over the lit hemisphere-ish cap, fall inward
    const lon = Math.random() * Math.PI * 2;
    const lat = 0.15 + Math.random() * 1.25;
    const cl = Math.cos(lat);
    d.dir.set(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon));
    d.r = SKY_R * (0.90 + Math.random() * 0.18);
    d.v = 26 + Math.random() * 22;
    d.live = true;
  }

  const dropP = new THREE.Vector3();

  function stepWeather(dt) {
    // ---- sun rides the day arc. It does not dim or redden: a spot plate is
    // either laid down or it is not, so the disc simply sets and is gone.
    sunGroup.position.copy(SUN).multiplyScalar(R * 2.5);
    const up = Math.max(0, SUN.y);
    sunDisc.material.opacity = sky.sun * (0.35 + 0.65 * up) > 0.18 ? 1 : 0;
    sunGroup.visible = sunDisc.material.opacity > 0;

    // ---- cloud cover tracks the weather, and the deck drifts
    const cover = clamp(sky.murk * 1.25, 0, 1);
    // 0.9 stacked 130 overlapping discs into one flat lid over the ball. A deck
    // only has to be legible as a deck; the screen will find the tone.
    cloudMat.opacity = cover * 0.30;
    clouds.visible = cover > 0.02;
    if (clouds.visible) {
      const attr = cloudGeo.getAttribute('position');
      for (let i = 0; i < CLOUDS; i += 1) {
        const c = cloudSeed[i];
        c.lon += c.drift * dt;
        const cl = Math.cos(c.lat);
        attr.setXYZ(i,
          SKY_R * cl * Math.cos(c.lon),
          SKY_R * Math.sin(c.lat),
          SKY_R * cl * Math.sin(c.lon));
      }
      attr.needsUpdate = true;
    }

    // ---- rain, only once the sky is wet enough
    const wet = clamp((sky.murk - 0.5) * 2.2, 0, 1);
    rain.visible = wet > 0.02;
    rainMat.opacity = 0.25 + wet * 0.45;
    const want = Math.floor(RAIN_COUNT * wet);
    const attr = rainGeo.getAttribute('position');
    let n = 0;
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      const d = drops[i];
      if (!d.live) { if (n < want) seedDrop(d); else continue; }
      d.r -= d.v * dt;
      if (d.r <= R) {
        // impact: ring the water through the same path a drag uses
        if (rippleBudget > 0 && Math.random() < 0.16) {
          spawnRipple(d.dir, 0.30 + Math.random() * 0.25);
          rippleBudget -= 1;
        }
        if (n < want) seedDrop(d); else { d.live = false; continue; }
      }
      dropP.copy(d.dir).multiplyScalar(d.r);
      attr.setXYZ(n, dropP.x, dropP.y, dropP.z);
      n += 1;
    }
    attr.needsUpdate = true;
    rainGeo.setDrawRange(0, n);
  }

  // rain would otherwise claim every ripple slot; refill a small allowance
  let rippleBudget = 2;
  let rippleRefill = 0;

  /* ========================================================= MOTES & FOOD */
  function motePoints(count, size, color, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size, color, transparent: true, opacity, depthWrite: false,
      sizeAttenuation: true,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  }

  // Food is the one thing every animal in here is chasing, so it gets the spot
  // plate. Marine snow goes the other way — faint ink dust, the paper's grain.
  const foodPoints = motePoints(400, 3.6, new THREE.Color(SPOT_WARM), 0.95);
  // 700 specks of ink filled the ball edge to edge and buried the ecosystem in
  // its own dust. Marine snow is a suggestion, not a texture.
  const snowPoints = motePoints(220, 1.3, new THREE.Color(INK), 0.16);
  // Sand lifted off the rock. Coarser and fainter than marine snow, and it
  // never gets more than a sixth of the way up the ball.
  // The seabed cap is most of the ball's surface area, so a few hundred grains
  // land two or three of them in a close-up. Suspension is a density effect or
  // it is nothing — and 4000 points is still one draw call.
  // A grain has to be worth more than one halftone cell or the screen drops it:
  // at 2.6/0.30 the whole cloud was mathematically present and visually absent.
  const sandPoints = motePoints(4000, 3.4, new THREE.Color(INK), 0.5);

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

  const SNOW = Array.from({ length: 220 }, () => ({
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

  /* Suspended sand. The seabed met the water on a hard line, which is the one
     edge on the ball that should have been soft — rock does not stop, it thins
     out into what it has kicked up.

     This is the one mote cloud that cannot go through toSphere(). The tank->ball
     map pushes anything at floor depth out onto the skin (that is what keeps
     snails *on* the rock rather than hovering over it), so a grain authored in
     tank coordinates ends up plastered to the cap. Sand is placed straight in
     world space instead: a direction inside the cap, and a height that lifts it
     off the rock by shrinking its radius.

     Each grain's ceiling is a cubed roll, so most never clear the rock and the
     few that do are what makes the haze read as diffusion rather than as a
     second layer floating above a hard edge. */
  const SAND_LIFT = R * 0.24;
  const SAND_Y0 = -1;                              // bottom pole
  const SAND_Y1 = -Math.sin(CAP_LAT) + 0.05;       // just over the rock's rim
  // Cubed put every grain inside three units of the rock, which is a texture on
  // the cap, not a suspension. 1.7 still stacks them low but lets a tail climb.
  const newSandTop = () => SAND_LIFT * Math.random() ** 1.7;
  const SAND = Array.from({ length: 4000 }, () => ({
    lon: Math.random() * Math.PI * 2,
    y: SAND_Y0 + Math.random() * (SAND_Y1 - SAND_Y0),
    h: Math.random() * SAND_LIFT,
    top: newSandTop(),
    v: R * (0.0004 + Math.random() * 0.0011),
    drift: (Math.random() - 0.5) * 0.0035,         // radians of longitude a frame
  }));

  function stepSand() {
    const attr = sandPoints.geometry.getAttribute('position');
    for (let i = 0; i < SAND.length; i += 1) {
      const s = SAND[i];
      s.h += s.v;
      s.lon += s.drift;
      if (s.h > s.top) {                           // out of suspension, settles
        s.h = 0;
        s.top = newSandTop();
        s.lon = Math.random() * Math.PI * 2;
        s.y = SAND_Y0 + Math.random() * (SAND_Y1 - SAND_Y0);
      }
      const r = R * 0.99 - s.h;
      const cl = Math.sqrt(Math.max(0, 1 - s.y * s.y));
      attr.setXYZ(i, r * cl * Math.cos(s.lon), r * s.y, r * cl * Math.sin(s.lon));
    }
    attr.needsUpdate = true;
    sandPoints.geometry.setDrawRange(0, SAND.length);
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
  // Multiply, not add: an overlay line on paper is ink laid on top, so it can
  // only ever darken what is under it. White means "no ink here", which is how
  // a faint link now fades out — see seg().
  // three refuses MultiplyBlending without premultipliedAlpha, and at alpha 1
  // that path is exactly dst*src — so opacity stays 1 and strength lives in the
  // colour. Anything else and the blend silently becomes a lerp toward black.
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1, depthWrite: false,
    blending: THREE.MultiplyBlending, premultipliedAlpha: true,
  }));
  lines.frustumCulled = false;
  lines.renderOrder = 12;
  scene.add(lines);

  let segCount = 0;
  const cA = new THREE.Color();
  const cInk = new THREE.Color(INK);
  const cNone = new THREE.Color(0xffffff);   // multiply identity: no ink
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  function seg(ax, ay, az, bx, by, bz, color, alpha) {
    if (segCount >= MAX_SEG) return;
    const i = segCount * 6;
    linePos[i] = ax; linePos[i + 1] = ay; linePos[i + 2] = az;
    linePos[i + 3] = bx; linePos[i + 4] = by; linePos[i + 5] = bz;
    // The link palette stays as hue but is pulled most of the way to ink — the
    // pastels it ships with are lighter than the water they draw over. Strength
    // is distance from white, because that is what multiply reads.
    // ...and the alpha goes through a sqrt on the way in. The callers hand over
    // 0.2..0.45 for anything that is not urgent, and multiply reads that as
    // "almost no ink" — the whole overlay printed as a rumour over the water.
    cA.set(color).lerp(cInk, 0.55).lerp(cNone, 1 - Math.sqrt(clamp(alpha, 0, 1)));
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
      arc(agentPos(a, pA), agentPos(b, pB), REL_COLORS[link.type] || '#ffffff', 0.34);
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
          seg(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, COLORS[sp], (1 - d / 92) * 0.09);
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
  // the selection ring earns the spot plate: it is the one thing on the sheet
  // that has to be found instantly
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.94, 64),
    new THREE.MeshBasicMaterial({
      color: SPOT_WARM, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    }),
  );
  halo.renderOrder = 30;
  halo.visible = false;
  scene.add(halo);

  /* lifecycle FX: an expanding shockwave ring, tinted per event type.
     ponytail: one ring for all three events. Split it only if the demo
     script ever needs to call out a specific death. */
  // Three inks, no neon: a death takes the warm spot, a birth is plain ink, a
  // contest is the blue — which is the whole budget for the cool plate.
  const FX_COLOR = { death: SPOT_WARM, birth: INK, contest: SPOT_COOL };
  const FX_POOL = [];
  function fxRing() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.80, 1.0, 48),
      new THREE.MeshBasicMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
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
      const size = (2 + life * 8) * PX;
      m.scale.set(size, size, 1);
      m.material.color.setHex(FX_COLOR[fx.type] || INK);
      m.material.opacity = (1 - life) * 0.75;   // no bloom to carry it any more
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

  /* Drag disturbs the water. Each sample is raycast onto the shell and dropped
     in as a ring source, rate-limited by angular travel so a slow drag leaves a
     trail rather than a solid smear. */
  const ripRay = new THREE.Raycaster();
  const ripNdc = new THREE.Vector2();
  const lastHit = new THREE.Vector3();
  let hasLastHit = false;

  function dragRipple(e, strength) {
    const r = canvas.getBoundingClientRect();
    ripNdc.set(((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    ripRay.setFromCamera(ripNdc, camera);
    const hit = ripRay.intersectObject(surface, false)[0];
    if (!hit) { hasLastHit = false; return; }
    const p = hit.point.clone().normalize();
    if (hasLastHit && p.angleTo(lastHit) < 0.09) return;   // too close to the last one
    lastHit.copy(p);
    hasLastHit = true;
    spawnRipple(p, strength);
  }

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    hasLastHit = false;
    dragRipple(e, 1.0);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) return;
    dragRipple(e, 0.85);
  });
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
    // Measure the canvas, not its wrapper. The wrapper carries the poster's
    // paper margin and the plate marks, so its box is a couple of dozen pixels
    // wider and taller than the drawing surface — sizing to it stretches the
    // sphere and offsets every pick ray.
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight) || Math.round(w * 0.57));
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
  new ResizeObserver(resize).observe(canvas);

  /* ---------------------------------------------------------------- the sky
     One arc of the sun per DAY_SECONDS, plus a weather state that is re-rolled
     whenever the current one expires and then eased into over a few seconds.
     Everything it produces is a uniform, so weather costs nothing to render. */
  const sky = {
    phase: 0.26,                                  // 0 = midnight, 0.5 = noon
    from: WEATHER.clear, to: WEATHER.clear, blend: 1, hold: 40,
    sun: 1, waves: 1, murk: 0, flash: 0,
    key: 'clear',
  };

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
      if (u.uChop) u.uChop.value = sky.waves;
    };
    set(surfaceMat); set(volumeMat); set(seabed.material); set(shaftMat);
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
    ageRipples(dt);
    rippleRefill -= dt;
    if (rippleRefill <= 0) { rippleBudget = 2; rippleRefill = 0.45; }
    stepWeather(dt);
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
    stepSand();
    if (plantTimer-- <= 0) { rebuildPlants(world); plantTimer = 30; }
    buildLines(world);
    syncFx(world);

    const a = E.getAgent(E.selectedId);
    if (a && a.alive) {
      agentPos(a, P);
      halo.position.copy(P);
      halo.lookAt(camera.position);
      const s = SPECIES[a.species].size * 1.7 * PX * (1 + 0.07 * Math.sin(clock * 7));
      halo.scale.set(s, s, 1);
      halo.visible = true;
    } else {
      halo.visible = false;
    }

    // once the camera is inside the ball the shell would wash out the view
    const dist = camera.position.length();
    const inside = dist < R;
    surface.visible = !inside;
    volume.visible = !inside;          // opaque now, so it would box you in
    volumeMat.uniforms.uInside.value = inside ? 1 : 0;

    surfaceMat.uniforms.uTime.value = clock;
    volumeMat.uniforms.uTime.value = clock;
    seabed.material.uniforms.uTime.value = clock;
    shaftMat.uniforms.uTime.value = clock;
    zine.uniforms.uTime.value = clock;
    plantMat.uniforms.uTime.value = clock;
    plantMat.uniforms.uSunI.value = sky.sun;
    pushSky();
    Object.keys(pools).forEach((s) => {
      const u = pools[s].mesh.material.uniforms;
      u.uTime.value = clock;
      u.uSun.value.copy(SUN);
      u.uSunI.value = sky.sun;
      u.uMode.value = SWIM_MODES.indexOf(settings.swim) < 0 ? 2 : SWIM_MODES.indexOf(settings.swim);
    });

    controls.update();
    composer.render();

    const zoom = HOME_DIST / Math.max(dist, 1);
    if (Math.abs(zoom - view.zoom) > 0.02) { view.zoom = zoom; E.syncHud(); }
  }

  // Handle for tuning the look from the console — every value in here is a
  // shader constant that has to be judged by eye, not derived.
  window.__eco3d = {
    scene, camera, renderer, composer, zine, sky, SUN, controls, THREE,
    surface, volume, seabed, shafts, plants, pools, lines, foodPoints, snowPoints, sandPoints, halo,
    sunGroup, clouds, rain,
  };
  E.setRenderer({ frame, resize });
};

if (window.EcoTank) boot();
else document.addEventListener('DOMContentLoaded', boot, { once: true });
