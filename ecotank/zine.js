/* =========================================================================
   EcoTank · zine plate pass
   -------------------------------------------------------------------------
   The last pass on the stack. It throws away the render as an *image* and
   reprints it: the frame is separated into five ink plates, each plate is
   screened into halftone dots at its own angle, the plates are laid down on
   aged paper slightly out of register, and they multiply — the way real ink
   sits on real stock. Nothing here glows. That is the point.

   Five plates, because six species have to be told apart by colour and two
   spots cannot carry that:
     INK    warm near-black, 45deg — holds the drawing
     WARM   fluorescent orange-red, 15deg
     COOL   federal blue, 75deg
     GREEN  0deg
     YELLOW 82deg
   Past four plates the angles stop being comfortable. 82 is 37 off the ink,
   but only 7 off the cool and 8 off the green (the dot grid repeats every
   90deg) — yellow is the lightest ink and beats least visibly, so it is the
   one that gets the crowded slot. If a cool/yellow field ever shows a coarse
   beat, yellow is what moves.

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
const SPOT_GREEN = 0x1f9e5a;
const SPOT_YELLOW = 0xf2b616;

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
uniform vec3  uPaper, uInk, uSpotWarm, uSpotCool, uSpotGreen, uSpotYellow;
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

// How one hue splits across the four spot plates, in plate order
// (warm, cool, green, yellow). Softmax over distance on the wheel, not a
// nearest-plate switch: a colour sitting between two inks lays down some of
// both and they overprint, which is the only way to get the tones nobody
// stocked — blue over orange is plum, yellow under ink is olive. The weights
// sum to 1, so total spot coverage is the same whatever the hue; only the
// split moves.
//
// 0.06 hue units (~22deg) is the blend width. Wide enough that the 79deg gap
// between green and cool still overprints in the middle, tight enough that a
// pure ink prints mostly as itself: warm and yellow are only 31deg apart, and
// at this width a pure orange-red still comes out ~80/20 warm.
vec4 spotMix(float hue, vec4 plateHue) {
  vec4 dh = abs(vec4(hue) - plateHue);
  dh = min(dh, 1.0 - dh);
  vec4 w = exp(-dh / 0.06);
  return w / dot(w, vec4(1.0));
}

// Everything a plate needs to know about one sample: how much ink it wants,
// how much of that ink belongs to a spot, and what hue to split it by.
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
  // Saturated pixels earn a spot plate; flat and dark ones stay on the ink.
  float spot = smoothstep(0.16, 0.52, h.y) * smoothstep(0.02, 0.14, cov);
  return vec3(cov, spot, h.x);
}

void main() {
  vec2 px = vUv * uResolution;
  vec2 texel = 1.0 / uResolution;

  // Grain lattice. Shimmer is a sub-cell nudge, off by default: a still print
  // is more correct, and a moving one reads as video noise.
  vec2 gp = px * 1.9 + uShimmer * vec2(sin(uTime * 7.3), cos(uTime * 6.1)) * 3.0;
  float fibre = vnoise(gp);

  // Plate hues read off the uniforms rather than a hardcoded table, so swapping
  // an ink through opts also moves what that plate collects. Once per pixel.
  vec4 plateHue = vec4(hsv(uSpotWarm).x, hsv(uSpotCool).x,
                       hsv(uSpotGreen).x, hsv(uSpotYellow).x);

  // Misregistration: fixed sub-pixel offsets, never animated. This is the whole
  // riso tell — plates that miss each other by less than a millimetre. Five
  // directions, spread so no two plates drift the same way.
  vec3 sInk    = separate(vUv, fibre);
  vec3 sWarm   = separate(vUv + texel * uMisreg * vec2( 0.95, -0.60), fibre);
  vec3 sCool   = separate(vUv + texel * uMisreg * vec2(-0.70,  0.85), fibre);
  vec3 sGreen  = separate(vUv + texel * uMisreg * vec2(-0.90, -0.50), fibre);
  vec3 sYellow = separate(vUv + texel * uMisreg * vec2( 0.55,  0.95), fibre);

  // The ink plate keeps 10% under the spots so overlaps still darken instead of
  // going hollow where the colour took over. Was 15% with two plates; the soft
  // hue falloff now puts two spots down on any in-between colour and their
  // overprint is already dark, so the ink has to give up that extra 5% or a
  // fully saturated field reads as mud rather than as colour.
  float covInk    = sInk.x * (1.0 - 0.90 * sInk.y);
  float covWarm   = sWarm.x   * sWarm.y   * spotMix(sWarm.z,   plateHue).x;
  float covCool   = sCool.x   * sCool.y   * spotMix(sCool.z,   plateHue).y;
  float covGreen  = sGreen.x  * sGreen.y  * spotMix(sGreen.z,  plateHue).z;
  float covYellow = sYellow.x * sYellow.y * spotMix(sYellow.z, plateHue).w;

  float aInk    = screen(px, covInk,    radians(45.0));
  float aWarm   = screen(px, covWarm,   radians(15.0));
  float aCool   = screen(px, covCool,   radians(75.0));
  // Green and yellow swapped from the first cut. 0deg aligns the dot grid with
  // the pixel grid, so whichever plate holds it reads as a visible weave rather
  // than as tone — and green over a bed of plants turned into a checkerboard.
  // 0deg goes to the palest ink, which is why every four-colour press gives it
  // to yellow, and green takes 60 where nothing is closer than 15deg.
  float aGreen  = screen(px, covGreen,  radians(60.0));
  float aYellow = screen(px, covYellow, radians(0.0));

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
  col *= mix(vec3(1.0), uInk,        aInk);
  col *= mix(vec3(1.0), uSpotWarm,   aWarm);
  col *= mix(vec3(1.0), uSpotCool,   aCool);
  col *= mix(vec3(1.0), uSpotGreen,  aGreen);
  col *= mix(vec3(1.0), uSpotYellow, aYellow);

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * A riso/zine print pass. Add it LAST, after OutputPass.
 *   opts: { paper, ink, spotWarm, spotCool, spotGreen, spotYellow,
 *           pitch, grain, spread, white, misreg, shimmer }
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
      uSpotGreen: { value: raw(opts.spotGreen ?? SPOT_GREEN) },
      uSpotYellow: { value: raw(opts.spotYellow ?? SPOT_YELLOW) },
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
