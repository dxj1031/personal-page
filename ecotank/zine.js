/* =========================================================================
   EcoTank · zine plate pass
   -------------------------------------------------------------------------
   The last pass on the stack. It throws away the render as an *image* and
   reprints it: the frame is separated into three ink plates, each plate is
   screened into halftone dots at its own angle, the plates are laid down on
   aged paper slightly out of register, and they multiply — the way real ink
   sits on real stock. Nothing here glows. That is the point.

   Three plates only, because a riso deck is short:
     INK   warm near-black, 45deg  — holds the drawing
     WARM  fluorescent orange-red, 15deg — the single high-chroma anchor
     COOL  federal blue, 75deg — used sparingly, mostly under the warm

   The screens live in *screen* pixels, not uv-of-anything-moving, so the dots
   belong to the paper and do not swim when the camera orbits. Pitch is in CSS
   px (uv * uResolution), so it stays the same physical size on a retina panel.

   Runs after OutputPass, so tDiffuse is already sRGB-encoded and every colour
   in here is a raw sRGB triple — no working-colour-space conversion anywhere.
   ========================================================================= */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const PAPER = 0xefe6d2;   // aged cream
const INK = 0x22201c;   // warm near-black
const SPOT_WARM = 0xff4d1f;   // fluorescent orange-red
const SPOT_COOL = 0x2a4fd6;   // federal blue

// Colours must survive as the literal sRGB bytes we were given. Passing
// LinearSRGBColorSpace tells three "already in working space" so it skips the
// decode it would otherwise do on the way in.
const raw = (v) => typeof v === 'number'
  ? new THREE.Color().setHex(v, THREE.LinearSRGBColorSpace)
  : new THREE.Color().setStyle(String(v), THREE.LinearSRGBColorSpace);

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2  uResolution;   // CSS px, not device px — keeps pitch physical
uniform vec3  uPaper, uInk, uSpotWarm, uSpotCool;
uniform float uPitch;        // dot pitch, CSS px
uniform float uGrain;        // 0..1 paper fibre
uniform float uSpread;       // ink gain: >1 fattens the midtones
uniform float uWhite;        // highlight dropout: coverage under this prints nothing
uniform float uShimmer;      // grain wobble; 0 = a still print, which is correct
uniform float uMisreg;       // plate offset in CSS px
uniform float uTime;
varying vec2 vUv;

const float PI = 3.14159265;

/* ---- paper -------------------------------------------------------------- */

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Value noise. Bilinear + smoothstep is enough here — this is fibre, not terrain.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

/* ---- screening ---------------------------------------------------------- */

// Rotated-grid dot. The radius has to be area-exact — sqrt(cov/PI) — or the
// screen lies about its own tone: a disc of r=0.5 already fills 79% of its
// cell, so the tempting 0.72*sqrt(cov) prints a 0.45 midtone at ~0.8 coverage
// and every tone above it collapses into solid. The dot only touches the cell
// corners past cov 0.78, where the smoothstep takes it the rest of the way to
// a filled shadow.
float screen(vec2 px, float cov, float angle) {
  if (cov <= 0.001) return 0.0;
  float s = sin(angle), c = cos(angle);
  vec2 p = mat2(c, -s, s, c) * px / uPitch;
  float d = length(fract(p) - 0.5);
  cov = clamp(cov, 0.0, 1.0);
  float r = mix(sqrt(cov / PI), 0.708, smoothstep(0.78, 1.0, cov));
  // One CSS px expressed in cell units. Cheaper and steadier than fwidth, and
  // exact because we already know the cell size in pixels.
  float aa = 0.8 / uPitch;
  return smoothstep(r + aa, r - aa, d);
}

/* ---- separation --------------------------------------------------------- */

vec3 hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

// Everything a plate needs to know about one sample: how much ink it wants,
// how much of that ink belongs to a spot, and which spot.
vec3 separate(vec2 uv, float fibre) {
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float cov = pow(clamp(1.0 - lum, 0.0, 1.0), 1.0 / max(uSpread, 0.05));
  // Paper fibre takes ink unevenly — this is where the xerox mottle comes from.
  cov = clamp(cov + (fibre - 0.5) * 0.13 * uGrain, 0.0, 1.0);
  // A press has a minimum printable dot: below it the highlight drops out and
  // the stock is left bare. Applied after the fibre, or the mottle alone would
  // re-ink the negative space — which is most of a zine page.
  cov = max(0.0, cov - uWhite) / max(1.0 - uWhite, 0.01);

  vec3 h = hsv(c);
  // Hue distance to orange (30deg). Inside ~80deg is the warm family: red
  // through yellow. Everything else — greens, cyans, blues, violets — is cool.
  float dh = abs(h.x - 0.083);
  dh = min(dh, 1.0 - dh);
  float warmth = smoothstep(0.22, 0.06, dh);
  // Saturated pixels earn a spot plate; flat and dark ones stay on the ink.
  float spot = smoothstep(0.16, 0.52, h.y) * smoothstep(0.02, 0.14, cov);
  return vec3(cov, spot, warmth);
}

void main() {
  vec2 px = vUv * uResolution;
  vec2 texel = 1.0 / uResolution;

  // Grain lattice. Shimmer is a sub-cell nudge, off by default: a still print
  // is more correct, and a moving one reads as video noise.
  vec2 gp = px * 1.9 + uShimmer * vec2(sin(uTime * 7.3), cos(uTime * 6.1)) * 3.0;
  float fibre = vnoise(gp);

  // Misregistration: fixed sub-pixel offsets, never animated. This is the whole
  // riso tell — plates that miss each other by less than a millimetre.
  vec3 sInk  = separate(vUv, fibre);
  vec3 sWarm = separate(vUv + texel * uMisreg * vec2( 0.95, -0.60), fibre);
  vec3 sCool = separate(vUv + texel * uMisreg * vec2(-0.70,  0.85), fibre);

  // The ink plate keeps 15% under the spots so overlaps still darken instead of
  // going hollow where the colour took over.
  float covInk  = sInk.x  * (1.0 - 0.85 * sInk.y);
  float covWarm = sWarm.x * sWarm.y * sWarm.z;
  float covCool = sCool.x * sCool.y * (1.0 - sCool.z) * 0.9;

  float aInk  = screen(px, covInk,  radians(45.0));
  float aWarm = screen(px, covWarm, radians(15.0));
  float aCool = screen(px, covCool, radians(75.0));

  /* ---- paper ---- */
  vec3 paper = uPaper;
  paper *= 1.0 + (fibre - 0.5) * 0.085 * uGrain;              // fibre
  paper *= 1.0 - vnoise(px * 0.0032) * 0.045;                 // slow stain/mottle
  paper *= 1.0 - abs(sin(px.y * 0.021 + vnoise(vec2(px.y * 0.01, 0.0)) * 4.0)) * 0.012; // roller streaks
  float vig = length(vUv - 0.5) * 1.45;
  paper *= 1.0 - smoothstep(0.55, 1.25, vig) * 0.16;          // scanned-edge falloff

  /* ---- ink ---- */
  // Subtractive: each plate multiplies what is already on the sheet, so warm
  // over cool goes muddy-dark the way wet ink does, not bright the way light does.
  vec3 col = paper;
  col *= mix(vec3(1.0), uInk,      aInk);
  col *= mix(vec3(1.0), uSpotWarm, aWarm);
  col *= mix(vec3(1.0), uSpotCool, aCool);

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * A riso/zine print pass. Add it LAST, after OutputPass.
 *   opts: { paper, ink, spotWarm, spotCool, pitch, grain, spread, white, misreg, shimmer }
 *   colours accept a hex number (0xefe6d2) or any CSS string.
 */
export function zinePass(opts = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uPaper: { value: raw(opts.paper ?? PAPER) },
      uInk: { value: raw(opts.ink ?? INK) },
      uSpotWarm: { value: raw(opts.spotWarm ?? SPOT_WARM) },
      uSpotCool: { value: raw(opts.spotCool ?? SPOT_COOL) },
      // 3.6, not the 4.5 a poster would want: this print has to carry a live
      // simulation, and a coarser screen swallows the hairline overlay links
      // and the smaller organisms whole.
      uPitch: { value: opts.pitch ?? 3.6 },
      uGrain: { value: opts.grain ?? 0.5 },
      uSpread: { value: opts.spread ?? 1.0 },
      uWhite: { value: opts.white ?? 0.10 },
      uMisreg: { value: opts.misreg ?? 1.0 },
      uShimmer: { value: opts.shimmer ?? 0.0 },
      uTime: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });

  // Pass.setSize is a no-op, so the pass would keep printing at the size it was
  // born at. uResolution is in CSS px — composer.setSize is given CSS px too.
  pass.setSize = (w, h) => pass.uniforms.uResolution.value.set(w, h);
  return pass;
}
