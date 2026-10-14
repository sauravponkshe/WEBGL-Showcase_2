/* PONK Ocean — realtime FFT ocean for three.js (r164).
 *
 * Self-contained ES module. Nothing is imported: the host passes in its own THREE, so the viewer, the localhost
 * tuning page and the export all use exactly one copy of three.
 *
 *   const ocean = createOcean(THREE, { renderer, scene, camera, look, area });
 *   ocean.setColliders([...]);   // static: islands, rocks, piers (meshes or baked proxy triangles)
 *   ocean.setFloaters([...]);    // dynamic: hulls that heave, pitch and roll on the waves
 *   each frame:  ocean.update(dt);
 *
 * The surface is rendered in linear HDR into whatever the host is rendering to (EffectComposer, OutputPass does the
 * tone mapping) and reflects the host's scene.environment, so it lives in the same lighting as the rest of the scene.
 */

export const OCEAN_VERSION = '1.0.0';

/* =================================================================== GLSL === */
const HEAD = '#define texture2D texture\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
const S = {};

/* bathymetry: a baked height map of everything that is solid (RGBA16F: R = height of the ground relative to sea level in
   metres, G = distance to the nearest land in metres). Beyond the map the seabed simply keeps falling away. */
S.terrain = `
uniform sampler2D uBathy;
uniform vec4 uBathyRect;
uniform float uIsland;
float terrainT(vec2 p){
  vec2 uv = (p - uBathyRect.xy)/uBathyRect.zw;
  float t = textureLod(uBathy, clamp(uv, 0.0, 1.0), 0.0).r;
  return mix(-60.0, t, uIsland);
}
float shoalOf(float d){ return clamp(pow(14.0/max(d, 1.0), 0.25), 1.0, 1.45); }
float depthGain(float d, float aRef){
  float dd = max(d, 0.0);
  float shoal = shoalOf(dd);
  float cap = (0.40*dd + 0.05)/max(aRef*shoal, 0.05);
  return shoal * cap/pow(1.0 + pow(cap, 4.0), 0.25);
}
`;

/* wave "lens": shoaling compresses the wave pattern towards the shore and land throws a soft shadow downwind.
   R = phase shift (m), G = amplitude, BA = gradient of the shift. */
S.lens = `
uniform sampler2D uLens;
vec4 lensAt(vec2 p){
  vec2 uv = (p - uBathyRect.xy)/uBathyRect.zw;
  float inside = step(0.0, uv.x)*step(uv.x, 1.0)*step(0.0, uv.y)*step(uv.y, 1.0);
  vec4 L = textureLod(uLens, clamp(uv, 0.0, 1.0), 0.0);
  return mix(vec4(0.0, 1.0, 0.0, 0.0), L, inside*uIsland);
}
`;
S.lensFS = S.terrain + `
uniform vec2 uWdir, uRes;
out vec4 outc;
float edgeFade(vec2 p){
  vec2 a = p - uBathyRect.xy;
  vec2 b = uBathyRect.xy + uBathyRect.zw - p;
  return smoothstep(0.0, 70.0, min(min(a.x, a.y), min(b.x, b.y)));
}
float shiftAt(vec2 p){
  float acc = 0.0;
  for (int i = 0; i < 90; i++) {
    vec2 q = p - uWdir*(float(i) + 0.5)*3.0;
    float d = -terrainT(q);
    float sh = smoothstep(0.2, 1.2, d);
    float s = sqrt(14.0/max(d, 0.4));
    acc += clamp(s - 1.0, 0.0, 1.2)*0.5*3.0*sh*exp(-float(i)*3.0/100.0);
  }
  return acc*edgeFade(p);
}
float openAt(vec2 p, float o){
  vec2 perp = vec2(-uWdir.y, uWdir.x);
  float blocked = 0.0;
  for (int i = 1; i < 90; i++) {
    vec2 q = p - uWdir*float(i)*3.0 + perp*o;
    blocked = max(blocked, (1.0 - smoothstep(0.0, 1.5, -terrainT(q)))*exp(-float(i)*3.0/150.0));
  }
  return 1.0 - blocked;
}
void main(){
  vec2 p = uBathyRect.xy + gl_FragCoord.xy/uRes*uBathyRect.zw;
  float sh = shiftAt(p);
  float e = 3.0;
  float dsx = (shiftAt(p + vec2(e, 0.0)) - shiftAt(p - vec2(e, 0.0)))/(2.0*e);
  float dsz = (shiftAt(p + vec2(0.0, e)) - shiftAt(p - vec2(0.0, e)))/(2.0*e);
  float f = 0.1*openAt(p, -20.0) + 0.2*openAt(p, -10.0) + 0.4*openAt(p, 0.0) + 0.2*openAt(p, 10.0) + 0.1*openAt(p, 20.0);
  outc = vec4(sh, mix(1.0, mix(0.14, 1.0, f), edgeFade(p)), dsx, dsz);
}
`;

S.quadVS = `
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p*2.0 - 1.0, 0.0, 1.0);
}
`;

/* copies the mirror image of the scene, replacing any infinite / not-a-number value (a very bright or degenerate pixel in the
   host's materials, seen from below the water) before the mipmaps are built: a single one would spread over a whole screen block */
S.sanFS = `
uniform sampler2D uSrc;
out vec4 outc;
float sf(float v, float hi){ return (v < hi) ? max(v, 0.0) : ((v > 0.0) ? hi : 0.0); }
void main(){
  vec4 c = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  outc = vec4(sf(c.r, 32.0), sf(c.g, 32.0), sf(c.b, 32.0), sf(c.a, 1.0));
}
`;

/* spectrum at time t. Both packed fields (two real fields per complex FFT) are written in one pass. */
S.evolveFS = `
#ifndef PSQ
#define PSQ(x) ((x)*(x))
#endif
const float PI = 3.14159265358979;
const float G = 9.81;
uniform sampler2D uNoise;
uniform float uN, uL, uKmin, uKmax, uTn, uPeriod, uWind, uSpread, uGamma, uAmpK;
uniform vec2 uWdir;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 idxOf(ivec2 c){
  int n = int(uN); int h = n/2;
  return vec2(float(c.x >= h ? c.x - n : c.x), float(c.y >= h ? c.y - n : c.y));
}
vec2 specA(ivec2 c){
  vec2 id = idxOf(c);
  float hN = uN*0.5;
  if (abs(id.x) >= hN || abs(id.y) >= hN) return vec2(0.0);
  vec2 kk = id*(2.0*PI/uL);
  float k = length(kk);
  if (k < uKmin || k >= uKmax || k < 1e-5) return vec2(0.0);
  float w = sqrt(G*k);
  float wp = 0.855*G/uWind;
  float S = 0.0081*G*G/pow(w, 5.0)*exp(-1.25*pow(wp/w, 4.0));
  float sg = (w <= wp) ? 0.07 : 0.09;
  S *= pow(uGamma, exp(-PSQ(w - wp)/(2.0*sg*sg*wp*wp)));
  float P = S*G/(2.0*w*k);
  float cs = (1.0 + dot(kk/k, uWdir))*0.5;
  float s = uSpread*mix(1.0, 0.3, smoothstep(wp, 4.0*wp, w));
  float D = sqrt(s + 0.25)/(2.0*sqrt(PI))*pow(max(cs, 1e-4), s);
  float amp = sqrt(P*D)*(2.0*PI/uL)*0.5*uAmpK;
  return texelFetch(uNoise, c, 0).xy*amp;
}
vec2 Z(vec2 F, vec2 Gf){ return vec2(F.x - Gf.y, F.y + Gf.x); }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  int n = int(uN);
  ivec2 cm = ivec2((n - c.x) % n, (n - c.y) % n);
  vec2 a = specA(c);
  vec2 am = specA(cm);
  vec2 id = idxOf(c);
  vec2 kk = id*(2.0*PI/uL);
  float k = length(kk);
  float w = sqrt(G*max(k, 1e-5));
  float w0 = 2.0*PI/uPeriod;
  float mq = floor(w/w0 + 0.5);
  float ph = 2.0*PI*fract(mq*uTn);
  vec2 E = vec2(cos(ph), -sin(ph));
  vec2 H = cmul(a, E) + cmul(vec2(am.x, -am.y), vec2(E.x, -E.y));
  if (k < 1e-5) H = vec2(0.0);
  vec2 kh = (k > 1e-5) ? kk/k : vec2(0.0);
  vec2 mI = vec2(H.y, -H.x);
  vec2 pI = vec2(-H.y, H.x);
  vec2 Dx = kh.x*mI;
  vec2 Dz = kh.y*mI;
  vec2 dhdx = kk.x*pI;
  vec2 dhdz = kk.y*pI;
  vec2 dDxdx = kh.x*kk.x*H;
  vec2 dDzdz = kh.y*kk.y*H;
  vec2 dDxdz = kh.x*kk.y*H;
  o0 = vec4(Z(H, Dx), Z(Dz, dhdx));
  o1 = vec4(Z(dhdz, dDxdx), Z(dDzdz, dDxdz));
}
`;

/* one radix-2 Stockham stage on both packed fields */
S.fftFS = `
uniform sampler2D uSrcA, uSrcB;
uniform float uP, uN, uHoriz, uSign;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  int N = int(uN);
  int p = int(uP);
  bool hz = uHoriz > 0.5;
  int idx = hz ? c.x : c.y;
  int k = idx & (p - 1);
  int b = (idx/p) & 1;
  int j = (idx/(2*p))*p + k;
  ivec2 a0 = hz ? ivec2(j, c.y) : ivec2(c.x, j);
  ivec2 a1 = hz ? ivec2(j + N/2, c.y) : ivec2(c.x, j + N/2);
  float ang = uSign*3.14159265358979*float(k)/float(p);
  vec2 t = vec2(cos(ang), sin(ang));
  vec4 x0 = texelFetch(uSrcA, a0, 0);
  vec4 x1 = texelFetch(uSrcA, a1, 0);
  vec4 v = vec4(cmul(x1.xy, t), cmul(x1.zw, t));
  o0 = (b == 0) ? x0 + v : x0 - v;
  x0 = texelFetch(uSrcB, a0, 0);
  x1 = texelFetch(uSrcB, a1, 0);
  v = vec4(cmul(x1.xy, t), cmul(x1.zw, t));
  o1 = (b == 0) ? x0 + v : x0 - v;
}
`;

/* displacement / height / jacobian (RGBA16F, mip-mapped) */
S.combDFS = `
uniform sampler2D uA, uB;
uniform float uLambda;
out vec4 outc;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uA, c, 0);
  vec4 b = texelFetch(uB, c, 0);
  float J = (1.0 - uLambda*b.g)*(1.0 - uLambda*b.b) - uLambda*uLambda*b.a*b.a;
  outc = vec4(a.g, a.r, a.b, J);
}
`;
/* slopes + persistent foam (ping-pong) */
S.combSFS = `
uniform sampler2D uA, uB, uPrev;
uniform float uLambda, uDecay, uJthr, uJwid, uGain;
out vec4 outc;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uA, c, 0);
  vec4 b = texelFetch(uB, c, 0);
  float J = (1.0 - uLambda*b.g)*(1.0 - uLambda*b.b) - uLambda*uLambda*b.a*b.a;
  float prev = texelFetch(uPrev, c, 0).z;
  float inj = clamp((uJthr - J)/uJwid, 0.0, 1.0)*uGain;
  outc = vec4(a.a, b.r, max(prev*uDecay, inj), 1.0);
}
`;

/* world-space foam memory: R = breaking waves, G = wakes and bow foam of up to four floating hulls */

/* ---------- hull shape: signed distance (sim metres, negative inside) in boat-local axes ---------- */
S.hull = `
#ifndef PSQ
#define PSQ(x) ((x)*(x))
#endif
uniform sampler2D uHullTex;
uniform vec4 uHullBox;     /* local u0, v0, du, dv (u = along the bow, v = to the right) */
uniform vec4 uHullEm;      /* hull x, z, bow x, bow z */
uniform vec4 uHullP;       /* on, cut water inside, speed 0..1, unused */
uniform vec4 uHullS;       /* foam scroll along the hull (sim metres), bow wave on, bow wave size, foam ring size */
vec2 hullLocal(vec2 p){
  vec2 fw = uHullEm.zw;
  vec2 rt = vec2(-fw.y, fw.x);
  vec2 q = p - uHullEm.xy;
  return vec2(dot(q, fw), dot(q, rt));
}
vec2 hullTex2(vec2 p){
  vec2 huv = (hullLocal(p) - uHullBox.xy)/uHullBox.zw;
  return texture(uHullTex, clamp(huv, 0.0, 1.0)).rg;
}
uniform vec4 uBow;         /* bow u, stern u, half beam, wave height (0 = off) */
float hullSdRingLod(vec2 p){
  vec2 huv = (hullLocal(p) - uHullBox.xy)/uHullBox.zw;
  return textureLod(uHullTex, clamp(huv, 0.0, 1.0), 0.0).g;
}
/* The water the hero boat pushes up, in the boat's own frame (so it stays put while the sea flows past):
   a pile of water against the forward hull and ahead of the stem, a trough along the sides, a hollow behind the
   transom with a small tail, and the two Kelvin arms with a faint transverse train between them. */
bool hullBowZone(vec2 p){          /* only the water in front of, beside and (a long way) behind the boat feels the bow wave */
  vec2 lp = hullLocal(p);
  float s = uBow.y - lp.x;
  return lp.x < uBow.x + 8.0 && s < 70.0 && abs(lp.y) < uBow.z + 9.0 + 0.5*max(s, 0.0);
}
bool hullRebZone(vec2 p){          /* the rebound only reaches a few metres from the hull */
  vec2 huv = (hullLocal(p) - uHullBox.xy)/uHullBox.zw;
  return huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0;
}
float bowH(vec2 p){
  if (uHullS.y < 0.5 || uBow.w < 0.001) return 0.0;
  vec2 lp = hullLocal(p);
  float ub = uBow.x, us = uBow.y, Bh = uBow.z, A = uBow.w;
  float Lt = max(ub - us, 1.0);
  float sd = max(hullSdRingLod(p), 0.0);
  float t = clamp((lp.x - us)/Lt, 0.0, 1.0);
  float h = 0.0;
  h += A*smoothstep(0.30, 0.95, t)*(0.75*exp(-PSQ(sd/0.45)) + 0.35*exp(-PSQ(sd/1.6)));
  h -= 0.30*A*smoothstep(0.45, 0.70, t)*(1.0 - smoothstep(0.85, 1.0, t))*exp(-PSQ((sd - 1.1)/0.9));
  float s = us - lp.x;
  float side = exp(-PSQ(lp.y/(Bh + 0.3)));
  h -= 0.55*A*exp(-PSQ((s - 0.4)/0.9))*side;
  h += 0.70*A*exp(-PSQ((s - 2.6)/1.5))*exp(-PSQ(lp.y/(Bh*0.9 + 0.35)));
  float arm = Bh + 0.354*max(s, 0.0);
  h += 0.55*A*exp(-max(s, 0.0)/(9.0 + Lt))*smoothstep(0.5, 3.0, s)*exp(-PSQ((abs(lp.y) - arm)/(0.5 + 0.09*max(s, 0.0))));
  float lt = clamp(0.64*uHullS.z*uHullS.z, 3.5, 24.0);
  h += 0.28*A*exp(-max(s, 0.0)/(7.0 + 0.8*Lt))*smoothstep(1.0, 4.0, s)*cos(6.2831*s/lt)*exp(-PSQ(lp.y/(Bh + 0.45*max(s, 0.0))));
  return h;
}
uniform vec4 uHullH;       /* hull height above the water (sim m), shadow on water, contact darkening, 0 */
uniform vec4 uReb;         /* water rebound amount, how much the boat is moving 0..1, wave sigma (sim m), clock (s) */
/* Water bouncing back off the hull, boat at rest or not: the incoming waves climb the side (a wall roughly doubles a wave
   right at it) and small ripples run back out from the hull, stronger while the boat heaves. h = local wave height here. */
float reboundH(vec2 p, float h){
  float sd = max(hullSdRingLod(p), 0.0);
  float env = exp(-PSQ(sd/0.9));
  vec2 lp = hullLocal(p);
  float ph = 6.2831*sd/0.85 - uReb.w*5.4 + 1.6*sin(lp.x*0.8 + uReb.w*0.7) + 1.1*sin(lp.x*2.3 - uReb.w*1.1);
  float rip = 0.024*(0.25 + 0.75*uReb.y)*exp(-sd/2.2)*smoothstep(0.05, 0.6, sd)*sin(ph);
  float fade = 1.0 - smoothstep(2.0, 3.2, sd);
  float hh = max(h, 0.0) + 0.35*min(h, 0.0);   /* climbs the wall more than it drops */
  return uReb.x*(1.0*hh*env + rip)*fade;
}
float hullSd(vec2 p){ return hullTex2(p).r; }          /* true waterline: the water inside is hidden */
float hullSdRing(vec2 p){ return hullTex2(p).g; }      /* outline a little higher up: the foam ring starts outside any overhang */
vec2 hullNormal(vec2 p){
  vec2 fw = uHullEm.zw;
  vec2 rt = vec2(-fw.y, fw.x);
  float e = 0.18;
  vec2 g = vec2(hullSdRing(p + fw*e) - hullSdRing(p - fw*e), hullSdRing(p + rt*e) - hullSdRing(p - rt*e));
  return g/max(length(g), 1e-4);
}
`;

S.wakeFS = S.terrain + S.lens + S.hull + `
#define NEM 4
uniform sampler2D uPrev, uD0, uD1;
uniform float uInvL0, uInvL1, uOff0, uOff1, uMulInv, uDecayB, uDecayW, uAmpRef, uBreak, uDt;
uniform vec2 uWdir, uAdv, uDrift;
uniform vec4 uEm[NEM];     /* x, z, forward x, forward z */
uniform vec4 uEmP[NEM];    /* half length, half width, speed 0..1, on */
out vec4 outc;
void main(){
  vec2 uv = gl_FragCoord.xy/vec2(textureSize(uPrev, 0));
  vec2 p = uBathyRect.xy + uv*uBathyRect.zw;
  vec2 px = vec2(1.0)/vec2(textureSize(uPrev, 0));
  vec4 c0 = texture(uPrev, uv);
  vec4 bl = 0.25*(texture(uPrev, uv + vec2(px.x, 0.0)) + texture(uPrev, uv - vec2(px.x, 0.0)) + texture(uPrev, uv + vec2(0.0, px.y)) + texture(uPrev, uv - vec2(0.0, px.y)));
  float k = clamp(uDt*0.8, 0.0, 0.5);
  /* the boat's own foam (green channel) streams aft when the water is flowing past a boat held in place */
  vec2 sh = uAdv/uBathyRect.zw;
  vec4 cA = texture(uPrev, uv + sh);
  vec4 blA = 0.25*(texture(uPrev, uv + sh + vec2(px.x, 0.0)) + texture(uPrev, uv + sh - vec2(px.x, 0.0)) + texture(uPrev, uv + sh + vec2(0.0, px.y)) + texture(uPrev, uv + sh - vec2(0.0, px.y)));
  vec2 f = vec2(mix(c0.r, bl.r, k)*uDecayB, mix(cA.g, blA.g, k)*uDecayW);
  float d = -terrainT(p);
  if (d > -0.5 && d < 16.0) {
    vec4 L = lensAt(p);
    vec2 q = p + uWdir*L.x + uDrift;
    float h = (texture(uD0, q*uInvL0 + uOff0).g + texture(uD1, q*uInvL1 + uOff1).g)*uMulInv*L.y;
    float B = h*shoalOf(max(d, 0.0))/(0.40*max(d, 0.0) + 0.05);
    float inj = smoothstep(0.85, 2.0, B)*smoothstep(-0.2, 0.5, d)*0.9;
    float e = clamp(uAmpRef, 0.0, 1.6);
    float sb = (1.0 - smoothstep(0.6, 3.6, max(d, 0.0)))*smoothstep(-0.1, 0.5, d)*smoothstep(-0.1, 0.7, h/max(0.45, uAmpRef*0.55))*0.85*smoothstep(0.1, 0.6, e);
    f.x = max(f.x, max(inj, sb)*uBreak);
  }
  for (int i = 0; i < NEM; i++) {
    if (uEmP[i].w < 0.5) continue;
    vec2 fw = uEm[i].zw;
    vec2 rt = vec2(-fw.y, fw.x);
    vec2 q = p - uEm[i].xy;
    float al = dot(q, fw);
    float sd = dot(q, rt);
    float sp = uEmP[i].z;
    float hl = uEmP[i].x, hw = uEmP[i].y;
    if (i == 0 && uHullP.x > 0.5) {
      /* the real waterline of the hull */
      float sdv = hullSdRing(p);
      vec2 nl = hullNormal(p);
      float rk = uHullS.w;
      float edge = (1.0 - smoothstep(-0.30, (0.22 + 0.6*sp)*max(rk, 1.0), sdv))*(0.30 + 0.70*sp)*clamp(rk, 0.0, 1.0);
      float bowW = smoothstep(0.10, 0.85, nl.x)*(1.0 - smoothstep(0.0, 1.2 + 1.8*sp, sdv))*sp*1.2;
      float sternW = smoothstep(0.10, 0.80, -nl.x)*(1.0 - smoothstep(0.0, 1.1 + 1.0*sp, sdv))*(0.25 + 0.75*sp);
      f.y = max(f.y, clamp(max(edge, max(bowW, sternW)), 0.0, 1.0));
      continue;
    }
    float e = length(vec2(al/hl, sd/hw));
    float hull = (1.0 - smoothstep(0.80, 1.25, e))*(0.35 + 0.65*sp);
    float bd = length(vec2(sd/(0.564*hw), (al - 0.864*hl)/(0.227*hl)));
    float bow = (1.0 - smoothstep(0.55, 1.5, bd))*sp*1.1;
    float sn = length(vec2(sd/(0.513*hw), (al + hl)/(0.364*hl)));
    float stern = (1.0 - smoothstep(0.5, 1.6, sn))*(0.25 + 0.75*sp);
    f.y = max(f.y, max(hull, max(bow, stern)));
  }
  outc = vec4(f, 0.0, 1.0);
}
`;

/* ---------- shared sky / lighting helpers (also used to bake a default environment when the host has no HDRI) ---------- */
S.common = `
#ifndef PSQ
#define PSQ(x) ((x)*(x))
#endif
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uDeepCol;
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
/* never hand the host an infinite or not-a-number pixel: one of them turns its whole bloom pass (and the screen) black.
   Written with plain comparisons, not isnan(): some drivers optimise isnan() away. */
float ponkF(float v, float hi){ return (v < hi) ? max(v, 0.0) : ((v > 0.0) ? hi : 0.0); }
vec3 ponkSafe(vec3 c){ return vec3(ponkF(c.x, 32.0), ponkF(c.y, 32.0), ponkF(c.z, 32.0)); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash21(i); float b = hash21(i+vec2(1.0,0.0));
  float c = hash21(i+vec2(0.0,1.0)); float d = hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm5(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.7); a*=0.5; } return s; }
float fbm3(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.07+vec2(11.3,7.9); a*=0.5; } return s; }
float dayFac(){ return smoothstep(-0.08, 0.35, uSunDir.y); }
vec3 sunColor(){ return mix(vec3(1.0,0.52,0.25), vec3(1.0,0.95,0.86), smoothstep(0.0,0.4,uSunDir.y)); }
vec3 skyColor(vec3 rd){
  float sy = uSunDir.y;
  float dayF = smoothstep(-0.08, 0.35, sy);
  float warm = (1.0 - smoothstep(0.02, 0.45, sy)) * smoothstep(-0.12, 0.05, sy);
  vec3 zen = mix(vec3(0.03,0.05,0.13), vec3(0.13,0.36,0.72), dayF);
  vec3 hor = mix(vec3(0.20,0.26,0.36), vec3(0.70,0.83,0.92), dayF);
  vec2 hd = normalize(rd.xz + vec2(0.0001));
  vec2 sh = normalize(uSunDir.xz + vec2(0.0001));
  float az = PSQ(max(dot(hd, sh), 0.0));
  hor = mix(hor, vec3(1.0,0.50,0.28), warm*(0.30+0.70*az));
  float h = clamp(rd.y, 0.0, 1.0);
  vec3 col = mix(zen, hor, pow(1.0-h, 3.5));
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 sunCol = sunColor();
  col += sunCol*(0.30*pow(sd,6.0) + 0.55*pow(sd,64.0))*(0.25+0.75*dayF);
  col += sunCol*smoothstep(0.9993,0.9998,sd)*14.0*(0.4+0.6*dayF);
  if (rd.y > 0.0) {
    vec2 cp = rd.xz/(rd.y+0.12)*0.9 + vec2(uTime*0.012, uTime*0.005);
    float c = fbm5(cp);
    c = smoothstep(0.50, 0.80, c) * smoothstep(0.0, 0.18, rd.y);
    vec3 cloudCol = mix(vec3(0.10,0.11,0.17), vec3(0.95,0.96,0.98), dayF);
    cloudCol = mix(cloudCol, sunCol*1.1, warm*0.5*(0.4+0.6*sd));
    col = mix(col, cloudCol, c*0.85);
  }
  return col;
}
vec3 post(vec3 c){
  c = max(c, vec3(0.0));
  c = (c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);
  return pow(c, vec3(1.0/2.2));
}
`;

/* sky dome (baked into a PMREM so the water has something to reflect when the host has no HDRI) */
S.domeVS = `
varying vec3 vD;
void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }
`;
S.domeFS = S.common + `
varying vec3 vD;
void main(){
  vec3 d = normalize(vD);
  vec3 col = skyColor(d);
  if (d.y < 0.0) {
    float t = smoothstep(0.0, 0.35, -d.y);
    col = mix(skyColor(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0001, 0.0, 0.0001))), uDeepCol*(0.3 + 0.7*dayFac()), t);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- the sea surface ---------- */
S.seaVS = S.terrain + S.lens + S.hull + `
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform sampler2D uD0, uD1, uD2;
uniform vec3 uInvL, uOff, uTexPerM;
uniform vec3 uGrid;          /* R, warp a, n */
uniform float uLambda, uMulInv, uAmpRef;
uniform vec2 uWdir, uDrift;
uniform vec3 uCam;
out vec3 vWorld;
out vec2 vP;
out vec2 vQ;
out vec2 vLG;
out float vH;
out float vG;
out float vAhead;
out vec3 vBW;
float spacingAt(float x){
  float a = uGrid.y;
  float u = (-(1.0 - a) + sqrt((1.0 - a)*(1.0 - a) + 4.0*a*abs(x)/uGrid.x))/(2.0*a);
  return 2.0*uGrid.x/uGrid.z*(2.0*a*u + 1.0 - a);
}
void main(){
  vec2 p = position.xz;
  float d = -terrainT(p);
  vec4 L = lensAt(p);
  vec2 q = p + uWdir*L.x + uDrift;
  float g = depthGain(d, uAmpRef)*L.y;
  float sp = max(spacingAt(p.x), spacingAt(p.y));
  vec4 t0 = textureLod(uD0, q*uInvL.x + uOff.x, max(log2(sp*uTexPerM.x), 0.0));
  vec4 t1 = textureLod(uD1, q*uInvL.y + uOff.y, max(log2(sp*uTexPerM.y), 0.0));
  vec4 t2 = textureLod(uD2, q*uInvL.z + uOff.z, max(log2(sp*uTexPerM.z), 0.0));
  vec3 Ds = (t0 + t1 + t2).xyz*uMulInv;
  vec3 disp = vec3(-uLambda*Ds.x, Ds.y, -uLambda*Ds.z)*g;
  vH = Ds.y;
  vG = g;
  vec2 hv = normalize(p - uCam.xz + vec2(1e-4));
  vAhead = max(0.65*max(-terrainT(p + hv*35.0), 0.0), 0.45*max(-terrainT(p + hv*90.0), 0.0));
  vP = p;
  vQ = q;
  vLG = L.zw;
  vec2 pw = p + disp.xz;        /* the surface point's real position (choppiness moves it sideways) */
  float bh = 0.0;
  vec2 be = vec2(0.22, 0.0);
  vBW = vec3(0.0);
  if (uHullP.x > 0.5) {
    if (uHullS.y > 0.5 && uBow.w > 0.001 && hullBowZone(pw)) {
      bh = bowH(pw);
      vBW = vec3(bh, (bowH(pw + be) - bowH(pw - be))/0.44, (bowH(pw + be.yx) - bowH(pw - be.yx))/0.44);
    }
    if (uReb.x > 0.001 && hullRebZone(pw)) {
      float rb = reboundH(pw, disp.y);
      vBW.y += (reboundH(pw + be, disp.y) - reboundH(pw - be, disp.y))/0.44;
      vBW.z += (reboundH(pw + be.yx, disp.y) - reboundH(pw - be.yx, disp.y))/0.44;
      bh += rb;
    }
  }
  vWorld = vec3(p.x + disp.x, disp.y + bh, p.y + disp.z);
  gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(vWorld, 1.0);
}
`;

S.seaFS = S.common + S.terrain + S.hull + `
#include <cube_uv_reflection_fragment>
uniform sampler2D uS0, uS1, uS2, uWake;
uniform vec3 uInvL, uOff, uCam, uWaterCol, uFoamCol, uFW, uFoamOp;
uniform vec4 uFoamSoft;   /* edge half-width of the foam, of the ring foam, ring softness 0..1, edge width of the ring's pinholes */
   /* uFoamOp: normal foam opacity, ring foam opacity, ring pinholes */
uniform vec2 uWdir;
uniform float uAmpRef, uTransp, uFoamAmt, uWindN, uOut, uFogDist, uGlint, uEnvI, uFogMode;
uniform vec3 uFogCol;
uniform mat3 uEnvRot, uRot;
uniform sampler2D uEnv;
in vec3 vWorld;
in vec2 vP;
in vec2 vQ;
in vec2 vLG;
in float vH;
in float vG;
in float vAhead;
in vec3 vBW;
out vec4 outc;
uniform sampler2D uReflTex;   /* the scene seen in a mirror at the water level (boat, islands) */
uniform mat4 uReflMat;
uniform vec4 uReflP;          /* on, water level, strength, ripple distortion */

vec3 envSample(vec3 dir, float rough){ return textureCubeUV(uEnv, uEnvRot*(uRot*dir), rough).rgb*uEnvI; }
vec3 fogColor(vec3 V){
  vec3 dh = normalize(vec3(-V.x, 0.0, -V.z) + vec3(0.0001, 0.0, 0.0001));
  return mix(envSample(dh, 0.7), uFogCol, uFogMode);
}
vec2 hash22(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p)*43758.5453);
}
float cellular(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      d = min(d, length(g + o - f));
    }
  }
  return d;
}
/* foam streaming along the hull: the same cells, stretched along the boat and sliding aft when it is under way */
float streakTex(vec2 lp){
  vec2 q = vec2(lp.x*0.55 + uHullS.x*0.9, lp.y*3.4);
  float c1 = 1.0 - clamp(cellular(q*1.2), 0.0, 1.0);
  float c2 = 1.0 - clamp(cellular(q*vec2(2.9, 2.4) + vec2(3.1, 7.7)), 0.0, 1.0);
  float n = fbm3(q*vec2(0.5, 0.9) + vec2(uTime*0.05, 0.0));
  return clamp(0.42*c1 + 0.30*c2 + 0.55*n, 0.0, 1.0);
}
float foamTex(vec2 p0){
  vec2 wd = uWdir;
  vec2 p = vec2(dot(p0, vec2(wd.y, -wd.x)), dot(p0, wd)*mix(1.0, 0.5, uWindN));
  float c1 = 1.0 - clamp(cellular(p*1.6), 0.0, 1.0);
  float c2 = 1.0 - clamp(cellular(p*4.8 + vec2(3.7, 1.3)), 0.0, 1.0);
  float c3 = 1.0 - clamp(cellular(p*11.0 + vec2(8.1, 2.9)), 0.0, 1.0);
  float n = fbm3(p*0.6 + vec2(uTime*0.03, 0.0));
  return clamp(0.34*c1 + 0.28*c2 + 0.16*c3 + 0.50*n, 0.0, 1.0);
}

void main(){
  vec3 V = normalize(uCam - vWorld);
  float dist = length(uCam - vWorld);

  vec4 s0 = texture(uS0, vQ*uInvL.x + uOff.x);
  vec4 s1 = texture(uS1, vQ*uInvL.y + uOff.y);
  vec4 s2 = texture(uS2, vQ*uInvL.z + uOff.z);
  vec2 slq = s0.xy + s1.xy + s2.xy;
  vec2 sl = (slq + vLG*dot(uWdir, slq))*vG + vBW.yz;
  float tileFoam = max(s0.z*uFW.x, s1.z*uFW.y);
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));

  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98*pow(1.0 - cosT, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  /* the environment is sampled a little blurred where the surface is rough or far, sharp where it is calm and close */
  float rough = clamp(0.02 + 0.10*clamp(dist/450.0, 0.0, 1.0) + 0.55*length(sl), 0.02, 0.5);
  vec3 refl = envSample(R, rough);
  /* the boat and islands, mirrored in the water: a second picture of the scene taken from under the sea level, bent by the ripples */
  float rflA = 0.0;
  if (uReflP.x > 0.5) {
    vec4 pr = uReflMat*vec4(vWorld.x, uReflP.y, vWorld.z, 1.0);
    vec2 ruv = pr.xy/max(pr.w, 1e-4) + sl*uReflP.w;
    if (pr.w > 0.0 && ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {
      vec4 rf = textureLod(uReflTex, ruv, clamp(rough*7.0 + 0.4, 0.0, 5.0));
      vec2 ee = min(ruv, 1.0 - ruv);
      rflA = rf.a*smoothstep(0.0, 0.05, min(ee.x, ee.y));
      refl = mix(refl, rf.rgb/max(rf.a, 0.02), rflA*min(uReflP.z, 1.0));
    }
  }
  F = clamp(F*(1.0 + rflA*max(uReflP.z - 1.0, 0.0)*3.0) + rflA*0.13*min(uReflP.z, 1.0), 0.0, 1.0);
  /* the hull's soft shadow on the water (the outline slid along the sun's direction) and a dark contact band where hull meets water */
  float hullSh = 0.0, hullCt = 0.0;
  if (uHullP.x > 0.5) {
    vec2 vW0 = vWorld.xz;
    float hs0 = hullSdRing(vW0);
    hullCt = uHullH.z*exp(-PSQ(max(hs0, 0.0)/0.8))*(0.55 + 0.45*smoothstep(0.0, 0.5, hs0));
    vec2 so = uSunDir.xz/max(uSunDir.y, 0.15)*min(uHullH.x, 6.0);
    float hs1 = hullSdRing(vW0 + so);
    hullSh = uHullH.y*(1.0 - smoothstep(-0.25, 1.1, hs1))*smoothstep(0.04, 0.30, uSunDir.y);
  }

  float Tw = terrainT(vWorld.xz);
  float wd = max(vWorld.y - Tw, 0.0);

  float dayF = dayFac();
  float hn = clamp(vH/uAmpRef*0.5 + 0.5, 0.0, 1.0);
  vec3 amb = envSample(vec3(0.0, 1.0, 0.0), 1.0);
  float ambL = dot(amb, vec3(0.2126, 0.7152, 0.0722));
  float light = clamp(0.18 + 0.82*ambL/0.45, 0.05, 2.5);
  vec3 shallow = uWaterCol;
  vec3 deep = shallow*0.28 + vec3(0.0, 0.0, 0.03);
  vec3 body = mix(deep, shallow, pow(hn, 2.2)*0.9);
  float shF = exp(-wd/14.0);
  body = mix(body, shallow*vec3(1.1, 1.18, 1.0) + vec3(0.0, 0.03, 0.02), shF*0.6);
  /* shallow water over a sandy bed: the more see-through the slider, the deeper the aqua reaches. The colour stays the water's own teal, never white */
  float LcB = mix(1.2, 38.0, pow(uTransp, 1.3));
  float bedK = exp(-wd/(1.5 + 0.30*LcB))*smoothstep(0.15, 0.9, uTransp);
  vec3 bed = shallow*vec3(0.95, 1.18, 1.06) + vec3(0.015, 0.04, 0.02);
  body = mix(body, bed, bedK*0.8);
  /* clear water is a lighter, brighter teal, and that colour (not the sky behind it) is what the eye reads: the more see-through, the more of it */
  body = mix(body, bed*vec3(0.92, 1.12, 1.10), 0.55*uTransp*uTransp*smoothstep(8.0, 36.0, wd));
  body *= light;
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0001));
  float sss = pow(max(dot(sunH, -V), 0.0), 3.0)*smoothstep(0.35, 0.95, hn)*dayF;
  body += shallow*vec3(1.6, 1.4, 1.2)*sss*0.9*light;

  body *= 1.0 - 0.55*hullSh - 0.42*hullCt;
  refl *= 1.0 - 0.20*hullSh;
  vec3 col = mix(body, refl, F);
  vec3 H = normalize(uSunDir + V);
  vec3 sunCol = sunColor();
  float spw = mix(520.0, 90.0, clamp(dist/450.0, 0.0, 1.0));
  vec3 specC = sunCol*pow(max(dot(N, H), 0.0), spw)*6.0*(0.25 + 0.75*spw/520.0)*uGlint*(1.0 - hullSh);

  vec2 wuv = (vP - uBathyRect.xy)/uBathyRect.zw;
  float inW = step(0.0, wuv.x)*step(wuv.x, 1.0)*step(0.0, wuv.y)*step(wuv.y, 1.0);
  vec2 wk = texture(uWake, clamp(wuv, 0.0, 1.0)).rg*inW;
  float swash = (1.0 - smoothstep(0.03, 0.55, wd))*smoothstep(-6.0, -0.5, Tw)*0.95;
  float I = uFoamAmt;
  float amt = max(max(tileFoam, wk.x), max(wk.y, swash));
  amt *= smoothstep(0.0, 0.35, I)*(0.6 + 0.4*min(I, 1.5));
  float hullRim = 0.0, hullStk = 0.0, ringOuter = 0.0, hullFill = 0.0, hullHs = 1.0;
  if (uBow.w > 0.001) amt = max(amt, smoothstep(0.05, 0.26, vBW.x/uBow.w)*0.92*mix(0.55, 1.5, fbm3(vP*0.55 + vec2(uHullS.x*0.2, 0.0)))*smoothstep(0.0, 0.35, I)); /* foam rides the crest of the bow wave */
  if (uHullP.x > 0.5) {
    /* the hull's own foam ring, drawn per pixel from the distance map so it stays crisp: a lapping rim at rest, thicker under way */
    vec2 vW = vWorld.xz;          /* where this bit of water really is: choppy waves slide it sideways by up to a metre, the hull map must be read there */
    float hs = hullSdRing(vW);
    hullHs = hs;
    float lap = 0.70 + 0.55*vnoise(vP*1.7 + vec2(uTime*0.55, -uTime*0.4)) + 0.25*sin(uTime*1.3 + vP.x*0.9 + vP.y*0.7);
    /* each wave that reaches the hull throws foam up the side and it falls back: the ring swells on crests and thins in troughs */
    float pulse = smoothstep(-0.9, 1.3, vH/max(0.6*uReb.z, 0.05));
    float rbk = clamp(uReb.x, 0.0, 1.0);
    float rimK = max(uHullS.w, 0.02);
    float rimW = (0.62 + 0.85*uHullP.z)*lap*rimK*mix(1.0, mix(0.85, 1.3, pulse), rbk);
    float lo = mix(0.30, 0.07, smoothstep(1.0, 4.0, rimK));   /* a big ring is mostly a soft fade-out, not a hard band */
    lo = uFoamSoft.z < 0.5 ? mix(0.92, lo, uFoamSoft.z*2.0) : mix(lo, 0.0, (uFoamSoft.z - 0.5)*2.0);   /* ring softness: 0 = crisp edge, 1 = fades out from the hull */
    ringOuter = smoothstep(0.25, 1.0, hs/max(rimW, 0.05));
    hullRim = step(0.01, uHullS.w)*(1.0 - smoothstep(lo*rimW, rimW, hs))*smoothstep(-0.9, -0.5, hs)*(0.78 + 0.22*uHullP.z)*smoothstep(0.0, 0.35, I)*(0.7 + 0.3*min(I, 1.5))*mix(1.0, mix(0.8, 1.25, pulse), rbk);
    amt = max(amt, hullRim);
    if (hullRim > 0.002) hullStk = streakTex(hullLocal(vW));      /* the stretched foam texture is only needed inside the ring */
    /* filled: right at the hull, and under any overhang between the waterline and the outline, the foam is solid, so no strip of water shows between the hull and its foam */
    hullFill = step(0.01, uHullS.w)*(1.0 - smoothstep(0.0, 0.16, max(hs, 0.0)))*smoothstep(-0.9, -0.5, hs)*smoothstep(0.0, 0.35, I);
  }

  float foam = 0.0;
  float dens = 0.0;
  float tex = 0.0;
  float ringShare = clamp(max(hullRim, hullFill)/max(max(amt, hullFill), 0.001), 0.0, 1.0);
  amt = max(amt, hullFill);
  if (amt > 0.02) {
    tex = foamTex(vQ);
    float m = amt*(0.30 + 1.05*tex)*(0.85 + 0.15*min(I, 2.0)) + hullRim*hullRim*0.50*(0.30 + 1.2*mix(tex, hullStk, 0.75));
    m = max(m, hullFill*0.95);
    if (uFoamOp.z > 0.01 && ringShare > 0.01) {
      /* tiny see-through pinholes in the ring foam (a few cm across), a few more toward its outer edge */
      vec2 hh = hullLocal(vWorld.xz);
      float hn = 0.55*vnoise(hh*11.0 + vec2(uTime*0.35, -uTime*0.27 - uHullS.x*0.8)) + 0.45*vnoise(hh*27.0 + vec2(-uTime*0.5, uTime*0.3));
      float thr = uFoamOp.z*(0.62 + 0.18*ringOuter)*smoothstep(0.0, 0.35, hullHs);   /* no pinholes right against the hull */
      float hc = thr + 0.035, hwH = 0.5*uFoamSoft.w;       /* same centre as the classic crisp holes, a wider feather when softer */
      float holeM = mix(1.0, smoothstep(hc - hwH, hc + hwH, hn), 1.0 - smoothstep(25.0, 80.0, dist));
      m = mix(m, max(m*holeM, hullFill*0.95), ringShare);
    }
    float hwF = mix(uFoamSoft.x, uFoamSoft.y, ringShare);       /* softness: how wide the fade from clear water to solid foam is (0.14 = the classic look) */
    float kF = hwF/0.14, cenF = 0.48 - 0.10*(kF - 1.0);
    foam = smoothstep(max(cenF - hwF, 0.02), cenF + hwF, m);
    dens = smoothstep(max(0.80 - 0.25*kF, 0.05), 0.80 + 0.25*kF, m);
  }
  float ndl = max(dot(N, uSunDir), 0.0);
  float lit = (0.10 + 0.90*clamp(ambL/0.45, 0.0, 2.0)*(0.55 + 0.45*max(N.y, 0.0))) + dayF*0.38*ndl;
  vec3 thick = vec3(0.93, 0.97, 0.98)*(0.82 + 0.28*tex)*lit;
  vec3 fringe = uFoamCol*(0.75 + 0.35*tex)*lit;
  vec3 foamCol = mix(fringe, thick, smoothstep(0.1, 0.8, dens));
  foamCol += sunCol*0.05*dayF*PSQ(max(dot(N, uSunDir), 0.0))*dens;
  float foamA = foam*mix(0.45, 0.85, dens)*mix(uFoamOp.x, uFoamOp.y, ringShare);
  col = mix(col, foamCol, foamA);
  col += specC*(1.0 - foamA);

  float Lc = mix(1.2, 38.0, pow(uTransp, 1.3));
  float path = max(wd, vAhead)/max(V.y, 0.30);
  float alpha = 1.0 - exp(-path/Lc);
  /* open and deep water follows the Transparency slider directly: 0 = a solid sea, 1 = clear water that shows what lies below the surface
     (the hull under the waterline, the bed, anything submerged). Near the shore the depth-based fade above still applies. */
  float aDeep = mix(1.0, 0.52, uTransp*uTransp);
  alpha = mix(alpha, aDeep, smoothstep(8.0, 36.0, wd));
  alpha = max(alpha, F);                                   /* at grazing angles the surface mirrors the sky and is never clear */
  alpha = max(alpha, foamA);
  alpha *= smoothstep(0.0, 0.10, wd);
  if (uHullP.y > 0.5) alpha *= smoothstep(-0.14, 0.04, hullSd(vWorld.xz));   /* no water inside the hull */
  float dim = 1.0 - exp(-pow(dist/uFogDist, 3.0));
  alpha = max(alpha, dim);
  if (dim > 0.003) col = mix(col, fogColor(V), dim);
  if (uOut > 0.5) col = post(col) + vec3((hash21(gl_FragCoord.xy) - 0.5)/255.0);
  outc = vec4(ponkSafe(col), ponkF(alpha, 1.0));
}
`;

/* ---------- spray ---------- */
S.sprayVS = `
in vec3 position;
in float aSize;
in float aA;
in vec3 aVel;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 uCam;
uniform float uProj, uAspect;
out float vA;
out float vSoft;
out vec2 vDir;
out float vStretch;
void main(){
  float dist = length(uCam - position);
  vSoft = smoothstep(0.14, 0.40, aSize);      /* tiny droplets stay crisp, big puffs are soft mist */
  mat4 vp = projectionMatrix*viewMatrix;
  vec4 c0 = vp*vec4(position, 1.0);
  vec4 c1 = vp*vec4(position + aVel*0.05, 1.0);
  vec2 dn = (c1.xy/max(c1.w, 1e-3) - c0.xy/max(c0.w, 1e-3))*vec2(uAspect, 1.0);
  float dl = length(dn);
  vDir = dl > 1e-6 ? dn/dl : vec2(0.0, 1.0);
  /* fast small drops are drawn as streaks along their screen-space motion */
  vStretch = 1.0 + 5.0*(1.0 - vSoft)*clamp(length(aVel)/8.0, 0.0, 1.0);
  gl_PointSize = clamp(aSize*uProj/max(dist, 0.5)*vStretch, 1.5, 90.0);
  vA = aA;
  gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position, 1.0);
}
`;
S.sprayFS = S.common + `
in float vA;
in float vSoft;
in vec2 vDir;
in float vStretch;
uniform float uOut, uAmbL;
out vec4 outc;
void main(){
  vec2 q = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)*2.0 - 1.0;
  float qa = dot(q, vDir), qb = dot(q, vec2(-vDir.y, vDir.x));
  float r2 = qa*qa + qb*qb*vStretch*vStretch;
  if (r2 > 1.0) discard;
  float a = mix(pow(1.0 - r2, 0.55), pow(1.0 - r2, 1.6), vSoft)*vA;
  float dayF = dayFac();
  vec3 col = vec3(0.95, 0.98, 1.0)*(0.15 + 0.85*clamp(uAmbL/0.45, 0.0, 2.0))*(0.85 + 0.15*hash21(gl_FragCoord.xy));
  if (uOut > 0.5) col = post(col);
  outc = vec4(ponkSafe(col), ponkF(a, 1.0));
}
`;

/* ================================================================ helpers === */
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hexLin = (hex) => {
  let h = String(hex || '#ffffff').trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const c = parseInt(h, 16) || 0;
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
};
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G0 = 9.81;
const PERIOD = 400;                       /* seconds; frequencies are snapped so the spectrum loops */
const CASCADES = [
  { L: 320, kmin: 0.0, kmax: 1.0, tau: 2.4, fw: 1.0 },
  { L: 40, kmin: 1.0, kmax: 8.0, tau: 1.3, fw: 0.8 },
  { L: 6.4, kmin: 8.0, kmax: 1e9, tau: 0.8, fw: 0.0 },
];
const QUALITY = [
  { name: 'Low', N: [128, 128, 64], mesh: 256, wake: 512, spray: 1400, bathy: 384 },
  { name: 'Medium', N: [256, 256, 128], mesh: 384, wake: 768, spray: 4200, bathy: 512 },
  { name: 'High', N: [256, 256, 256], mesh: 512, wake: 1024, spray: 7000, bathy: 512 },
];
const SEA_A = 0.8;
const LENS_RES = 192;
const NEM = 4;

/* the look: everything the tuning page edits and "Lock Look" stores */
export const DEFAULT_LOOK = {
  wind: 0.55,          /* 0..1 sea state */
  waveAmp: 1.0,        /* wave height at the same wavelength: 0 flat .. 3 big (waves also gets taller as it grows) */
  waves: 1.0,          /* wave size multiplier: also scales the mesh/texture frequency (x0.6 .. x10) */
  chop: 0.65,          /* 0..1 choppiness */
  transp: 0.55,        /* 0..1 how far you see into the water */
  foam: 1.0,           /* 0..2 foam amount */
  waterColor: '#2d8f94',
  foamTint: '#9ddfdb',
  windDir: 34.8,       /* degrees, direction the waves travel in the XZ plane (0 = +X, 90 = +Z) */
  sunAz: 239.5,        /* degrees, direction of the sun in the XZ plane */
  sunEl: 40,           /* degrees above the horizon */
  glint: 0.6,          /* analytic sun glitter on top of the environment reflection */
  reflect: 1.0,        /* strength of the environment reflection */
  fogDist: 440,        /* metres at which the sea dissolves into the horizon colour */
  horizon: 'env',      /* 'env' (blurred environment) or a #rrggbb colour */
  quality: 1,          /* 0 low, 1 medium, 2 high */
  spray: true,
  speed: 1,            /* time scale */
  seaRadius: 600,      /* metres, half size of the sea mesh */
  boatCruise: false,   /* the hero boat stays where it is and the water streams past it, as if it were under way */
  boatSpeed: 6,        /* m/s for that */
  boatBob: 1,          /* how far the hero boat rises and falls with the waves */
  boatTilt: 1,         /* how much it pitches and rolls */
  boatSpray: 1,        /* spray thrown from the hull (all floaters) */
  hullShape: true,     /* use the real waterline of the hull proxy for foam and spray (off = rounded approximation) */
  hullCut: true,       /* hide the water inside the hull outline */
  hullLevel: 0,        /* metres: raise (+) or lower (-) the waterline cut through the hull */
  foamOpacity: 1,      /* opacity of all the normal foam (1 = as before) */
  hullFoamOpacity: 1,  /* opacity of the foam ring around the hero hull */
  foamSoftness: 0.5,   /* how gradually the normal foam fades into the water: 0 crisp .. 1 very soft (0.5 = classic look) */
  hullFoamSoftness: 0.5, /* the same for the ring foam around the hero hull */
  hullHoleSoft: 0.5,   /* how feathered the edges of the ring's pinholes are: 0 crisp .. 1 very soft (0.5 = classic look) */
  hullRingHoles: 0.5,  /* tiny see-through pinholes in the ring foam: 0 solid .. 1 very lacy */
  hullRebound: 1,      /* water bouncing off the hull (run-up, ripples, splash), also when the boat is idle: 0 off .. 2 strong */
  reflectBoat: true,   /* mirror the boat and islands in the water (a second, mirrored picture of the scene) */
  reflectAmt: 1,       /* strength of that mirror image (2 and 3 exaggerate it) */
  reflectGlass: false, /* draw see-through glass in the mirror image too (costly: it makes the viewer draw the scene an extra time) */
  wetOn: true,         /* the wet-hull material effect at all (off = the materials are left exactly as the model has them) */
  boatShadow: 0.55,    /* the hull's soft shadow on the water */
  waterlineDark: 0.5,  /* dark contact band on the water where it meets the hull */
  wetHull: 0.8,        /* wet, darker, glossier hull near the waterline */
  wetHeight: 0.35,     /* how high the wet band climbs the hull, metres */
  hullRing: 1,         /* size of the foam ring around the hull: 0 off .. 3 three times the default */
  hullRes: 0.5,        /* detail of the hull distance map: 0 coarse and fast .. 1 fine */
  bowWave: true,       /* real water displacement: bow wave, trough along the hull, Kelvin wake */
  bowWaveAmt: 1,       /* size of that */
  trackParts: true,    /* the hero follows its parts when an animation moves them */
};

export function createOcean(THREE, opts = {}) {
  const { renderer, scene } = opts;
  let camera = opts.camera || null;
  if (!renderer || !scene) throw new Error('createOcean needs { renderer, scene }');
  if (!renderer.capabilities.isWebGL2) throw new Error('Ocean needs WebGL 2');
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Ocean needs float render targets (EXT_color_buffer_float)');

  const L = Object.assign({}, DEFAULT_LOOK, opts.look || {});
  const area = {
    center: (opts.area && opts.area.center) ? opts.area.center.slice() : [0, 0, 0],
    size: (opts.area && opts.area.size) ? opts.area.size.slice() : [400, 400],
    scale: (opts.area && opts.area.scale) || 1,
  };

  /* ---------- state ---------- */
  const WDIR = [1, 0];
  const DR = [0, 0];               /* the whole wave pattern slides by this much: the water flowing past a boat held in place */
  const SIM = { ampK: 1, U: 9, spread: 4, gamma: 3.3, mul: 1, lambda: 1, lambdaF: 1, mss: [0.01, 0.01, 0.01], simT: 0, sigma: 1, ampRef: 2, foamAmt: 1, wind: 0.55 };
  let Q = null;                   /* active quality resources */
  let modes = null;               /* CPU mirror of the low-frequency block of cascade 0 */
  let BATHY = null;               /* { res, rect:[x0,z0,sx,sz], T: Float32Array, D: Float32Array, tex, on } */
  let LENS = null;                /* { data, tex } */
  let islandOn = 0;
  let wallTime = 0;
  let paused = false;
  let disposed = false;
  let enabled = true;
  const stats = { passes: 0, ms: 0 };

  /* ---------- shared uniforms ---------- */
  const V2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const U = {
    uBathy: { value: null }, uBathyRect: { value: new THREE.Vector4(-200, -200, 400, 400) }, uIsland: { value: 0 },
    uLens: { value: null }, uWdir: { value: V2(1, 0) },
    uSunDir: { value: V3(0, 1, 0) }, uTime: { value: 0 }, uDeepCol: { value: V3(0.01, 0.07, 0.11) },
    uCam: { value: V3() },
    uDrift: { value: V2() }, uHullTex: { value: null }, uHullBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHullEm: { value: new THREE.Vector4(0, 0, 0, 1) }, uHullP: { value: new THREE.Vector4() }, uHullS: { value: new THREE.Vector4() }, uReb: { value: new THREE.Vector4() }, uHullH: { value: new THREE.Vector4() }, uBow: { value: new THREE.Vector4() },
  };
  const pick = (names, extra) => { const o = {}; names.forEach((n) => { o[n] = U[n]; }); return Object.assign(o, extra || {}); };
  const uv = (v) => ({ value: v });

  /* ---------- fullscreen pass machinery ---------- */
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const passMesh = new THREE.Mesh(quadGeo);
  passMesh.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(passMesh);
  const passCam = new THREE.Camera();
  const saved = { rt: null, face: 0, mip: 0, autoClear: true, clearCol: new THREE.Color(), clearA: 1 };
  function beginPasses() {
    saved.rt = renderer.getRenderTarget();
    saved.face = renderer.getActiveCubeFace();
    saved.mip = renderer.getActiveMipmapLevel();
    saved.autoClear = renderer.autoClear;
    renderer.getClearColor(saved.clearCol);
    saved.clearA = renderer.getClearAlpha();
    renderer.autoClear = false;
  }
  function endPasses() {
    renderer.autoClear = saved.autoClear;
    renderer.setClearColor(saved.clearCol, saved.clearA);
    renderer.setRenderTarget(saved.rt, saved.face, saved.mip);
  }
  function runPass(mat, target) {
    passMesh.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCam);
    stats.passes++;
  }
  function clearTarget(t) {
    renderer.setRenderTarget(t);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
  }
  const pmat = (name, fs, uniforms) => new THREE.RawShaderMaterial({
    name, glslVersion: THREE.GLSL3, vertexShader: HEAD + S.quadVS, fragmentShader: HEAD + fs, uniforms,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NoBlending,
  });
  const mkRT = (w, h, o) => new THREE.WebGLRenderTarget(w, h, Object.assign({
    depthBuffer: false, stencilBuffer: false, format: THREE.RGBAFormat, type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
  }, o || {}));
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);

  const M = {
    evolve: pmat('ocean-evolve', S.evolveFS, { uNoise: uv(null), uN: uv(0), uL: uv(0), uKmin: uv(0), uKmax: uv(0), uTn: uv(0), uPeriod: uv(PERIOD), uWind: uv(9), uSpread: uv(4), uGamma: uv(3.3), uAmpK: uv(1), uWdir: U.uWdir }),
    fft: pmat('ocean-fft', S.fftFS, { uSrcA: uv(null), uSrcB: uv(null), uP: uv(1), uN: uv(0), uHoriz: uv(1), uSign: uv(1) }),
    san: pmat('ocean-san', S.sanFS, { uSrc: uv(null) }),
    combD: pmat('ocean-combD', S.combDFS, { uA: uv(null), uB: uv(null), uLambda: uv(1) }),
    combS: pmat('ocean-combS', S.combSFS, { uA: uv(null), uB: uv(null), uPrev: uv(null), uLambda: uv(1), uDecay: uv(0.9), uJthr: uv(0.8), uJwid: uv(0.1), uGain: uv(1) }),
    lens: pmat('ocean-lens', S.lensFS, pick(['uBathy', 'uBathyRect', 'uIsland', 'uWdir'], { uRes: uv(V2(LENS_RES, LENS_RES)) })),
    wake: pmat('ocean-wake', S.wakeFS, pick(['uBathy', 'uBathyRect', 'uIsland', 'uLens', 'uWdir', 'uDrift', 'uHullTex', 'uHullBox', 'uHullEm', 'uHullP', 'uHullS', 'uBow', 'uReb', 'uHullH'], {
      uAdv: uv(V2()),
      uPrev: uv(null), uD0: uv(null), uD1: uv(null), uInvL0: uv(0), uInvL1: uv(0), uOff0: uv(0), uOff1: uv(0), uMulInv: uv(1),
      uDecayB: uv(0.9), uDecayW: uv(0.99), uAmpRef: uv(2), uBreak: uv(1), uDt: uv(0.016),
      uEm: uv(Array.from({ length: NEM }, () => new THREE.Vector4())), uEmP: uv(Array.from({ length: NEM }, () => new THREE.Vector4())),
    })),
  };

  /* ---------- spectrum / amplitude bookkeeping (identical maths to the shaders) ---------- */
  const windToU = (w) => 2.5 + 14 * Math.pow(w, 1.15);
  function jonswapS(w, Uw, gamma) {
    const wp = 0.855 * G0 / Uw;
    let Sv = 0.0081 * G0 * G0 / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4));
    const sg = w <= wp ? 0.07 : 0.09;
    Sv *= Math.pow(gamma, Math.exp(-Math.pow(w - wp, 2) / (2 * sg * sg * wp * wp)));
    return Sv;
  }
  function specAmp(kx, kz, Ls, kmin, kmax, Uw, spread, gamma) {
    const k = Math.hypot(kx, kz);
    if (k < kmin || k >= kmax || k < 1e-5) return 0;
    const w = Math.sqrt(G0 * k);
    const wp = 0.855 * G0 / Uw;
    const Sv = jonswapS(w, Uw, gamma);
    const P = Sv * G0 / (2 * w * k);
    const cs = (1 + (kx * WDIR[0] + kz * WDIR[1]) / k) * 0.5;
    const s = spread * mix(1, 0.3, sstep(wp, 4 * wp, w));
    const D = Math.sqrt(s + 0.25) / (2 * Math.sqrt(Math.PI)) * Math.pow(Math.max(cs, 1e-4), s);
    return Math.sqrt(P * D) * (2 * Math.PI / Ls) * 0.5 * SIM.ampK;
  }
  function sigmaTile(Uw, gamma) {
    const w0 = Math.sqrt(G0 * 2 * Math.PI / CASCADES[0].L), w1 = 18;
    let sum = 0;
    const n = 700, lr = Math.log(w1 / w0);
    for (let i = 0; i < n; i++) { const w = w0 * Math.exp((i + 0.5) / n * lr); sum += jonswapS(w, Uw, gamma) * w * lr / n; }
    return Math.sqrt(sum);
  }
  function mssBand(Uw, gamma, kmin, kmax) {
    const w1 = Math.sqrt(G0 * Math.max(kmin, 0.0196)), w2 = Math.min(Math.sqrt(G0 * Math.min(kmax, 400)), 30);
    if (w2 <= w1) return 0;
    let sum = 0;
    const n = 300, lr = Math.log(w2 / w1);
    for (let i = 0; i < n; i++) { const w = w1 * Math.exp((i + 0.5) / n * lr); const k = w * w / G0; sum += jonswapS(w, Uw, gamma) * k * k * w * lr / n; }
    return sum;
  }
  function recalcAmp() {
    SIM.mss = CASCADES.map((c) => mssBand(SIM.U, SIM.gamma, c.kmin, c.kmax));
    SIM.sigma = sigmaTile(SIM.U, SIM.gamma) / SIM.mul * SIM.ampK;
    SIM.ampRef = Math.max(2.0 * SIM.sigma, 0.12);
  }

  /* ---------- CPU mirror of cascade 0 (floaters and spray ride on it) ---------- */
  const MB = 12;
  function buildModes() {
    if (!Q) return;
    const c0 = Q.cas[0], N = c0.N, Ls = c0.L;
    const list = [];
    const get = (i, j) => { const ii = ((i % N) + N) % N, jj = ((j % N) + N) % N; const o = (jj * N + ii) * 4; return [c0.noiseData[o], c0.noiseData[o + 1]]; };
    for (let j = -MB; j <= MB; j++) {
      for (let i = -MB; i <= MB; i++) {
        if (!i && !j) continue;
        const kx = i * 2 * Math.PI / Ls, kz = j * 2 * Math.PI / Ls;
        const k = Math.hypot(kx, kz);
        const a1 = specAmp(kx, kz, Ls, c0.kmin, c0.kmax, SIM.U, SIM.spread, SIM.gamma);
        const a2 = specAmp(-kx, -kz, Ls, c0.kmin, c0.kmax, SIM.U, SIM.spread, SIM.gamma);
        const x1 = get(i, j), x2 = get(-i, -j);
        const w0 = 2 * Math.PI / PERIOD;
        const mq = Math.floor(Math.sqrt(G0 * k) / w0 + 0.5);
        list.push({ kx, kz, k, aRe: x1[0] * a1, aIm: x1[1] * a1, cRe: x2[0] * a2, cIm: -x2[1] * a2, mq, hr: 0, hi: 0 });
      }
    }
    modes = list;
  }
  function cpuPrep() {
    if (!modes) return;
    const tn = (SIM.simT % PERIOD) / PERIOD;
    for (let n = 0; n < modes.length; n++) {
      const m = modes[n];
      const ph = 2 * Math.PI * (m.mq * tn - Math.floor(m.mq * tn));
      const co = Math.cos(ph), si = Math.sin(ph);
      m.hr = (m.aRe * co + m.aIm * si) + (m.cRe * co - m.cIm * si);
      m.hi = (-m.aRe * si + m.aIm * co) + (m.cRe * si + m.cIm * co);
    }
  }
  const _o = { h: 0, dx: 0, dz: 0 };
  function cpuField(x, z) {
    const X = x * SIM.mul, Z = z * SIM.mul;
    let h = 0, dx = 0, dz = 0;
    for (let n = 0; n < modes.length; n++) {
      const m = modes[n];
      const ph = m.kx * X + m.kz * Z;
      const c = Math.cos(ph), s = Math.sin(ph);
      h += m.hr * c - m.hi * s;
      const d = m.hr * s + m.hi * c;
      dx += m.kx / m.k * d;
      dz += m.kz / m.k * d;
    }
    _o.h = h; _o.dx = dx; _o.dz = dz;
    return _o;
  }

  /* ---------- bathymetry: CPU copy of the baked height map ---------- */
  function terrainT(x, z) {
    if (!BATHY || !islandOn) return -60;
    const r = BATHY.res, rc = BATHY.rect;
    const u = (x - rc[0]) / rc[2], v = (z - rc[1]) / rc[3];
    const fx = clamp(u * r - 0.5, 0, r - 1.0001), fy = clamp(v * r - 0.5, 0, r - 1.0001);
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    const T = BATHY.T;
    const a = T[j0 * r + i0], b = T[j0 * r + i0 + 1], c = T[(j0 + 1) * r + i0], d = T[(j0 + 1) * r + i0 + 1];
    return mix(mix(a, b, tx), mix(c, d, tx), ty);
  }
  const shoalOf = (d) => clamp(Math.pow(14 / Math.max(d, 1), 0.25), 1, 1.45);
  function depthGain(d, aRef) {
    const dd = Math.max(d, 0);
    const shoal = shoalOf(dd);
    const cap = (0.40 * dd + 0.05) / Math.max(aRef * shoal, 0.05);
    return shoal * cap / Math.pow(1 + Math.pow(cap, 4), 0.25);
  }
  const _L = [0, 1, 0, 0];
  function lensCPU(x, z, out) {
    out[0] = 0; out[1] = 1; out[2] = 0; out[3] = 0;
    if (!LENS || !LENS.data || !islandOn || !BATHY) return out;
    const rc = BATHY.rect;
    const u = (x - rc[0]) / rc[2], v = (z - rc[1]) / rc[3];
    if (u < 0 || u > 1 || v < 0 || v > 1) return out;
    const r = LENS_RES, d = LENS.data;
    const fx = clamp(u * r - 0.5, 0, r - 1), fy = clamp(v * r - 0.5, 0, r - 1);
    const i0 = Math.min(Math.floor(fx), r - 2), j0 = Math.min(Math.floor(fy), r - 2);
    const tx = fx - i0, ty = fy - j0;
    for (let c = 0; c < 4; c++) {
      const a = d[(j0 * r + i0) * 4 + c], b = d[(j0 * r + i0 + 1) * 4 + c], e = d[((j0 + 1) * r + i0) * 4 + c], f = d[((j0 + 1) * r + i0 + 1) * 4 + c];
      out[c] = mix(mix(a, b, tx), mix(e, f, tx), ty);
    }
    return out;
  }
  /* height of the water surface (sim metres, relative to the water level) at a point */
  function cpuHeight(x, z) {
    if (!modes) return 0;
    const mi = 1 / SIM.mul;
    let px = x, pz = z, g = 1;
    for (let i = 0; i < 3; i++) {
      lensCPU(px, pz, _L);
      g = depthGain(-terrainT(px, pz), SIM.ampRef) * _L[1];
      const f = cpuField(px + WDIR[0] * _L[0] + DR[0], pz + WDIR[1] * _L[0] + DR[1]);
      if (i === 2) return f.h * mi * g;
      px = x + SIM.lambda * f.dx * mi * g;
      pz = z + SIM.lambda * f.dz * mi * g;
    }
    return 0;
  }
  function crestRaw(x, z) {
    lensCPU(x, z, _L);
    return cpuField(x + WDIR[0] * _L[0] + DR[0], z + WDIR[1] * _L[0] + DR[1]).h / SIM.mul * _L[1];
  }
  function crestHeight(x, z) {
    lensCPU(x, z, _L);
    const g = depthGain(-terrainT(x, z), SIM.ampRef) * _L[1];
    return cpuField(x + WDIR[0] * _L[0] + DR[0], z + WDIR[1] * _L[0] + DR[1]).h / SIM.mul * g;
  }

  /* ================================================== bathymetry baking === */
  const toHalf = THREE.DataUtils.toHalfFloat;
  /* separable box blur, in place */
  function blur(T, res, r, passes) {
    const tmp = new Float32Array(res);
    for (let p = 0; p < passes; p++) {
      for (let dir = 0; dir < 2; dir++) {
        for (let a = 0; a < res; a++) {
          for (let b = 0; b < res; b++) tmp[b] = dir === 0 ? T[a * res + b] : T[b * res + a];
          let acc = 0;
          for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, res - 1)];
          for (let b = 0; b < res; b++) {
            const v = acc / (2 * r + 1);
            if (dir === 0) T[a * res + b] = v; else T[b * res + a] = v;
            acc += tmp[clamp(b + r + 1, 0, res - 1)] - tmp[clamp(b - r, 0, res - 1)];
          }
        }
      }
    }
  }
  /* exact squared euclidean distance transform (Felzenszwalb), land cells are the sources */
  function edt(land, res) {
    const INF = 1e12;
    const f = new Float64Array(res), d = new Float64Array(res), z = new Float64Array(res + 1), v = new Int32Array(res);
    const out = new Float64Array(res * res);
    for (let i = 0; i < res * res; i++) out[i] = land[i] ? 0 : INF;
    const pass1d = (get, set) => {
      for (let q = 0; q < res; q++) f[q] = get(q);
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < res; q++) {
        let s;
        for (;;) {
          const p = v[k];
          s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
          if (s <= z[k] && k > 0) k--; else break;
        }
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < res; q++) {
        while (z[k + 1] < q) k++;
        const p = v[k];
        d[q] = (q - p) * (q - p) + f[p];
      }
      for (let q = 0; q < res; q++) set(q, d[q]);
    };
    for (let x = 0; x < res; x++) pass1d((q) => out[q * res + x], (q, val) => { out[q * res + x] = val; });
    for (let y = 0; y < res; y++) pass1d((q) => out[y * res + q], (q, val) => { out[y * res + q] = val; });
    return out;
  }

  /* the sources of solid ground: meshes in the scene (any depth of the hierarchy) and baked proxy triangles */
  let colliderSrc = [];       /* [{ meshes: Object3D[], proxies: [{ positions, indices }] }] */
  let demoIslands = null;     /* analytic islands for previews: [{ x, z, R, peak, s:[4] }] */

  function demoT(x, z) {
    let t = -60;
    for (const I of demoIslands) {
      const dx = x - I.x, dz = z - I.z, r = Math.hypot(dx, dz), th = Math.atan2(dz, dx), s = I.s;
      const Rt = I.R * (1 + 0.16 * Math.sin(3 * th + s[0]) + 0.09 * Math.sin(5 * th + s[1]) + 0.05 * Math.sin(8 * th + s[2]));
      const m = Rt - r, u = -m;
      const Tsea = -(0.05 * u + 36 * sstep(40, 290, u));
      const mm = Math.max(m, 0);
      const nz = 0.5 + 0.5 * Math.sin(x * 0.12 + s[3]) * Math.sin(z * 0.10 + s[3] * 1.7);
      const Tland = 3 * (1 - Math.exp(-mm * 0.07)) + I.peak * sstep(0, 0.9, mm / Rt) * (0.72 + 0.28 * nz);
      t = Math.max(t, mix(Tsea, Tland, sstep(-2, 2, m)));
    }
    return t;
  }

  function collectTriangles(cb) {
    const s = area.scale, ox = area.center[0], oy = area.center[1], oz = area.center[2];
    const v = new THREE.Vector3();
    let count = 0;
    for (const src of colliderSrc) {
      for (const obj of (src.meshes || [])) {
        obj.updateWorldMatrix(true, true);
        obj.traverse((m) => {
          if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || m.userData.__oceanSkip) return;
          const pos = m.geometry.attributes.position, idx = m.geometry.index;
          const n = idx ? idx.count : pos.count;
          const W = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            W[i * 3] = (v.x - ox) / s; W[i * 3 + 1] = (v.y - oy) / s; W[i * 3 + 2] = (v.z - oz) / s;
          }
          for (let i = 0; i < n; i += 3) {
            const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
            cb(W[a * 3], W[a * 3 + 1], W[a * 3 + 2], W[b * 3], W[b * 3 + 1], W[b * 3 + 2], W[c * 3], W[c * 3 + 1], W[c * 3 + 2]);
            count++;
          }
        });
      }
      for (const pr of (src.proxies || [])) {
        const P = pr.positions, I = pr.indices;
        const n = I ? I.length : P.length / 3;
        for (let i = 0; i < n; i += 3) {
          const a = I ? I[i] : i, b = I ? I[i + 1] : i + 1, c = I ? I[i + 2] : i + 2;
          cb((P[a * 3] - ox) / s, (P[a * 3 + 1] - oy) / s, (P[a * 3 + 2] - oz) / s,
            (P[b * 3] - ox) / s, (P[b * 3 + 1] - oy) / s, (P[b * 3 + 2] - oz) / s,
            (P[c * 3] - ox) / s, (P[c * 3 + 1] - oy) / s, (P[c * 3 + 2] - oz) / s);
          count++;
        }
      }
    }
    return count;
  }

  function bakeBathymetry() {
    const res = QUALITY[L.quality].bathy;
    const sx = area.size[0] / area.scale, sz = area.size[1] / area.scale;
    const rect = [-sx / 2, -sz / 2, sx, sz];
    const cx = sx / res, cz = sz / res;
    const T = new Float32Array(res * res).fill(-1e9);
    let tris = 0;
    if (demoIslands) {
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) T[j * res + i] = demoT(rect[0] + (i + 0.5) * cx, rect[1] + (j + 0.5) * cz);
      tris = 1;
    } else {
      tris = collectTriangles((ax, ay, az, bx, by, bz, ccx, ccy, ccz) => {
        const minx = Math.min(ax, bx, ccx), maxx = Math.max(ax, bx, ccx), minz = Math.min(az, bz, ccz), maxz = Math.max(az, bz, ccz);
        let i0 = Math.floor((minx - rect[0]) / cx - 0.5), i1 = Math.ceil((maxx - rect[0]) / cx - 0.5);
        let j0 = Math.floor((minz - rect[1]) / cz - 0.5), j1 = Math.ceil((maxz - rect[1]) / cz - 0.5);
        if (i1 < 0 || j1 < 0 || i0 >= res || j0 >= res) return;
        i0 = Math.max(i0, 0); j0 = Math.max(j0, 0); i1 = Math.min(i1, res - 1); j1 = Math.min(j1, res - 1);
        const den = (bz - ccz) * (ax - ccx) + (ccx - bx) * (az - ccz);
        if (Math.abs(den) < 1e-12) return;
        const inv = 1 / den, eps = 0.02;
        for (let j = j0; j <= j1; j++) {
          const Z = rect[1] + (j + 0.5) * cz;
          for (let i = i0; i <= i1; i++) {
            const X = rect[0] + (i + 0.5) * cx;
            const w0 = ((bz - ccz) * (X - ccx) + (ccx - bx) * (Z - ccz)) * inv;
            const w1 = ((ccz - az) * (X - ccx) + (ax - ccx) * (Z - ccz)) * inv;
            const w2 = 1 - w0 - w1;
            if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
            const y = w0 * ay + w1 * by + w2 * ccy;
            if (y > T[j * res + i]) T[j * res + i] = y;
          }
        }
      });
    }
    if (!tris) {
      BATHY = null; islandOn = 0; U.uIsland.value = 0;
      return false;
    }
    /* land, and the shelf that falls away from it */
    const land = new Uint8Array(res * res);
    let anyLand = false;
    for (let i = 0; i < res * res; i++) { if (T[i] > 0.02) { land[i] = 1; anyLand = true; } }
    const D = new Float32Array(res * res);
    if (!demoIslands) {
      const cell = Math.max(cx, cz);
      let dist = null;
      if (anyLand) { dist = edt(land, res); for (let i = 0; i < res * res; i++) D[i] = Math.sqrt(dist[i]) * cell; }
      else D.fill(1e4);
      for (let i = 0; i < res * res; i++) {
        const u = D[i];
        const Tsea = Math.max(-60, -(0.05 * u + 36 * sstep(40, 290, u)));
        T[i] = T[i] > -1e8 ? Math.max(T[i], Tsea) : Tsea;
      }
      blur(T, res, Math.max(1, Math.round(2.0 / cell)), 2);
    } else {
      const cell = Math.max(cx, cz);
      const dist = anyLand ? edt(land, res) : null;
      for (let i = 0; i < res * res; i++) D[i] = dist ? Math.sqrt(dist[i]) * cell : 1e4;
    }
    /* the seabed keeps falling away towards the edge of the map so it never ends in a visible seam */
    for (let j = 0; j < res; j++) {
      const z = (rect[1] + (j + 0.5) * cz) / (sz / 2);
      for (let i = 0; i < res; i++) {
        const x = (rect[0] + (i + 0.5) * cx) / (sx / 2);
        const u = Math.max(Math.abs(x), Math.abs(z));
        T[j * res + i] -= 30 * sstep(0.62, 0.98, u);
      }
    }
    const u16 = new Uint16Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      u16[i * 4] = toHalf(clamp(T[i], -200, 400));
      u16[i * 4 + 1] = toHalf(Math.min(D[i], 2000));
      u16[i * 4 + 2] = 0;
      u16[i * 4 + 3] = toHalf(1);
    }
    if (BATHY && BATHY.tex) BATHY.tex.dispose();
    const tex = new THREE.DataTexture(u16, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
    BATHY = { res, rect, T, D, tex, cell: Math.max(cx, cz) };
    islandOn = 1;
    U.uBathy.value = tex;
    U.uBathyRect.value.set(rect[0], rect[1], rect[2], rect[3]);
    U.uIsland.value = 1;
    buildShoreList();
    return true;
  }

  /* ---------- the wave lens: marched upwind through the bathymetry on the GPU, read back for the CPU mirror ---------- */
  let lensRT = null;
  function buildLens() {
    if (!BATHY) {
      if (LENS && LENS.tex) LENS.tex.dispose();
      LENS = null; U.uLens.value = null;
      return;
    }
    if (!lensRT) lensRT = mkRT(LENS_RES, LENS_RES, { type: THREE.FloatType });
    beginPasses();
    try {
      runPass(M.lens, lensRT);
    } finally { /* restored below */ }
    const data = new Float32Array(LENS_RES * LENS_RES * 4);
    let ok = true;
    try { renderer.readRenderTargetPixels(lensRT, 0, 0, LENS_RES, LENS_RES, data); } catch (e) { ok = false; }
    endPasses();
    if (!ok) { for (let i = 0; i < LENS_RES * LENS_RES; i++) { data[i * 4] = 0; data[i * 4 + 1] = 1; data[i * 4 + 2] = 0; data[i * 4 + 3] = 0; } }
    const u16 = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) u16[i] = toHalf(data[i]);
    if (LENS && LENS.tex) LENS.tex.dispose();
    const tex = new THREE.DataTexture(u16, LENS_RES, LENS_RES, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
    LENS = { data, tex };
    U.uLens.value = tex;
  }

  /* where waves break against the shore: cells in 0.5..7 m of water close to land (sprays are spawned there) */
  let shoreCells = [];
  function buildShoreList() {
    shoreCells = [];
    if (!BATHY) return;
    const res = BATHY.res, rc = BATHY.rect, cx = rc[2] / res, cz = rc[3] / res;
    const cand = [];
    for (let j = 1; j < res - 1; j++) {
      for (let i = 1; i < res - 1; i++) {
        const t = BATHY.T[j * res + i];
        if (t < -0.5 && t > -7 && BATHY.D[j * res + i] < 40) cand.push(j * res + i);
      }
    }
    const step = Math.max(1, Math.floor(cand.length / 4000));
    for (let n = 0; n < cand.length; n += step) {
      const k = cand[n], j = Math.floor(k / res), i = k % res;
      const gx = BATHY.T[j * res + i + 1] - BATHY.T[j * res + i - 1];
      const gz = BATHY.T[(j + 1) * res + i] - BATHY.T[(j - 1) * res + i];
      const gl = Math.hypot(gx, gz) || 1;
      shoreCells.push([rc[0] + (i + 0.5) * cx, rc[1] + (j + 0.5) * cz, gx / gl, gz / gl]);
    }
  }

  /* ============================================================ resources === */
  function noiseFor(N, seed) {
    const r = rng(seed);
    const d = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { const a = r() * Math.PI * 2; d[i * 4] = Math.SQRT2 * Math.cos(a); d[i * 4 + 1] = Math.SQRT2 * Math.sin(a); }
    return d;
  }
  function seaGeometry(n, R, a) {
    const warp = (u) => R * (a * u * Math.abs(u) + (1 - a) * u);
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    let k = 0;
    for (let j = 0; j <= n; j++) {
      const z = warp(j / n * 2 - 1);
      for (let i = 0; i <= n; i++) { pos[k++] = warp(i / n * 2 - 1); pos[k++] = 0; pos[k++] = z; }
    }
    const idx = new Uint32Array(n * n * 6);
    let m = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a0 = j * (n + 1) + i, b = a0 + 1, c = a0 + (n + 1), d = c + 1;
        idx[m++] = a0; idx[m++] = c; idx[m++] = b; idx[m++] = b; idx[m++] = c; idx[m++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-R, -50, -R), new THREE.Vector3(R, 50, R));
    return g;
  }

  /* ---------- the sea mesh ---------- */
  const root = new THREE.Group();
  root.name = 'PONK_OCEAN';
  root.matrixAutoUpdate = true;
  const SU = {
    uD0: uv(null), uD1: uv(null), uD2: uv(null), uS0: uv(null), uS1: uv(null), uS2: uv(null), uWake: uv(null),
    uInvL: uv(V3()), uOff: uv(V3()), uTexPerM: uv(V3()), uGrid: uv(V3(600, SEA_A, 384)),
    uLambda: uv(1), uMulInv: uv(1), uAmpRef: uv(2),
    uWaterCol: uv(V3()), uFoamCol: uv(V3()), uFW: uv(V3()),
    uTransp: uv(0.55), uFoamOp: uv(V3(1, 1, 0)), uFoamSoft: uv(new THREE.Vector4(0.14, 0.14, 0.5, 0.07)), uReflTex: uv(null), uReflMat: uv(new THREE.Matrix4()), uReflP: uv(new THREE.Vector4()), uFoamAmt: uv(1), uWindN: uv(0.5), uOut: uv(0), uFogDist: uv(440), uGlint: uv(0.6), uEnvI: uv(1), uFogMode: uv(0),
    uFogCol: uv(V3(0.5, 0.6, 0.7)), uEnvRot: uv(new THREE.Matrix3()), uRot: uv(new THREE.Matrix3()), uEnv: uv(null),
  };
  const seaMat = new THREE.RawShaderMaterial({
    name: 'ocean-sea', glslVersion: THREE.GLSL3, vertexShader: HEAD + S.seaVS, fragmentShader: HEAD + S.seaFS,
    uniforms: Object.assign(pick(['uBathy', 'uBathyRect', 'uIsland', 'uLens', 'uWdir', 'uSunDir', 'uTime', 'uDeepCol', 'uCam', 'uDrift', 'uHullTex', 'uHullBox', 'uHullEm', 'uHullP', 'uHullS', 'uBow', 'uReb', 'uHullH']), SU),
    transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    defines: { ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: '0.001', CUBEUV_TEXEL_HEIGHT: '0.001', CUBEUV_MAX_MIP: '8.0' },
  });
  seaMat.toneMapped = false;
  let seaMesh = null;
  const _cp = new THREE.Vector3();
  function localCam(camera, out) {
    camera.getWorldPosition(out);
    out.set((out.x - area.center[0]) / area.scale, (out.y - area.center[1]) / area.scale, (out.z - area.center[2]) / area.scale);
    return out;
  }
  function makeSeaMesh() {
    if (seaMesh) { root.remove(seaMesh); seaMesh.geometry.dispose(); }
    seaMesh = new THREE.Mesh(seaGeometry(Q.meshN, L.seaRadius, SEA_A), seaMat);
    seaMesh.frustumCulled = false;
    seaMesh.renderOrder = -10;      /* the sea goes first among see-through objects: a boat or island with alpha-blended materials (they do not write depth) is then drawn over the water instead of being painted over by it */
    seaMesh.name = 'PONK_OCEAN_SURFACE';
    seaMesh.onBeforeRender = (r, sc, camera) => {
      U.uCam.value.copy(localCam(camera, _cp));
      SU.uOut.value = r.getRenderTarget() ? 0 : 1;
    };
    root.add(seaMesh);
    SU.uGrid.value.set(L.seaRadius, SEA_A, Q.meshN);
  }

  /* ---------- spray ---------- */
  const SPR = { n: 0, max: 0, ps: null, al: null, sz: null, vel: null, age: null, life: null, s0: null, kind: null, geo: null, pts: null, rnd: rng(99), mat: null };
  const sprayU = { uCam: U.uCam, uSunDir: U.uSunDir, uTime: U.uTime, uDeepCol: U.uDeepCol, uProj: uv(800), uAspect: uv(1.6), uOut: SU.uOut, uAmbL: uv(0.45) };
  function sprayInit(max) {
    if (SPR.pts) { root.remove(SPR.pts); SPR.geo.dispose(); }
    SPR.max = max; SPR.n = 0;
    SPR.ps = new Float32Array(max * 3); SPR.sz = new Float32Array(max); SPR.al = new Float32Array(max);
    SPR.vel = new Float32Array(max * 3); SPR.age = new Float32Array(max); SPR.life = new Float32Array(max); SPR.s0 = new Float32Array(max); SPR.kind = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    const a0 = new THREE.BufferAttribute(SPR.ps, 3); a0.setUsage(THREE.DynamicDrawUsage);
    const a1 = new THREE.BufferAttribute(SPR.sz, 1); a1.setUsage(THREE.DynamicDrawUsage);
    const a2 = new THREE.BufferAttribute(SPR.al, 1); a2.setUsage(THREE.DynamicDrawUsage);
    const a3 = new THREE.BufferAttribute(SPR.vel, 3); a3.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', a0); g.setAttribute('aSize', a1); g.setAttribute('aA', a2); g.setAttribute('aVel', a3);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    SPR.geo = g;
    if (!SPR.mat) {
      SPR.mat = new THREE.RawShaderMaterial({
        name: 'ocean-spray', glslVersion: THREE.GLSL3, vertexShader: HEAD + S.sprayVS, fragmentShader: HEAD + S.sprayFS,
        uniforms: sprayU, transparent: true, depthWrite: false, depthTest: true,
      });
      SPR.mat.toneMapped = false;
    }
    SPR.pts = new THREE.Points(g, SPR.mat);
    SPR.pts.frustumCulled = false;
    SPR.pts.renderOrder = 21;
    SPR.pts.name = 'PONK_OCEAN_SPRAY';
    SPR.pts.onBeforeRender = (r, sc, camera) => {
      const rt = r.getRenderTarget();
      const h = rt ? rt.height : r.domElement.height;
      const fov = camera.isPerspectiveCamera ? camera.fov * Math.PI / 180 : 0.8;
      sprayU.uProj.value = h / (2 * Math.tan(fov / 2));
      sprayU.uAspect.value = camera.isPerspectiveCamera ? camera.aspect : 1.6;
    };
    root.add(SPR.pts);
  }
  /* kind 0: the old puffs (shore, wind, other boats), 1: fine droplets, 2: faint mist, 3: bow sheet (a streak of water thrown up and out) */
  function sprayAdd(x, y, z, vx, vy, vz, size, life, kind) {
    if (SPR.n >= SPR.max) return;
    const i = SPR.n++;
    SPR.kind[i] = kind || 0;
    SPR.ps[i * 3] = x; SPR.ps[i * 3 + 1] = y; SPR.ps[i * 3 + 2] = z; SPR.sz[i] = size;
    SPR.vel[i * 3] = vx; SPR.vel[i * 3 + 1] = vy; SPR.vel[i * 3 + 2] = vz;
    SPR.age[i] = 0; SPR.life[i] = life; SPR.s0[i] = size;
  }
  let sprayAcc = 0, windAcc = 0;

  /* spray thrown from the real waterline of the hero hull: mostly at the bow when under way, and wherever the hull drops into a wave */
  function hullSpray(f, dt, r) {
    const h = f.hull;
    if (!h || !h.pts.u.length) return;
    const sp = clamp(f.spd / 4, 0, 1);
    const slap = clamp(-f.heaveVel * 0.9, 0, 3) + clamp(Math.abs(f.pitchVel) * 6, 0, 2);
    const energy = (0.10 + 1.3 * sp * sp + 0.6 * slap) * f.sprayK * L.boatSpray;
    f.sprayAcc = (f.sprayAcc || 0) + dt * 320 * energy;          /* droplets: many, tiny */
    f.mistAcc = (f.mistAcc || 0) + dt * 7 * energy;             /* mist: few, faint, soft */
    const rx = -f.fz, rz = f.fx, sgn = L.boatCruise ? -1 : 1;
    let n = 0;
    while (f.mistAcc >= 1 && n++ < 8) {
      f.mistAcc -= 1;
      const k = pickOutline(h, r() < 0.35 + 0.6 * sp, r());
      const u = h.pts.u[k], v = h.pts.v[k], nu = h.pts.nu[k], nv = h.pts.nv[k];
      const x = f.x + f.fx * u + rx * v, z = f.z + f.fz * u + rz * v;
      const out = 0.6 + r() * 0.8;
      sprayAdd(x, cpuHeight(x, z) + 0.2, z, (f.fx * nu + rx * nv) * out + sgn * f.fx * f.spd * 0.3, 0.8 + r() * (1.0 + 1.6 * sp), (f.fz * nu + rz * nv) * out + sgn * f.fz * f.spd * 0.3, 0.20 + r() * 0.2, 0.9 + r() * 0.9, 2);
    }
    if (f.mistAcc > 4) f.mistAcc = 0;
    /* bow sheets: short bright streaks thrown up and out where the outline faces forward, only when the boat has some speed */
    f.sheetAcc = (f.sheetAcc || 0) + dt * 70 * sp * sp * (0.4 + 0.6 * clamp(slap, 0, 1)) * f.sprayK * L.boatSpray;
    n = 0;
    while (f.sheetAcc >= 1 && n++ < 40) {
      f.sheetAcc -= 1;
      const k = pickOutline(h, true, r());
      const nu = h.pts.nu[k], nv = h.pts.nv[k];
      if (nu < 0.25) continue;
      const u = h.pts.u[k] + nu * 0.1, v = h.pts.v[k] + nv * 0.1;
      const x = f.x + f.fx * u + rx * v, z = f.z + f.fz * u + rz * v;
      const out = 1.2 + r() * 2.2 * (0.4 + sp);
      sprayAdd(x, cpuHeight(x, z) + 0.1, z, (f.fx * nu + rx * nv) * out + sgn * f.fx * f.spd * 0.55, 2.2 + r() * (2.0 + 3.0 * sp), (f.fz * nu + rz * nv) * out + sgn * f.fz * f.spd * 0.55, 0.08 + r() * 0.08, 0.40 + r() * 0.45, 3);
    }
    if (f.sheetAcc > 30) f.sheetAcc = 0;
    n = 0;
    while (f.sprayAcc >= 1 && n++ < 160) {
      f.sprayAcc -= 1;
      const k = pickOutline(h, r() < 0.35 + 0.6 * sp, r());
      const u = h.pts.u[k] + (r() - 0.5) * 0.35, v = h.pts.v[k] + (r() - 0.5) * 0.35, nu = h.pts.nu[k], nv = h.pts.nv[k];
      const x = f.x + f.fx * (u + nu * 0.12) + rx * (v + nv * 0.12), z = f.z + f.fz * (u + nu * 0.12) + rz * (v + nv * 0.12);
      const bowFace = Math.max(nu, 0);
      const out = (0.5 + r() * 1.8) * (0.5 + 1.5 * sp * (0.3 + bowFace) + 0.4 * slap);
      const vx = (f.fx * nu + rx * nv) * out + sgn * f.fx * f.spd * 0.45 + (r() - 0.5) * 1.2;
      const vz = (f.fz * nu + rz * nv) * out + sgn * f.fz * f.spd * 0.45 + (r() - 0.5) * 1.2;
      sprayAdd(x, cpuHeight(x, z) + 0.08 + heroBowA * 0.7 * bowFace, z, vx, 1.2 + r() * (1.6 + 3.4 * sp * (0.3 + bowFace) + 1.8 * slap), vz, 0.035 + r() * 0.07, 0.45 + r() * 0.7, 1);
    }
    if (f.sprayAcc > 200) f.sprayAcc = 0;
    /* rebound splash: where a wave crest reaches the hull, a few drops are thrown back off the side (works at rest too) */
    const rb = clamp(L.hullRebound, 0, 2);
    if (rb > 0.01) {
      f.rbAcc = (f.rbAcc || 0) + dt * 90 * rb * f.sprayK * L.boatSpray * (0.6 + 0.8 * (f.rbMotion || 0));
      n = 0;
      const sg = Math.max(SIM.sigma * area.scale, 1e-3);
      while (f.rbAcc >= 1 && n++ < 60) {
        f.rbAcc -= 1;
        const k = pickOutline(h, false, r());
        const nu = h.pts.nu[k], nv = h.pts.nv[k];
        const u = h.pts.u[k] + nu * 0.25, v = h.pts.v[k] + nv * 0.25;
        const x = f.x + f.fx * u + rx * v, z = f.z + f.fz * u + rz * v;
        const hc = cpuHeight(x, z) / sg;                            /* crest height here in wave sigmas */
        if (r() > clamp((hc + 0.4) * 0.55, 0, 1) * clamp((hc + 0.4) * 0.55, 0, 1)) continue;
        const out = 0.5 + r() * 1.3;
        sprayAdd(x, cpuHeight(x, z) + 0.05, z, (f.fx * nu + rx * nv) * out + (r() - 0.5) * 0.6, 1.4 + r() * 2.4 * (0.5 + clamp(hc * 0.4, 0, 1)), (f.fz * nu + rz * nv) * out + (r() - 0.5) * 0.6, 0.035 + r() * 0.07, 0.45 + r() * 0.6, 1);
      }
      if (f.rbAcc > 60) f.rbAcc = 0;
    }
  }
  function sprayUpdate(dt, focus) {
    if (!SPR.geo || !modes) return;
    const r = SPR.rnd;
    const I = Math.min(SIM.foamAmt, 1.6);
    if (L.spray && I > 0.05) {
      if (islandOn && shoreCells.length) {
        sprayAcc += dt * 70 * I * (0.35 + SIM.wind);
        let tries = 0;
        while (sprayAcc >= 1 && tries++ < 30) {
          sprayAcc -= 1;
          const sc = shoreCells[Math.floor(r() * shoreCells.length)];
          const x = sc[0], z = sc[1];
          const d = -terrainT(x, z);
          if (d < 0.5 || d > 7) continue;
          const h = crestHeight(x, z);
          const B = crestRaw(x, z) * shoalOf(d) / (0.40 * d + 0.05);
          if (B < 0.85) continue;
          const k = Math.min(1.2, B);
          const sp = 1.5 + r() * 3.2;
          sprayAdd(x, h + 0.25, z, sc[2] * sp + (r() - 0.5) * 2, 2.2 + r() * 4.5 * k, sc[3] * sp + (r() - 0.5) * 2, 0.5 + r() * 1.0, 0.8 + r() * 1.2);
        }
        if (sprayAcc > 8) sprayAcc = 0;
      }
      for (const f of floaters) {
        if (f.hero && f.hull && L.hullShape) { hullSpray(f, dt, r); continue; }
        if (f.spd < 1.2) continue;
        const n = Math.floor(dt * 160 * f.spd * f.spd / 12 * f.sprayK * L.boatSpray + r());
        for (let i = 0; i < n; i++) {
          const bx = f.x + f.fx * f.hl * 0.88, bz = f.z + f.fz * f.hl * 0.88;
          const side = r() < 0.5 ? -1 : 1;
          const rx = -f.fz, rz = f.fx;
          const sp = 1 + r() * 2.2;
          sprayAdd(bx + rx * side * 0.5, f.heave + 0.2, bz + rz * side * 0.5, rx * side * sp + f.fx * f.spd * 0.5, 1.6 + r() * 2.4, rz * side * sp + f.fz * f.spd * 0.5, 0.35 + r() * 0.7, 0.6 + r() * 0.8);
        }
      }
      windAcc += dt * 160 * sstep(0.45, 1.0, SIM.wind) * I;
      let wt = 0;
      while (windAcc >= 1 && wt++ < 20) {
        windAcc -= 1;
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 70;
        const x = focus[0] + Math.cos(a) * rr, z = focus[1] + Math.sin(a) * rr;
        const h = crestHeight(x, z);
        if (h < 1.1 * SIM.sigma) continue;
        const sp = 2 + SIM.wind * 4 * r();
        sprayAdd(x, h + 0.1, z, WDIR[0] * sp, 0.4 + r() * 1.6, WDIR[1] * sp, 0.3 + r() * 0.6, 0.6 + r() * 0.9);
      }
      if (windAcc > 10) windAcc = 0;
    }
    let i = 0;
    while (i < SPR.n) {
      SPR.age[i] += dt;
      const a = SPR.age[i];
      if (a >= SPR.life[i] || SPR.ps[i * 3 + 1] < -1.0) {
        const j = SPR.n - 1;
        if (i !== j) {
          for (let c = 0; c < 3; c++) { SPR.ps[i * 3 + c] = SPR.ps[j * 3 + c]; SPR.vel[i * 3 + c] = SPR.vel[j * 3 + c]; }
          SPR.sz[i] = SPR.sz[j]; SPR.age[i] = SPR.age[j]; SPR.life[i] = SPR.life[j]; SPR.s0[i] = SPR.s0[j]; SPR.kind[i] = SPR.kind[j];
        }
        SPR.n--;
        continue;
      }
      const damp = 1 - 0.7 * dt;
      SPR.vel[i * 3] *= damp; SPR.vel[i * 3 + 2] *= damp;
      SPR.vel[i * 3 + 1] -= 9.8 * dt;
      SPR.ps[i * 3] += SPR.vel[i * 3] * dt; SPR.ps[i * 3 + 1] += SPR.vel[i * 3 + 1] * dt; SPR.ps[i * 3 + 2] += SPR.vel[i * 3 + 2] * dt;
      const t = a / SPR.life[i];
      const kd = SPR.kind[i];
      SPR.sz[i] = SPR.s0[i] * (kd === 1 ? 1 - 0.35 * t : kd === 2 ? 1 + 1.2 * t : kd === 3 ? 1 - 0.25 * t : 1 + 1.4 * t);
      SPR.al[i] = sstep(0, 0.05, a) * Math.pow(1 - t, kd === 1 || kd === 3 ? 0.5 : 0.8) * (kd === 1 ? 0.95 : kd === 2 ? 0.10 : kd === 3 ? 0.60 : 0.8);
      i++;
    }
    const at = SPR.geo.attributes;
    at.position.needsUpdate = true; at.aSize.needsUpdate = true; at.aA.needsUpdate = true; at.aVel.needsUpdate = true;
    SPR.geo.setDrawRange(0, SPR.n);
    SPR.pts.visible = SPR.n > 0;
  }

  /* ---------- quality tier ---------- */
  function freeQuality() {
    if (!Q) return;
    Q.cas.forEach((c) => { c.noiseTex.dispose(); c.F.forEach((t) => t.dispose()); c.D.dispose(); c.S0.dispose(); c.S1.dispose(); });
    Q.wk0.dispose(); Q.wk1.dispose();
    Q = null;
  }
  function buildQuality(qi) {
    freeQuality();
    const q = QUALITY[qi];
    const cas = CASCADES.map((cd, i) => {
      const N = q.N[i];
      const noiseData = noiseFor(N, 1234 + i * 77);
      const noiseTex = new THREE.DataTexture(noiseData, N, N, THREE.RGBAFormat, THREE.FloatType);
      noiseTex.minFilter = THREE.NearestFilter; noiseTex.magFilter = THREE.NearestFilter; noiseTex.generateMipmaps = false; noiseTex.needsUpdate = true;
      const mipRT = () => {
        const t = mkRT(N, N, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
        t.texture.anisotropy = maxAniso;
        return t;
      };
      return {
        N, L: cd.L, kmin: cd.kmin, kmax: cd.kmax, tau: cd.tau, fw: cd.fw, noiseData, noiseTex,
        F: [mkRT(N, N, { type: THREE.FloatType, count: 2 }), mkRT(N, N, { type: THREE.FloatType, count: 2 })],
        D: mipRT(), S0: mipRT(), S1: mipRT(), stages: Math.round(Math.log2(N)),
      };
    });
    const wkOpt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const wk0 = mkRT(q.wake, q.wake, wkOpt), wk1 = mkRT(q.wake, q.wake, wkOpt);
    Q = { qi, q, cas, wk0, wk1, meshN: q.mesh };
    beginPasses();
    [wk0, wk1].forEach(clearTarget);
    cas.forEach((c) => { clearTarget(c.S0); clearTarget(c.S1); });
    endPasses();
    makeSeaMesh();
    sprayInit(q.spray);
    buildModes();
  }

  /* foam: injected where the jacobian drops into its lower tail (crests folding over) */
  function foamParams(ci) {
    const w = SIM.wind, I = SIM.foamAmt;
    const gate = Math.max(sstep(0.12, 0.45, w), clamp(I - 1, 0, 1) * 0.5) * sstep(0.0, 0.3, I);
    const eps = Math.max(SIM.lambdaF * Math.sqrt(SIM.mss[ci]), 0.01);
    const kappa = clamp(mix(3.1, 2.0, w) + (ci === 1 ? 0.25 : 0) - 0.7 * (I - 1), 1.0, 3.6);
    return { thr: 1 - kappa * eps, wid: Math.max(0.6 * eps, 0.02), gain: (ci === 2 ? 0 : 1) * gate * Math.min(I, 1.6) };
  }

  function stepOcean(dt) {
    const tn = (SIM.simT % PERIOD) / PERIOD;
    Q.cas.forEach((c, ci) => {
      const eu = M.evolve.uniforms;
      eu.uNoise.value = c.noiseTex; eu.uN.value = c.N; eu.uL.value = c.L; eu.uKmin.value = c.kmin; eu.uKmax.value = c.kmax;
      eu.uTn.value = tn; eu.uWind.value = SIM.U; eu.uSpread.value = SIM.spread; eu.uGamma.value = SIM.gamma; eu.uAmpK.value = SIM.ampK;
      runPass(M.evolve, c.F[0]);
      const total = c.stages * 2;
      const fu = M.fft.uniforms;
      fu.uN.value = c.N; fu.uSign.value = 1;
      for (let s = 0; s < total; s++) {
        const src = c.F[s % 2], dst = c.F[1 - (s % 2)];
        fu.uHoriz.value = s < c.stages ? 1 : 0;
        fu.uP.value = 1 << (s % c.stages);
        fu.uSrcA.value = src.textures[0]; fu.uSrcB.value = src.textures[1];
        runPass(M.fft, dst);
      }
      const res = c.F[0];
      const du = M.combD.uniforms;
      du.uA.value = res.textures[0]; du.uB.value = res.textures[1]; du.uLambda.value = SIM.lambda;
      runPass(M.combD, c.D);
      const fp = foamParams(ci);
      const su = M.combS.uniforms;
      su.uA.value = res.textures[0]; su.uB.value = res.textures[1]; su.uPrev.value = c.S0.texture; su.uLambda.value = SIM.lambdaF;
      su.uDecay.value = Math.exp(-Math.min(dt, 0.1) / (c.tau * (0.7 + 0.8 * SIM.wind)));
      su.uJthr.value = fp.thr; su.uJwid.value = fp.wid; su.uGain.value = fp.gain;
      runPass(M.combS, c.S1);
      const tmp = c.S0; c.S0 = c.S1; c.S1 = tmp;
    });
  }
  function stepWake(dt) {
    const c0 = Q.cas[0], c1 = Q.cas[1];
    const w = M.wake.uniforms;
    w.uPrev.value = Q.wk0.texture; w.uD0.value = c0.D.texture; w.uD1.value = c1.D.texture;
    w.uInvL0.value = SIM.mul / c0.L; w.uInvL1.value = SIM.mul / c1.L; w.uOff0.value = 0.5 / c0.N; w.uOff1.value = 0.5 / c1.N;
    w.uMulInv.value = 1 / SIM.mul;
    const d = Math.min(dt, 0.1);
    w.uDecayB.value = Math.exp(-d / 1.8); w.uDecayW.value = Math.exp(-d / 15);
    w.uAmpRef.value = SIM.ampRef; w.uBreak.value = Math.min(SIM.foamAmt, 1.6); w.uDt.value = d;
    const h0 = floaters[0];
    w.uAdv.value.set(h0 && heroFlow > 0 ? h0.fx * heroFlow * d : 0, h0 && heroFlow > 0 ? h0.fz * heroFlow * d : 0);
    for (let i = 0; i < NEM; i++) {
      const f = floaters[i];
      if (f) { w.uEm.value[i].set(f.x, f.z, f.fx, f.fz); w.uEmP.value[i].set(f.hl * 1.0, f.hw, clamp(f.spd / 4, 0, 1), 1); }
      else w.uEmP.value[i].set(1, 1, 0, 0);
    }
    runPass(M.wake, Q.wk1);
    const t = Q.wk0; Q.wk0 = Q.wk1; Q.wk1 = t;
  }

  /* ======================================================== environment === */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const domeScene = new THREE.Scene();
  const domeMat = new THREE.ShaderMaterial({
    vertexShader: S.domeVS, fragmentShader: S.domeFS, side: THREE.BackSide, depthWrite: false,
    uniforms: { uSunDir: U.uSunDir, uTime: uv(0), uDeepCol: U.uDeepCol },
  });
  domeScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), domeMat));
  let procEnv = null, procKey = '';
  let envTex = null, envHeight = 0;
  let lastBake = -1e9;
  function bakeProcEnv() {
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    if (procEnv && now - lastBake < 250) return;
    const key = [U.uSunDir.value.x.toFixed(3), U.uSunDir.value.y.toFixed(3), U.uSunDir.value.z.toFixed(3), U.uDeepCol.value.x.toFixed(3), U.uDeepCol.value.y.toFixed(3)].join();
    if (procEnv && key === procKey) return;
    procKey = key;
    lastBake = now;
    if (procEnv) procEnv.dispose();
    procEnv = pmrem.fromScene(domeScene, 0, 0.1, 100);
  }
  const _e = new THREE.Euler(), _m4 = new THREE.Matrix4();
  function refreshEnv() {
    const e = scene.environment;
    let tex = null, hostEnv = false;
    if (e && e.mapping === THREE.CubeUVReflectionMapping && e.image && e.image.height) { tex = e; hostEnv = true; }
    if (!tex) { bakeProcEnv(); tex = procEnv.texture; }
    if (tex !== envTex || tex.image.height !== envHeight) {
      envTex = tex; envHeight = tex.image.height;
      const maxMip = Math.log2(envHeight) - 2;
      seaMat.defines.CUBEUV_MAX_MIP = maxMip + '.0';
      seaMat.defines.CUBEUV_TEXEL_HEIGHT = String(1 / envHeight);
      seaMat.defines.CUBEUV_TEXEL_WIDTH = String(1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)));
      seaMat.needsUpdate = true;
      SU.uEnv.value = tex;
    }
    if (hostEnv && scene.environmentRotation) {
      _e.copy(scene.environmentRotation); _e.x *= -1; _e.y *= -1; _e.z *= -1;
      SU.uEnvRot.value.setFromMatrix4(_m4.makeRotationFromEuler(_e));
    } else SU.uEnvRot.value.identity();
    SU.uEnvI.value = (hostEnv && typeof scene.environmentIntensity === 'number' ? scene.environmentIntensity : 1) * L.reflect;
    return hostEnv;
  }

  let floaters = [];

  /* ============================================================ hull shape === */
  /* The hull proxy (one closed mesh, or several: twin hulls, a hull plus a keel) is cut with the water plane in the
     boat's own frame. The plane follows how far the boat is lifted and tilted away from the water under it, so a boat
     riding deeper or heeling over gets a different outline. The outline becomes:
       - a signed-distance map in boat-local axes: R = true waterline (hides the water inside the hull),
         G = the same outline taken a little higher up, so a flared hull's foam ring starts outside its overhang;
       - a list of outline points with outward normals, used to throw spray;
       - line segments for the outline preview. */
  const HULL_OVERHANG = 0.55;
  /* A hull mesh made of several separate shells (a hull plus a keel, twin hulls, parts joined into one object) is split
     into its connected shells, and each shell is filled on its own. The fill is even-odd per mesh, so shells that overlap
     would otherwise cancel each other out; as separate meshes they simply add up. Cached per source mesh. */
  const _shellCache = new WeakMap();
  function splitShells(m) {
    if (!m || !m.p || !m.i || m.i.length < 6) return [m];
    const hit = _shellCache.get(m); if (hit) return hit;
    const P = m.p, I = m.i, nv = (P.length / 3) | 0, nt = (I.length / 3) | 0;
    const par = new Int32Array(nv); for (let k = 0; k < nv; k++) par[k] = k;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      if (a >= nv || b >= nv || c >= nv) { _shellCache.set(m, [m]); return [m]; }
      const ra = find(a), rb = find(b); if (ra !== rb) par[rb] = ra;
      const rc = find(c), r2 = find(a); if (rc !== r2) par[rc] = r2;
    }
    const groups = new Map();
    for (let t = 0; t < nt; t++) { const r = find(I[t * 3]); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(t); }
    let out = [m];
    if (groups.size > 1 && groups.size <= 24) {
      out = [];
      const remap = new Int32Array(nv);
      groups.forEach((tris) => {
        remap.fill(-1);
        const p = [], idx = [];
        for (const t of tris) for (let q = 0; q < 3; q++) {
          const v = I[t * 3 + q]; let n = remap[v];
          if (n < 0) { n = remap[v] = (p.length / 3) | 0; p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
          idx.push(n);
        }
        out.push({ p, i: idx });
      });
    }
    _shellCache.set(m, out);
    return out;
  }
  function hullMeshes(h) {
    const a = !h ? [] : Array.isArray(h) ? h.filter(Boolean) : [h];
    const out = [];
    for (const m of a) for (const s of splitShells(m)) out.push(s);
    return out;
  }
  let ringQLast = 1;
  const HF_F32 = new Float32Array(1), HF_U32 = new Uint32Array(HF_F32.buffer);
  function buildHull(f, hull, level, rel, reuse) {
    const meshes = hullMeshes(hull).filter((m) => m.p && m.p.length >= 9);
    if (!meshes.length) return null;
    const t0 = performance.now();
    const sc = area.scale;
    const fx = f.bow[0], fz = f.bow[1], rx = -fz, rz = fx;
    const yw0 = (area.center[1] - f.pivot.y + (level || 0)) / sc + (rel ? rel.dy : 0);
    const su = rel ? rel.su : 0, sv = rel ? rel.sv : 0;
    /* hull vertices in boat-local sim units (u along the bow, v to the right, y up) */
    const MS = meshes.map((m) => {
      const P = m.p, I = (m.i && m.i.length) ? m.i : null;
      const nv = P.length / 3, nt = I ? Math.floor(I.length / 3) : Math.floor(nv / 3);
      const U = new Float32Array(nv), V = new Float32Array(nv), Y = new Float32Array(nv);
      for (let k = 0; k < nv; k++) {
        const dx = P[k * 3] - f.pivot.x, dy = P[k * 3 + 1] - f.pivot.y, dz = P[k * 3 + 2] - f.pivot.z;
        U[k] = (dx * fx + dz * fz) / sc; V[k] = (dx * rx + dz * rz) / sc; Y[k] = dy / sc;
      }
      return { I, nt, U, V, Y };
    });
    /* map extent from all hull vertices (stable between rebuilds, so the texture can be reused) */
    let eu0 = 1e9, eu1 = -1e9, ev0 = 1e9, ev1 = -1e9;
    MS.forEach((m) => { for (let k = 0; k < m.U.length; k++) { eu0 = Math.min(eu0, m.U[k]); eu1 = Math.max(eu1, m.U[k]); ev0 = Math.min(ev0, m.V[k]); ev1 = Math.max(ev1, m.V[k]); } });
    /* a bigger foam ring needs a wider band of distance data around the hull (quantised so dragging the slider rarely resizes the map) */
    const ringQ = Math.max(1, Math.ceil(clamp(L.hullRing == null ? 1 : L.hullRing, 0, 6) * 2) / 2);
    ringQLast = ringQ;
    const bandMax = 3.4 + 2.3 * (ringQ - 1);
    const marg = bandMax + 0.1 + 0.2 * (ev1 - ev0);
    const u0 = eu0 - marg, u1 = eu1 + marg, v0 = ev0 - marg, v1 = ev1 + marg;
    const res = clamp(L.hullRes == null ? 0.5 : L.hullRes, 0, 1);
    const cap = Math.round(128 + 256 * res + 32 * (ringQ - 1)), minTexel = 0.12 - 0.09 * res;
    const texel = Math.max(minTexel, Math.max(u1 - u0, v1 - v0) / cap);
    const nx = clamp(Math.ceil((u1 - u0) / texel), 16, cap), ny = clamp(Math.ceil((v1 - v0) / texel), 16, cap);
    const du = u1 - u0, dv = v1 - v0;
    /* slice every mesh at the waterline (set 0) and a little above it (set 1) */
    const segW = [], segO = [];
    MS.forEach((m, mi) => {
      for (let set = 0; set < 2; set++) {
        const yw = yw0 + (set ? HULL_OVERHANG / sc : 0);
        const out = set ? segO : segW;
        const cut = (a, b) => {
          const ya = m.Y[a] - (yw + su * m.U[a] + sv * m.V[a]), yb = m.Y[b] - (yw + su * m.U[b] + sv * m.V[b]);
          if ((ya > 0) === (yb > 0)) return null;
          const t = ya / (ya - yb);
          return [m.U[a] + (m.U[b] - m.U[a]) * t, m.V[a] + (m.V[b] - m.V[a]) * t];
        };
        for (let t = 0; t < m.nt; t++) {
          const a = m.I ? m.I[t * 3] : t * 3, b = m.I ? m.I[t * 3 + 1] : t * 3 + 1, c = m.I ? m.I[t * 3 + 2] : t * 3 + 2;
          const p0 = cut(a, b), p1 = cut(b, c), p2 = cut(c, a);
          const pts = []; if (p0) pts.push(p0); if (p1) pts.push(p1); if (p2) pts.push(p2);
          if (pts.length === 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1], mi]);
        }
      }
    });
    const n = nx * ny;
    const buf = (reuse && reuse.nx === nx && reuse.ny === ny) ? reuse : { nx, ny, data: new Uint16Array(n * 2), d1: new Float32Array(n), d2: new Float32Array(n), in1: new Uint8Array(n), in2: new Uint8Array(n), tex: null };
    const BIG = 1e9;
    buf.d1.fill(BIG); buf.d2.fill(BIG); buf.in1.fill(0); buf.in2.fill(0);
    /* exact distances only close to the outline (cheap); the far field of the foam ring is filled in by a fast two-pass chamfer */
    const band = Math.min(marg, bandMax);
    const bNear = Math.min(band, 1.1);
    const bi = Math.ceil(bNear / du * nx), bj = Math.ceil(bNear / dv * ny);
    /* distance: each segment only touches the texels within the band around it */
    const sweep = (segs, d1, d2) => {
      for (let s = 0; s < segs.length; s++) {
        const g = segs[s], ex = g[2] - g[0], ey = g[3] - g[1], l2 = ex * ex + ey * ey;
        const iA = clamp(Math.floor((Math.min(g[0], g[2]) - u0) / du * nx) - bi, 0, nx - 1), iB = clamp(Math.ceil((Math.max(g[0], g[2]) - u0) / du * nx) + bi, 0, nx - 1);
        const jA = clamp(Math.floor((Math.min(g[1], g[3]) - v0) / dv * ny) - bj, 0, ny - 1), jB = clamp(Math.ceil((Math.max(g[1], g[3]) - v0) / dv * ny) + bj, 0, ny - 1);
        for (let j = jA; j <= jB; j++) {
          const pv = v0 + (j + 0.5) / ny * dv;
          for (let i = iA; i <= iB; i++) {
            const pu = u0 + (i + 0.5) / nx * du;
            let t = l2 > 1e-12 ? ((pu - g[0]) * ex + (pv - g[1]) * ey) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = pu - (g[0] + ex * t), dy = pv - (g[1] + ey * t), q = dx * dx + dy * dy, k = j * nx + i;
            if (d1 && q < d1[k]) d1[k] = q;
            if (q < d2[k]) d2[k] = q;
          }
        }
      }
    };
    sweep(segW, buf.d1, buf.d2);
    sweep(segO, null, buf.d2);
    /* inside: even-odd along each row, one mesh at a time, so separate or overlapping parts add up as a union */
    const fillIn = (segs, mask) => {
      const byMesh = new Map();
      segs.forEach((g) => { if (!byMesh.has(g[4])) byMesh.set(g[4], []); byMesh.get(g[4]).push(g); });
      byMesh.forEach((list) => {
        for (let j = 0; j < ny; j++) {
          const pv = v0 + (j + 0.5) / ny * dv;
          const xs = [];
          for (let s = 0; s < list.length; s++) {
            const g = list[s];
            if ((g[1] > pv) !== (g[3] > pv)) xs.push(g[0] + (pv - g[1]) * (g[2] - g[0]) / (g[3] - g[1]));
          }
          if (xs.length < 2) continue;
          xs.sort((a, b) => a - b);
          for (let q = 0; q + 1 < xs.length; q += 2) {
            const iA = clamp(Math.ceil((xs[q] - u0) / du * nx - 0.5), 0, nx), iB = clamp(Math.floor((xs[q + 1] - u0) / du * nx - 0.5), -1, nx - 1);
            for (let i = iA; i <= iB; i++) mask[j * nx + i] = 1;
          }
        }
      });
    };
    fillIn(segW, buf.in1);
    fillIn(segO, buf.in2);
    const far = band, far1 = bNear;
    /* chamfer: spread the exact near-outline distances outward (distance to the foam-ring outline only) */
    const dd = buf.dd && buf.dd.length === n ? buf.dd : (buf.dd = new Float32Array(n));
    for (let k = 0; k < n; k++) dd[k] = buf.d2[k] >= BIG ? 1e4 : Math.sqrt(buf.d2[k]);
    const wu = du / nx, wv = dv / ny, wdg = Math.hypot(wu, wv);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i; let m = dd[k];
        if (i > 0) { const a = dd[k - 1] + wu; if (a < m) m = a; }
        if (j > 0) {
          const a = dd[k - nx] + wv; if (a < m) m = a;
          if (i > 0) { const b2 = dd[k - nx - 1] + wdg; if (b2 < m) m = b2; }
          if (i < nx - 1) { const c = dd[k - nx + 1] + wdg; if (c < m) m = c; }
        }
        dd[k] = m;
      }
    }
    for (let j = ny - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i; let m = dd[k];
        if (i < nx - 1) { const a = dd[k + 1] + wu; if (a < m) m = a; }
        if (j < ny - 1) {
          const a = dd[k + nx] + wv; if (a < m) m = a;
          if (i < nx - 1) { const b2 = dd[k + nx + 1] + wdg; if (b2 < m) m = b2; }
          if (i > 0) { const c = dd[k + nx - 1] + wdg; if (c < m) m = c; }
        }
        dd[k] = m;
      }
    }
    /* fast float -> half (values are small and finite) */
    const f32 = HF_F32, u32 = HF_U32;
    const H = (v) => { f32[0] = v; const x = u32[0], sg = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112; return e <= 0 ? sg : e >= 31 ? (sg | 0x7bff) : (sg | (e << 10) | ((x >>> 13) & 0x3ff)); };
    for (let k = 0; k < n; k++) {
      const r1 = buf.d1[k] >= BIG ? far1 : Math.min(Math.sqrt(buf.d1[k]), far1);
      const r2 = Math.min(dd[k], far);
      buf.data[k * 2] = H(buf.in1[k] ? -r1 : r1);
      buf.data[k * 2 + 1] = H((buf.in1[k] || buf.in2[k]) ? -r2 : r2);
    }
    let tex = buf.tex;
    if (!tex) {
      tex = new THREE.DataTexture(buf.data, nx, ny, THREE.RGFormat, THREE.HalfFloatType);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false;
      buf.tex = tex;
    }
    tex.needsUpdate = true;
    /* outline points with outward normals (from the gradient of the map), two weightings: even all round, and bow-heavy */
    const op = { u: [], v: [], nu: [], nv: [], cumUni: [], cumBow: [], total: 0, totalBow: 0 };
    const sg = (pu, pv) => {
      const i = clamp(Math.floor((pu - u0) / du * nx), 0, nx - 1), j = clamp(Math.floor((pv - v0) / dv * ny), 0, ny - 1), k = j * nx + i;
      const r = buf.d1[k] >= BIG ? far1 : Math.sqrt(buf.d1[k]);
      return buf.in1[k] ? -r : r;
    };
    let cu = 0, cb = 0;
    const e = 0.12;
    segW.forEach((g) => {
      const ex = g[2] - g[0], ey = g[3] - g[1], len = Math.hypot(ex, ey);
      if (len < 1e-4) return;
      const mu = (g[0] + g[2]) / 2, mv = (g[1] + g[3]) / 2;
      let nu = sg(mu + e, mv) - sg(mu - e, mv), nv2 = sg(mu, mv + e) - sg(mu, mv - e);
      const nl = Math.hypot(nu, nv2);
      if (nl < 1e-5) { nu = ey / len; nv2 = -ex / len; } else { nu /= nl; nv2 /= nl; }
      op.u.push(mu); op.v.push(mv); op.nu.push(nu); op.nv.push(nv2);
      cu += len; cb += len * (0.15 + 1.85 * Math.pow(Math.max(nu, 0), 1.5));
      op.cumUni.push(cu); op.cumBow.push(cb);
    });
    op.total = cu; op.totalBow = cb;
    let ou0 = 1e9, ou1 = -1e9, ov0 = 1e9, ov1 = -1e9;
    segW.forEach((g) => { ou0 = Math.min(ou0, g[0], g[2]); ou1 = Math.max(ou1, g[0], g[2]); ov0 = Math.min(ov0, g[1], g[3]); ov1 = Math.max(ov1, g[1], g[3]); });
    let ymaxH = -1e9;
    MS.forEach((m) => { for (let k = 0; k < m.Y.length; k++) if (m.Y[k] > ymaxH) ymaxH = m.Y[k]; });
    return {
      topH: Math.max(ymaxH - yw0, 0.3),
      tex, buf, box: [u0, v0, du, dv], pts: op, texel: Math.max(du / nx, dv / ny), size: [nx, ny], meshes: MS.length,
      extent: segW.length ? [ou1 - ou0, ov1 - ov0] : [0, 0], urange: segW.length ? [ou0, ou1] : [0, 0], segW: segW.map((g) => [g[0], g[1], g[2], g[3]]),
      ms: performance.now() - t0, rel: rel ? { dy: rel.dy, su: rel.su, sv: rel.sv } : { dy: 0, su: 0, sv: 0 }, built: performance.now(),
    };
  }
  function pickOutline(h, bowWeighted, rnd) {
    const cum = bowWeighted ? h.pts.cumBow : h.pts.cumUni;
    const tot = bowWeighted ? h.pts.totalBow : h.pts.total;
    const x = rnd * tot;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function rebuildHulls() {
    floaters.forEach((f) => {
      const keep = f.hull ? f.hull.buf : null;
      f.hull = f.hero && f.hullSrc ? buildHull(f, f.hullSrc, L.hullLevel, f.hullRel || null, keep) : null;
      if (keep && keep.tex && (!f.hull || f.hull.buf !== keep)) keep.tex.dispose();
    });
  }

  /* ============================================================== floaters === */
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v3 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _mT = new THREE.Matrix4(), _mR = new THREE.Matrix4(), _mP = new THREE.Matrix4();
  /* ---------- wet hull: boat materials get a darker, glossier band that follows the waterline ---------- */
  const WET_KEY = 'ponkwet1';
  const WET_FS = `{
  float wy = uWet.x + uWet.y*vWetW.x + uWet.z*vWetW.z;
  float lapw = uWet2.z*(sin(vWetW.x*2.3 + uWet2.y*1.7)*sin(vWetW.z*1.9 - uWet2.y*1.3)*0.5 + 0.5);
  float dhw = vWetW.y - wy - lapw;
  float wetK = (1.0 - smoothstep(0.0, uWet.w, dhw))*uWet2.x;
  float bx = (dhw - 0.02)/0.10;
  float bandK = exp(-min(bx*bx, 40.0))*uWet2.x*uWet2.w;
  vec3 c0w = max(diffuseColor.rgb, vec3(0.0001));
  vec3 cww = pow(c0w, vec3(1.45))*0.82;
  vec3 cwo = mix(c0w, cww, wetK)*(1.0 - 0.30*bandK)*mix(1.0, 0.75, (1.0 - smoothstep(-0.4, 0.0, dhw))*uWet2.x);
  /* with the effect off (or on anything not finite) the original colour passes through untouched */
  if (uWet2.x > 0.0001 && cwo.r >= 0.0 && cwo.g >= 0.0 && cwo.b >= 0.0 && cwo.r < 64.0 && cwo.g < 64.0 && cwo.b < 64.0) diffuseColor.rgb = cwo;
  float rfw = mix(roughnessFactor, roughnessFactor*0.45, wetK);
  if (uWet2.x > 0.0001 && rfw >= 0.0 && rfw <= 1.0) roughnessFactor = rfw;
}`;
  function wetApplyMat(m, U2) {
    if (!m || !m.isMeshStandardMaterial) return;
    /* glass is left alone: the wet look has no business in a see-through material, and it is drawn from the transmission copy of the scene */
    if (m.transmission > 0 || (m.transparent && m.opacity < 0.98)) { if (m.userData && m.userData.__ponkWet) wetRelease(m); return; }
    if (m.userData && m.userData.__ponkWet) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.userData.__ponkWet = { prev, prevKey };
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uWet = U2.uWet; sh.uniforms.uWet2 = U2.uWet2;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetW = (modelMatrix*vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetW;\nuniform vec4 uWet;\nuniform vec4 uWet2;').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + WET_FS);
    };
    m.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + WET_KEY; };
    m.needsUpdate = true;
  }
  function wetRelease(m) {
    const w = m && m.userData && m.userData.__ponkWet;
    if (!w) return;
    m.onBeforeCompile = w.prev || (() => {}); if (w.prevKey) m.customProgramCacheKey = w.prevKey; else delete m.customProgramCacheKey;
    delete m.userData.__ponkWet; m.needsUpdate = true;
  }
  function wetEach(f, fn) {
    f.tops.forEach((t) => t.traverse((o) => {
      if (!o.isMesh || !o.material || o.name === 'PONK_OCEAN_HULL_OUTLINE') return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn);
    }));
  }
  let wetLast = !!L.wetOn, wetTick = 0;
  function wetApply(f) {
    if (!L.wetOn) return;
    if (!f.wetU) f.wetU = { uWet: { value: new THREE.Vector4(0, 0, 0, 0.3) }, uWet2: { value: new THREE.Vector4(0, 0, 0, 1) } };
    wetEach(f, (m) => wetApplyMat(m, f.wetU));
  }
  /* The model keeps the hierarchy it was built with. A floating part is never moved to another parent: the sea motion
     is applied as a world-space offset on top of the part's own world matrix, so lookups by name, visibility toggles,
     variants, material swaps and the viewer's own mesh lists all keep working exactly as without the ocean. */
  function hookPart(o, D) {
    if (o.__ponkHook) return;
    const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
    o.__ponkHook = { own: has('updateMatrixWorld') ? o.updateMatrixWorld : null, ownW: has('updateWorldMatrix') ? o.updateWorldMatrix : null };
    /* getWorldPosition(), Box3.setFromObject() and the like go through this one: they must see the sea motion as well */
    o.updateWorldMatrix = function (updateParents, updateChildren) {
      if (updateParents === true && this.parent !== null) this.parent.updateWorldMatrix(true, false);
      if (this.matrixAutoUpdate) this.updateMatrix();
      if (this.parent === null) this.matrixWorld.copy(this.matrix); else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      this.matrixWorld.premultiply(D);
      if (updateChildren === true) { const ch = this.children; for (let i = 0, n = ch.length; i < n; i++) ch[i].updateWorldMatrix(false, true); }
    };
    o.updateMatrixWorld = function () {
      if (this.matrixAutoUpdate) this.updateMatrix();
      if (this.parent === null) this.matrixWorld.copy(this.matrix); else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      this.matrixWorld.premultiply(D);
      this.matrixWorldNeedsUpdate = false;
      const ch = this.children;
      for (let i = 0, n = ch.length; i < n; i++) ch[i].updateMatrixWorld(true);
    };
  }
  function unhookPart(o) {
    const h = o.__ponkHook;
    if (!h) return;
    if (h.own) o.updateMatrixWorld = h.own; else delete o.updateMatrixWorld;
    if (h.ownW) o.updateWorldMatrix = h.ownW; else delete o.updateWorldMatrix;
    delete o.__ponkHook;
  }
  function disposeFloaters() {
    for (const f of floaters) {
      if (f.hull && f.hull.buf.tex) f.hull.buf.tex.dispose();
      wetEach(f, wetRelease);
      f.tops.forEach((o) => { unhookPart(o); o.updateMatrixWorld(true); });
    }
    floaters = [];
  }
  /* spec: { objects: Object3D[], center: [x,y,z] world, length, width, bow: [x,z] world direction, buoyancy?: 0..1 } */
  function setFloaters(list) {
    disposeFloaters();
    const anyHero = (list || []).some((s) => s.hero);
    const ordered = (list || []).filter((s) => s.objects && s.objects.some(Boolean)).sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0));
    ordered.slice(0, NEM).forEach((s, idx) => {
      const objs = (s.objects || []).filter(Boolean);
      if (!objs.length) return;
      const rig = new THREE.Group();                 /* only carries the sea-motion matrix; it is never part of the scene */
      rig.matrixAutoUpdate = false;
      const tops = objs.filter((o) => o.parent);
      if (!tops.length) return;
      tops.forEach((o) => o.updateWorldMatrix(true, false));
      const bl = Math.hypot(s.bow ? s.bow[0] : 0, s.bow ? s.bow[1] : 1) || 1;
      const sc = area.scale;
      const f = {
        rig, tops, name: s.name || '',
        pivot: new THREE.Vector3().fromArray(s.center || [0, 0, 0]),
        len: (s.length || 6) / sc, wid: (s.width || 2) / sc,
        bow: [(s.bow ? s.bow[0] : 0) / bl, (s.bow ? s.bow[1] : 1) / bl],
        buoy: s.buoyancy == null ? 1 : s.buoyancy, sprayK: s.spray == null ? 1 : s.spray,
        x: 0, z: 0, fx: 0, fz: 1, hl: 0, hw: 0, heave: 0, pitch: 0, roll: 0, spd: 0, lastX: null, lastZ: null,
        hero: !!s.hero || (!anyHero && idx === 0), hullSrc: s.hull || null, hull: null, heaveVel: 0, pitchVel: 0, sprayAcc: 0,
      };
      /* animated boats: remember where the parts and their original parent started, so a model animation that moves
         them (a travelling boat, a turning boat) carries the pivot, heading and hull outline along */
      f.pc = f.pivot.clone(); f.bc = [f.bow[0], f.bow[1]];
      f.parent = tops[0].parent;
      f.trk = tops[0];
      /* the part's own world matrix (without the sea motion) at the moment of setup, to see later how far its model animation moved it */
      f.parent.updateWorldMatrix(true, false); f.trk.updateMatrix();
      f.restInv = new THREE.Matrix4().multiplyMatrices(f.parent.matrixWorld, f.trk.matrix).invert();
      f.hl = f.len * 0.532; f.hw = f.wid * 0.567;
      tops.forEach((o) => hookPart(o, rig.matrix));
      floaters.push(f);
      wetApply(f);
    });
    rebuildHulls();
  }
  let heroFlow = 0, heroScroll = 0, heroBowA = 0;
  const _mD = new THREE.Matrix4(), _mE = new THREE.Matrix4(), _pc = new THREE.Vector3(), _bd = new THREE.Vector3();
  /* outline preview: the detected waterline drawn on the water, so what the viewer sees can be checked by eye */
  const OUT = { on: false, obj: null, built: -1 };
  function outlineUpdate() {
    const f = floaters[0];
    const want = OUT.on && f && f.hero && f.hull && f.hull.segW.length;
    if (!want) { if (OUT.obj) OUT.obj.visible = false; return; }
    if (!OUT.obj) {
      const g = new THREE.BufferGeometry();
      const m = new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false, transparent: true });
      OUT.obj = new THREE.LineSegments(g, m); OUT.obj.renderOrder = 40; OUT.obj.frustumCulled = false; OUT.obj.name = 'PONK_OCEAN_HULL_OUTLINE';
      OUT.obj.matrixAutoUpdate = false; root.add(OUT.obj);
    }
    if (OUT.built !== f.hull.built) {
      const a = new Float32Array(f.hull.segW.length * 6);
      f.hull.segW.forEach((g, k) => { a[k * 6] = g[0]; a[k * 6 + 2] = g[1]; a[k * 6 + 3] = g[2]; a[k * 6 + 5] = g[3]; });
      OUT.obj.geometry.setAttribute('position', new THREE.BufferAttribute(a, 3));
      OUT.built = f.hull.built;
    }
    const sc = area.scale, fw = _v1.set(f.fx * sc, 0, f.fz * sc), rt = _v2.set(-f.fz * sc, 0, f.fx * sc);
    OUT.obj.matrix.makeBasis(fw, _v3.set(0, 1, 0), rt);
    OUT.obj.matrix.setPosition(area.center[0] + f.x * sc, area.center[1] + L.hullLevel + 0.08, area.center[2] + f.z * sc);
    OUT.obj.matrixWorldNeedsUpdate = true; OUT.obj.visible = true;
  }
  function floaterUpdate(dt) {
    const sc = area.scale;
    const k = Math.min(1, dt * 6);
    for (const f of floaters) {
      if (f.hero && L.trackParts && f.trk) {
        /* where the model's own animation has taken the part since the setup, in world space (without the sea motion) */
        f.parent.updateWorldMatrix(true, false);
        if (f.trk.matrixAutoUpdate) f.trk.updateMatrix();
        const Dt = _mE.multiplyMatrices(f.parent.matrixWorld, f.trk.matrix).multiply(f.restInv);
        f.pc.copy(f.pivot).applyMatrix4(Dt);
        _bd.set(f.bow[0], 0, f.bow[1]).transformDirection(Dt);
        const bl = Math.hypot(_bd.x, _bd.z) || 1; f.bc[0] = _bd.x / bl; f.bc[1] = _bd.z / bl;
      } else { f.pc.copy(f.pivot); f.bc[0] = f.bow[0]; f.bc[1] = f.bow[1]; }
      const lx = (f.pc.x - area.center[0]) / sc, lz = (f.pc.z - area.center[2]) / sc;
      f.x = lx; f.z = lz; f.fx = f.bc[0]; f.fz = f.bc[1];
      if (f.lastX != null && dt > 0) {
        const v = Math.hypot(lx - f.lastX, lz - f.lastZ) / dt;
        f.spd += (clamp(v, 0, 30) - f.spd) * Math.min(1, dt * 2);
      }
      f.lastX = lx; f.lastZ = lz;
      if (f.hero && L.boatCruise) f.spd = L.boatSpeed / sc;       /* held in place, but under way: the water does the moving */
      const bobK = f.hero ? L.boatBob : 1, tiltK = f.hero ? L.boatTilt : 1;
      const rx = -f.fz, rz = f.fx;
      const a = f.len * 0.4, b = f.wid * 0.47;
      const h = [[0, 0], [a, 0], [-a, 0], [0, b], [0, -b]].map((p) => cpuHeight(lx + f.fx * p[0] + rx * p[1], lz + f.fz * p[0] + rz * p[1]));
      const heave = (h[0] * 2 + h[1] + h[2] + h[3] + h[4]) / 6;
      const pitch = Math.atan2(h[1] - h[2], 2 * a);
      const roll = -Math.atan2(h[3] - h[4], 2 * b);
      const h0 = f.heave, p0 = f.pitch;
      f.heave += (heave * f.buoy * bobK - f.heave) * k;
      f.pitch += (clamp(pitch, -0.5, 0.5) * f.buoy * tiltK - f.pitch) * k;
      f.roll += (clamp(roll, -0.5, 0.5) * f.buoy * tiltK - f.roll) * k;
      /* where the water plane sits relative to the boat: the water is at 'heave' and tilted like the sea under it,
         the boat is at its (scaled) heave and tilt. With Bob and Tilt at 100% they agree and nothing changes. */
      f.natHeave = heave; f.natPitch = clamp(pitch, -0.5, 0.5); f.natRoll = clamp(roll, -0.5, 0.5);
      {
        /* the water plane under this boat, in world coordinates: y = A + Gx*x + Gz*z (used by the wet-hull look and the mirror level) */
        const su = (h[1] - h[2]) / (2 * a), sv = (h[3] - h[4]) / (2 * b), kk = 1 / sc;
        const cxs = area.center[0] * kk + f.x, czs = area.center[2] * kk + f.z;
        const Gx = su * f.fx + sv * rx, Gz = su * f.fz + sv * rz;
        const A0 = area.center[1] + sc * heave - sc * (su * (f.fx * cxs + f.fz * czs) + sv * (rx * cxs + rz * czs));
        f.wfit = { y0: A0 + Gx * f.pc.x + Gz * f.pc.z };
        if (f.wetU) {
          f.wetU.uWet.value.set(A0, Gx, Gz, Math.max(L.wetHeight, 0.02));
          f.wetU.uWet2.value.set(clamp(L.wetHull, 0, 1), wallTime, 0.04 + 0.10 * (f.rbMotion || 0), 1.0);
        }
      }
      f.heaveVel += ((f.heave - h0) / Math.max(dt, 1e-3) - f.heaveVel) * Math.min(1, dt * 8);
      f.pitchVel += ((f.pitch - p0) / Math.max(dt, 1e-3) - f.pitchVel) * Math.min(1, dt * 8);
      f.rbMotion = (f.rbMotion || 0) + (clamp(Math.abs(f.heaveVel) * 0.9 + Math.abs(f.pitchVel) * 4, 0, 1) - (f.rbMotion || 0)) * Math.min(1, dt * 3);
      /* world axes of the hull: forward (bow), and the starboard axis f x up */
      _v1.set(f.fx, 0, f.fz);                       /* forward */
      _v2.set(0, 1, 0).cross(_v1).multiplyScalar(-1).normalize();   /* f x up = starboard */
      _q1.setFromAxisAngle(_v2, f.pitch);
      _q2.setFromAxisAngle(_v1, f.roll);
      _q1.multiply(_q2);
      _mR.makeRotationFromQuaternion(_q1);
      _mT.makeTranslation(f.pc.x, f.pc.y + f.heave * sc, f.pc.z);
      _mP.makeTranslation(-f.pc.x, -f.pc.y, -f.pc.z);
      f.rig.matrix.copy(_mT).multiply(_mR).multiply(_mP);
      if (f.hero && f.hullSrc && f.hull && L.hullShape) {
        const rel = { dy: f.natHeave - f.heave, su: Math.tan(f.natPitch) - Math.tan(f.pitch), sv: -(Math.tan(f.natRoll) - Math.tan(f.roll)) };
        /* The waterline outline is rebuilt as the boat bobs and tilts, about 30 times a second at most. It is built a few
           milliseconds ahead of the motion (rate of change x lead) so that, when it shows, it matches the hull. */
        const pr = f.relPrev || (f.relPrev = { dy: rel.dy, su: rel.su, sv: rel.sv, v: { dy: 0, su: 0, sv: 0 } });
        const kv = Math.min(1, dt * 12), idt = 1 / Math.max(dt, 1e-3);
        pr.v.dy += ((rel.dy - pr.dy) * idt - pr.v.dy) * kv; pr.v.su += ((rel.su - pr.su) * idt - pr.v.su) * kv; pr.v.sv += ((rel.sv - pr.sv) * idt - pr.v.sv) * kv;
        pr.dy = rel.dy; pr.su = rel.su; pr.sv = rel.sv;
        const last = f.hull.rel, now = performance.now();
        const moved = Math.abs(rel.dy - last.dy) > 0.008 || Math.abs(rel.su - last.su) > 0.003 || Math.abs(rel.sv - last.sv) > 0.003;
        if (moved && now - f.hull.built > Math.max(33, f.hull.ms * 3)) {
          const lead = 0.04;
          f.hullRel = { dy: rel.dy + pr.v.dy * lead, su: rel.su + pr.v.su * lead, sv: rel.sv + pr.v.sv * lead };
          rebuildHulls();
        }
      }
    }
    /* water flowing past the held boat: the wave pattern slides toward the stern (the foam trail follows in the wake pass) */
    const hero = floaters[0];
    heroFlow = (hero && hero.hero && L.boatCruise) ? L.boatSpeed / sc : 0;
    if (hero && heroFlow > 0) { DR[0] += hero.fx * heroFlow * dt; DR[1] += hero.fz * heroFlow * dt; }
    heroScroll += (hero ? (L.boatCruise ? heroFlow : hero.spd) : 0) * dt;
    U.uDrift.value.set(DR[0], DR[1]);
    if (hero && hero.hull && L.hullShape) {
      U.uHullTex.value = hero.hull.tex;
      U.uHullBox.value.set(hero.hull.box[0], hero.hull.box[1], hero.hull.box[2], hero.hull.box[3]);
      U.uHullEm.value.set(hero.x, hero.z, hero.fx, hero.fz);
      U.uHullP.value.set(1, L.hullCut ? 1 : 0, clamp(hero.spd / 4, 0, 1), 0);
      /* the water the boat pushes up: bigger with speed (about v squared) and with boat length; can be switched off with the checkbox */
      const vms = (L.boatCruise ? L.boatSpeed : hero.spd * sc), lenK = Math.sqrt(Math.max(hero.hull.extent[0], 2) / 12);
      const bowOn = L.bowWave && hero.hull.segW.length > 2;
      const bowA = bowOn ? clamp(0.010 * vms * vms * lenK, 0, 0.85) * L.bowWaveAmt * sstep(0.6, 2.5, vms) / sc : 0;
      U.uReb.value.set(clamp(L.hullRebound, 0, 2), hero.rbMotion || 0, SIM.sigma, wallTime);
      U.uHullH.value.set(hero.hull.topH || 1, clamp(L.boatShadow, 0, 1), clamp(L.waterlineDark, 0, 1), 0);
      U.uHullS.value.set(heroScroll, bowOn ? 1 : 0, vms / sc, clamp(L.hullRing == null ? 1 : L.hullRing, 0, 6));
      U.uBow.value.set(hero.hull.urange[1], hero.hull.urange[0], hero.hull.extent[1] * 0.5, bowA);
      heroBowA = bowA;
    } else { U.uHullH.value.set(0, 0, 0, 0); U.uReb.value.set(0, 0, 1, wallTime); U.uHullP.value.set(0, 0, 0, 0); U.uHullS.value.set(heroScroll, 0, 0, 1); U.uBow.value.set(0, 0, 0, 0); heroBowA = 0; }
  }

  /* ================================================================ look === */
  const waterLin = [0, 0, 0], foamLin = [0, 0, 0];
  let sunLight = opts.sunLight || null;
  let dirtyLens = false, dirtyBathy = false, dirtySun = false, dirtyQuality = false, dirtyHull = false;
  function applyLook(changed) {
    const keys = changed ? Object.keys(changed) : Object.keys(L);
    const has = (k) => keys.indexOf(k) >= 0;
    SIM.mul = clamp(L.waves, 0.3, 14);
    SIM.ampK = clamp(L.waveAmp == null ? 1 : L.waveAmp, 0, 3);
    SIM.lambda = L.chop * 1.55 / Math.pow(Math.max(1, SIM.ampK), 0.5);   /* taller waves get a little less sideways push so the crests do not fold over */
    SIM.lambdaF = 0.55 + 0.95 * L.chop;
    SIM.foamAmt = L.foam;
    SIM.wind = L.wind;
    SIM.U = windToU(L.wind);
    if (has('windDir') || !changed) {
      const a = L.windDir * Math.PI / 180;
      WDIR[0] = Math.cos(a); WDIR[1] = Math.sin(a);
      U.uWdir.value.set(WDIR[0], WDIR[1]);
      if (changed) dirtyLens = true;
    }
    recalcAmp();
    if (Q) buildModes();
    if (has('sunAz') || has('sunEl') || !changed) dirtySun = true;
    if (has('quality') && changed) dirtyQuality = true;
    if ((has('hullLevel') || has('hullRes')) && changed) dirtyHull = true;
    if (has('hullRing') && changed) {
      const q = Math.max(1, Math.ceil(clamp(L.hullRing, 0, 6) * 2) / 2);
      if (q !== ringQLast) { ringQLast = q; dirtyHull = true; }
    }
    if (has('seaRadius') && changed) dirtyQuality = true;
    const w = hexLin(L.waterColor), f = hexLin(L.foamTint);
    SU.uWaterCol.value.set(w[0], w[1], w[2]); SU.uFoamCol.value.set(f[0], f[1], f[2]);
    U.uDeepCol.value.set(w[0] * 0.22, w[1] * 0.22, w[2] * 0.22 + 0.01);
    if (has('waterColor') && changed) dirtySun = true;       /* the baked fallback sky carries the deep colour below the horizon */
    { const sm = (s) => { s = clamp(s, 0, 1); return s < 0.5 ? mix(0.015, 0.14, s * 2) : mix(0.14, 0.46, (s - 0.5) * 2); }; const hs = clamp(L.hullHoleSoft, 0, 1); SU.uFoamSoft.value.set(sm(L.foamSoftness), sm(L.hullFoamSoftness), clamp(L.hullFoamSoftness, 0, 1), hs < 0.5 ? mix(0.012, 0.07, hs * 2) : mix(0.07, 0.32, (hs - 0.5) * 2)); }
    SU.uFoamOp.value.set(Math.pow(clamp(L.foamOpacity, 0, 1), 1.5), Math.pow(clamp(L.hullFoamOpacity, 0, 1), 1.5), clamp(L.hullRingHoles, 0, 1));   /* power curve so the middle of the slider reads as half-transparent */ SU.uTransp.value = L.transp; SU.uFoamAmt.value = L.foam; SU.uWindN.value = L.wind;
    SU.uFogDist.value = L.fogDist; SU.uGlint.value = L.glint;
    if (/^#/.test(L.horizon || '')) { const c = hexLin(L.horizon); SU.uFogCol.value.set(c[0], c[1], c[2]); SU.uFogMode.value = 1; } else SU.uFogMode.value = 0;
    sprayU.uSunDir = U.uSunDir;
  }
  function updateSun() {
    if (sunLight) {
      const d = new THREE.Vector3().subVectors(sunLight.getWorldPosition(new THREE.Vector3()), sunLight.target.getWorldPosition(new THREE.Vector3())).normalize();
      U.uSunDir.value.copy(d);
    } else {
      const el = L.sunEl * Math.PI / 180, az = L.sunAz * Math.PI / 180;
      U.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    }
  }

  /* ---------- mirror image of the scene (boat, islands) at the water level ---------- */
  const RFL = { rt: null, raw: null, cam: null, w: 0, h: 0, n: 0, ms: 0, py: 0, off: false, fail: 0, glass: [], gn: -999 };
  const glassMat = (m) => Array.isArray(m) ? m.some(glassMat) : !!(m && m.transmission > 0);
  /* every see-through (transmissive) mesh outside the ocean: left out of the mirror image unless asked for */
  function glassScan() {
    RFL.glass.length = 0;
    scene.traverse((o) => { if (o.isMesh && o !== root && glassMat(o.material)) { for (let p = o; p; p = p.parent) if (p === root) return; RFL.glass.push(o); } });
  }
  const _rN = new THREE.Vector3(0, 1, 0), _rP = new THREE.Vector3(), _rC = new THREE.Vector3(), _rV = new THREE.Vector3(), _rL = new THREE.Vector3(), _rT = new THREE.Vector3(), _rU = new THREE.Vector3();
  const _rM = new THREE.Matrix4(), _rS = new THREE.Vector2(), _rCol = new THREE.Color(), _rPl = new THREE.Plane(), _rQ = new THREE.Vector4(), _rK = new THREE.Vector4();
  function reflectUpdate() {
    const P = SU.uReflP.value;
    const want = L.reflectBoat && L.reflectAmt > 0.001 && camera && (floaters.length || islandOn);
    if (!want) { P.x = 0; return; }
    camera.updateMatrixWorld();
    camera.getWorldPosition(_rC);
    const hero = floaters[0];
    const planeY = hero && hero.wfit ? hero.wfit.y0 : area.center[1];
    /* off when the eye is at the water, back on only a little above it: no flicker as the waves pass the camera */
    RFL.off = RFL.off ? (_rC.y <= planeY + 0.25) : (_rC.y <= planeY + 0.02);
    if (RFL.off || RFL.fail >= 3) { P.x = 0; return; }
    const qi = Q ? Q.qi : 1;
    RFL.n++;
    if (RFL.rt && (RFL.n % [3, 2, 1][qi]) !== 0) { P.set(1, RFL.py, L.reflectAmt, 0.05); return; }
    const t0 = performance.now();
    renderer.getDrawingBufferSize(_rS);
    const rs = [0.35, 0.5, 0.6][qi];
    const w = clamp(Math.round(_rS.x * rs), 64, 1536), h = clamp(Math.round(_rS.y * rs), 64, 1536);
    /* the targets are only rebuilt for a real change of size (a window resize), not for every quality step */
    if (!RFL.rt || Math.abs(w - RFL.w) > RFL.w * 0.25 || Math.abs(h - RFL.h) > RFL.h * 0.25) {
      if (RFL.rt) RFL.rt.dispose();
      if (RFL.raw) RFL.raw.dispose();
      /* the scene is drawn into `raw`, then copied through a sanitising pass into `rt`, which builds the mipmaps the sea samples */
      RFL.raw = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      RFL.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      RFL.w = w; RFL.h = h;
      SU.uReflTex.value = RFL.rt.texture;
    }
    if (!RFL.cam) RFL.cam = new THREE.PerspectiveCamera();
    const vc = RFL.cam;
    /* the camera as seen in a mirror lying on the water (the same construction as three's Reflector) */
    _rP.set(0, planeY, 0);
    _rV.subVectors(_rP, _rC).reflect(_rN).negate().add(_rP);
    _rM.extractRotation(camera.matrixWorld);
    _rL.set(0, 0, -1).applyMatrix4(_rM).add(_rC);
    _rT.subVectors(_rP, _rL).reflect(_rN).negate().add(_rP);
    vc.position.copy(_rV);
    _rU.set(0, 1, 0).applyMatrix4(_rM).reflect(_rN);
    vc.up.copy(_rU);
    vc.lookAt(_rT);
    vc.near = camera.near; vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    vc.layers.mask = camera.layers.mask;
    const tm = SU.uReflMat.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(vc.projectionMatrix); tm.multiply(vc.matrixWorldInverse);
    /* clip everything below the water so the underwater part of the hull is not mirrored */
    _rPl.setFromNormalAndCoplanarPoint(_rN, _rP); _rPl.applyMatrix4(vc.matrixWorldInverse);
    _rK.set(_rPl.normal.x, _rPl.normal.y, _rPl.normal.z, _rPl.constant);
    const pm = vc.projectionMatrix, e = pm.elements;
    _rQ.x = (Math.sign(_rK.x) + e[8]) / e[0]; _rQ.y = (Math.sign(_rK.y) + e[9]) / e[5]; _rQ.z = -1; _rQ.w = (1 + e[10]) / e[14];
    _rK.multiplyScalar(2 / _rK.dot(_rQ));
    e[2] = _rK.x; e[6] = _rK.y; e[10] = _rK.z + 1 - 0.003; e[14] = _rK.w;
    /* draw it: everything except the ocean itself, into a transparent half-size target */
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevBg = scene.background, prevA = renderer.getClearAlpha();
    renderer.getClearColor(_rCol);
    const prevSh = renderer.shadowMap.autoUpdate, prevXR = renderer.xr.enabled, prevRoot = root.visible, prevOut = OUT.obj ? OUT.obj.visible : false;
    const prevNeed = renderer.shadowMap.needsUpdate;
    root.visible = false; if (OUT.obj) OUT.obj.visible = false;
    scene.background = null; renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false; renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(RFL.raw);
    const hid = [];
    if (!L.reflectGlass) {
      if (RFL.n - RFL.gn >= 32 || RFL.n < RFL.gn) { RFL.gn = RFL.n; glassScan(); }
      for (let i = 0; i < RFL.glass.length; i++) { const g = RFL.glass[i]; if (g.visible) { g.visible = false; hid.push(g); } }
    }
    let okR = true;
    try { renderer.render(scene, vc); } catch (e) { okR = false; if (++RFL.fail === 1) console.warn('[ocean] mirror image failed:', e); } finally {
      for (let i = 0; i < hid.length; i++) hid[i].visible = true;
      renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; scene.background = prevBg; renderer.setClearColor(_rCol, prevA);
      renderer.shadowMap.autoUpdate = prevSh; renderer.shadowMap.needsUpdate = prevNeed; renderer.xr.enabled = prevXR; root.visible = prevRoot; if (OUT.obj) OUT.obj.visible = prevOut;
    }
    if (!okR) { P.x = 0; return; }
    RFL.fail = 0;
    /* sanitise (no infinite / NaN values may reach the mipmaps), straight into the mipmapped target */
    M.san.uniforms.uSrc.value = RFL.raw.texture;
    const prevAuto2 = renderer.autoClear;
    renderer.autoClear = false;
    try { runPass(M.san, RFL.rt); } finally { renderer.autoClear = prevAuto2; renderer.setRenderTarget(prevRT); }
    RFL.py = planeY;
    P.set(1, planeY, L.reflectAmt, 0.05);
    RFL.ms = performance.now() - t0;
  }

  /* ================================================================ frame === */
  const _tgt = new THREE.Vector3(), _fw = new THREE.Vector3();
  function waterFocus(camera) {
    camera.getWorldPosition(_tgt);
    camera.getWorldDirection(_fw);
    let t = 40 * area.scale;
    if (_fw.y < -0.02) t = clamp((area.center[1] - _tgt.y) / _fw.y, 0, 160 * area.scale);
    return [(_tgt.x + _fw.x * t - area.center[0]) / area.scale, (_tgt.z + _fw.z * t - area.center[2]) / area.scale];
  }
  function applyArea() {
    root.position.set(area.center[0], area.center[1], area.center[2]);
    root.scale.setScalar(area.scale);
    root.updateMatrixWorld(true);
  }
  function rebuildAll() {
    bakeBathymetry();
    buildLens();
  }

  function update(dt) {
    if (disposed || !enabled) return;
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    stats.passes = 0;
    if (dirtyQuality) { dirtyQuality = false; buildQuality(clamp(L.quality | 0, 0, 2)); dirtyBathy = true; }
    if (dirtyBathy) { dirtyBathy = false; rebuildAll(); dirtyLens = false; dirtyHull = true; }
    if (dirtyHull) { dirtyHull = false; rebuildHulls(); }
    if (dirtyLens) { dirtyLens = false; buildLens(); }
    if (dirtySun) { dirtySun = false; updateSun(); procKey = ''; }
    else if (sunLight) updateSun();
    refreshEnv();
    const ambDir = 0.45;
    sprayU.uAmbL.value = ambDir;
    if (!paused) { wallTime += dt; SIM.simT += dt * Math.sqrt(SIM.mul) * L.speed; }
    U.uTime.value = wallTime;
    root.updateMatrixWorld(true);
    beginPasses();
    try {
      cpuPrep();
      if (!paused) floaterUpdate(dt);
      stepOcean(dt);
      if (!paused) stepWake(dt);
    } finally { endPasses(); }
    if (!paused) if (camera) sprayUpdate(dt, waterFocus(camera)); else sprayUpdate(dt, [0, 0]);
    outlineUpdate();
    if (wetLast !== !!L.wetOn) { wetLast = !!L.wetOn; if (wetLast) floaters.forEach(wetApply); else floaters.forEach((f) => wetEach(f, wetRelease)); }
    else if (wetLast && (++wetTick & 15) === 0) floaters.forEach(wetApply);     /* materials swapped by the host get the wet look again, within a second */
    reflectUpdate();
    SU.uD0.value = Q.cas[0].D.texture; SU.uD1.value = Q.cas[1].D.texture; SU.uD2.value = Q.cas[2].D.texture;
    SU.uS0.value = Q.cas[0].S0.texture; SU.uS1.value = Q.cas[1].S0.texture; SU.uS2.value = Q.cas[2].S0.texture;
    SU.uWake.value = Q.wk0.texture;
    const c = Q.cas;
    SU.uInvL.value.set(SIM.mul / c[0].L, SIM.mul / c[1].L, SIM.mul / c[2].L);
    SU.uOff.value.set(0.5 / c[0].N, 0.5 / c[1].N, 0.5 / c[2].N);
    SU.uTexPerM.value.set(SIM.mul / c[0].L * c[0].N, SIM.mul / c[1].L * c[1].N, SIM.mul / c[2].L * c[2].N);
    SU.uLambda.value = SIM.lambda; SU.uMulInv.value = 1 / SIM.mul; SU.uAmpRef.value = SIM.ampRef;
    SU.uFW.value.set(c[0].fw, c[1].fw, c[2].fw);
    stats.ms = (typeof performance !== 'undefined') ? performance.now() - t0 : 0;
  }

  /* ============================================================== public === */
  function init() {
    applyArea();
    applyLook();
    updateSun();
    scene.add(root);
    buildQuality(clamp(L.quality | 0, 0, 2));
    refreshEnv();
    rebuildAll();
    for (let i = 0; i < 3; i++) { beginPasses(); try { cpuPrep(); stepOcean(0.016); } finally { endPasses(); } }
  }
  const api = {
    version: OCEAN_VERSION,
    root,
    get surface() { return seaMesh; },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; root.visible = enabled; },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
    get look() { return L; },
    getLook() { return JSON.parse(JSON.stringify(L)); },
    setLook(partial) {
      const ch = {};
      Object.keys(partial || {}).forEach((k) => { if (k in L && L[k] !== partial[k]) { L[k] = partial[k]; ch[k] = true; } });
      if (Object.keys(ch).length) applyLook(ch);
    },
    setArea(a) {
      if (a.center) area.center = a.center.slice();
      if (a.size) area.size = a.size.slice();
      if (a.scale) area.scale = a.scale;
      applyArea();
      dirtyBathy = true;
    },
    getArea() { return JSON.parse(JSON.stringify(area)); },
    /* the hero boat's detected waterline (or null): outline point count, size and signed-distance map size */
    hullInfo() { const f = floaters[0]; if (!f || !f.hull) return null; return { points: f.hull.pts.u.length, length: f.hull.extent[0] * area.scale, width: f.hull.extent[1] * area.scale, tex: [f.hull.size[0], f.hull.size[1]], texelCm: f.hull.texel * area.scale * 100, meshes: f.hull.meshes, buildMs: f.hull.ms, box: f.hull.box.slice(), segments: f.hull.segW.length }; },
    /* static solid ground: [{ meshes: Object3D[], proxies: [{ positions, indices }] }] */
    setColliders(list) { colliderSrc = list || []; demoIslands = null; dirtyBathy = true; },
    /* analytic demo islands for previews */
    setDemoIslands(on) {
      demoIslands = on ? (Array.isArray(on) ? on : [
        { x: 0, z: 0, R: 36, peak: 13, s: [0.7, 2.1, 4.2, 1.3] },
        { x: 66, z: -38, R: 9, peak: 4.5, s: [1.9, 0.4, 3.3, 2.2] },
        { x: -60, z: 58, R: 12, peak: 6, s: [3.1, 1.2, 0.6, 4.0] },
      ]) : null;
      dirtyBathy = true;
    },
    rebuild() { dirtyBathy = true; },
    setFloaters,
    setOutline(on) { OUT.on = !!on; if (!OUT.on && OUT.obj) OUT.obj.visible = false; },
    setCamera(c) { camera = c; },
    setSunLight(l) { sunLight = l || null; dirtySun = true; },
    update,
    requiredFar() { return L.seaRadius * 2.4 * area.scale; },
    /* world-space surface height under a world position */
    heightAt(x, z) { return area.center[1] + area.scale * cpuHeight((x - area.center[0]) / area.scale, (z - area.center[2]) / area.scale); },
    groundAt(x, z) { return area.center[1] + area.scale * terrainT((x - area.center[0]) / area.scale, (z - area.center[2]) / area.scale); },
    stats() { return { passes: stats.passes, ms: stats.ms, hs: 4 * SIM.sigma * area.scale, quality: QUALITY[Q.qi].name, mesh: Q.meshN, bathy: BATHY ? BATHY.res : 0, floaters: floaters.length, spray: SPR.n, reflMs: RFL.ms, reflSize: [RFL.w, RFL.h] }; },
    debug: { SIM, WDIR, DR, U, get Q() { return Q; }, get BATHY() { return BATHY; }, get LENS() { return LENS; }, M, U, SU, cpuHeight, terrainT, get floaters() { return floaters; }, stepOcean, stepWake, beginPasses, endPasses, runPass },
    dispose() {
      disposed = true;
      disposeFloaters();
      scene.remove(root);
      freeQuality();
      if (seaMesh) seaMesh.geometry.dispose();
      if (SPR.geo) SPR.geo.dispose();
      [seaMat, SPR.mat, domeMat, ...Object.values(M)].forEach((m) => m && m.dispose());
      if (BATHY && BATHY.tex) BATHY.tex.dispose();
      if (LENS && LENS.tex) LENS.tex.dispose();
      if (lensRT) lensRT.dispose();
      if (RFL.rt) RFL.rt.dispose();
      if (RFL.raw) RFL.raw.dispose();
      if (procEnv) procEnv.dispose();
      pmrem.dispose();
      quadGeo.dispose();
    },
  };
  init();
  return api;
}

/* ====================================================================================================================
 * Viewer glue: reads the "ocean" block of config.json (written by the Blender add-on), finds the artist's parts in the
 * loaded model by name, hands the helper proxies to the simulation, and, when the page is served by the add-on's Ocean
 * Tuner, mounts the slider panel whose "Lock Look" button stores the look in the .blend.
 * ================================================================================================================== */
const _num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);


/* A simple test hull, bow toward +Z, +Y up, origin at the waterline centre. 'box' is a plain box; 'boat' has a pointed bow,
   a narrower keel and a transom, so the waterline outline is a real boat shape. Returns { p: [x,y,z...], i: [a,b,c...] }. */
export function hullGeometry(kind, L, B, D) {
  if (kind === 'cat') {           /* twin hulls: two separate closed meshes with open water between them */
    const one = (dx) => { const h = hullGeometry('boat', L, B * 0.36, D); for (let k = 0; k < h.p.length; k += 3) h.p[k] += dx; return h; };
    return [one(-B * 0.36), one(B * 0.36)];
  }
  if (kind === 'fin') {           /* a boat hull plus a separate keel box that overlaps it and crosses the waterline */
    const a = hullGeometry('boat', L, B, D), b = hullGeometry('box', L * 0.34, B * 0.16, D * 1.7);
    return [a, b];
  }
  const P = [], I = [];
  const quad = (a, b, c, d) => { I.push(a, b, c, a, c, d); };
  if (kind === 'box') {
    const x = B / 2, y = D / 2, z = L / 2;
    [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].forEach((v) => P.push(...v));
    quad(0, 1, 2, 3); quad(5, 4, 7, 6); quad(4, 0, 3, 7); quad(1, 5, 6, 2); quad(3, 2, 6, 7); quad(4, 5, 1, 0);
    return { p: P, i: I };
  }
  const open = kind === 'open';     /* open-top boat: no deck on the proxy; 'vis' is the inside (liner, floor, rim) that only the picture needs */
  const n = 15, ring = 6;
  const sm = (a, b, t) => { t = Math.min(Math.max((t - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (let s = 0; s < n; s++) {
    const t = s / (n - 1);
    const w = (B / 2) * (t <= 0.5 ? 0.80 + 0.20 * sm(0, 0.35, t) : 1 - Math.pow((t - 0.5) / 0.5, 1.7));
    const kw = w * 0.34, z = (t - 0.5) * L, y0 = D / 2;
    P.push(-w, y0, z, -w * 0.97, 0, z, -kw, -y0, z, kw, -y0, z, w * 0.97, 0, z, w, y0, z);
  }
  for (let s = 0; s < n - 1; s++) {
    for (let r = 0; r < ring; r++) { const a = s * ring + r, b = s * ring + (r + 1) % ring, c = (s + 1) * ring + (r + 1) % ring, d = (s + 1) * ring + r; if (r < ring - 1) quad(a, b, c, d); }
    if (!open) { const a = s * ring + 5, b = s * ring, c = (s + 1) * ring, d = (s + 1) * ring + 5; quad(a, b, c, d); }    /* deck */
  }
  for (let r = 1; r < ring - 1; r++) I.push(0, r + 1, r);            /* transom */
  if (!open) return { p: P, i: I };
  /* the inside of the open boat: a liner a little inside the outer walls, a floor just BELOW the sea surface (so any water
     drawn inside the hull would show), a rim on top, and a cap at each end */
  const VP = [], VI = [], vq = (a, b, c, d) => { VI.push(a, b, c, a, c, d); };
  const tw = 0.16, fy = -0.2, y0 = D / 2, f0 = (0 - fy) / y0, S0 = 1, S1 = n - 3, rows = [];
  for (let s = S0; s <= S1; s++) {
    const t = s / (n - 1);
    const w = (B / 2) * (t <= 0.5 ? 0.80 + 0.20 * sm(0, 0.35, t) : 1 - Math.pow((t - 0.5) / 0.5, 1.7));
    const kw = w * 0.34, z = (t - 0.5) * L, wi = Math.max(w - tw, 0.05);
    const xm = (0.97 * w - f0 * (0.97 * w - kw)) * (wi / w);
    rows.push(VP.length / 3);
    VP.push(-wi, y0, z, -wi * 0.97, 0, z, -xm, fy, z, xm, fy, z, wi * 0.97, 0, z, wi, y0, z,      /* liner profile */
            -w, y0, z, w, y0, z);                                                                   /* outer top edge (for the rim) */
  }
  for (let q = 0; q < rows.length - 1; q++) {
    const a = rows[q], b = rows[q + 1];
    for (let r = 0; r < 5; r++) vq(a + r, a + r + 1, b + r + 1, b + r);                              /* liner and floor */
    vq(a, a + 6, b + 6, b); vq(a + 5, a + 7, b + 7, b + 5);                                          /* rims */
  }
  const cap = (a) => { vq(a, a + 1, a + 4, a + 5); vq(a + 1, a + 2, a + 3, a + 4); vq(a, a + 6, a + 7, a + 5); };
  cap(rows[0]); cap(rows[rows.length - 1]);
  return { p: P, i: I, vis: { p: VP, i: VI } };
}

function _hullSig(h) {
  if (!h) return 0;
  return [].concat(h).map((m) => (m && m.p ? m.p.length + ':' + m.p.slice(0, 12).join() + ':' + (m.i ? m.i.length : 0) : 0)).join('|');
}
function _areaOf(cfg) {
  const a = cfg && cfg.area;
  if (!a || !a.center || !a.size) return { center: [0, _num(cfg && cfg.level, 0), 0], size: [400, 400], scale: 1 };
  return { center: a.center.slice(0, 3), size: a.size.slice(0, 2), scale: _num(a.scale, 1) };
}
const _sigOf = (o) => { try { return JSON.stringify(o); } catch (e) { return String(Math.random()); } };

/* a node's descendants move with it, so a part whose ancestor is also listed must not be listed twice */
function _topmost(objs) {
  const set = new Set(objs);
  return objs.filter((o) => { for (let p = o.parent; p; p = p.parent) if (set.has(p)) return false; return true; });
}

export async function attachOcean(THREE, ctx) {
  const { renderer, scene, cam: camera, CFG } = ctx;
  const _find0 = ctx.findNode || ((n) => scene.getObjectByName(n));
  /* parts the floaters have taken into their rigs: the viewer's own search only looks under the model root, so without this a
     re-check (the tuner asks every 1.5 s) finds nothing, rebuilds with no boat, finds it again, and so on: ring and reflection on, off, on, off */
  const _held = new Map();
  const _inScene = (o) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
  const findNode = (n) => { const o = _find0(n); if (o) { _held.set(n, o); return o; } const c = _held.get(n); return c && _inScene(c) ? c : null; };
  const tuner = !!ctx.tuner;
  let cfg = (CFG && CFG.ocean) ? CFG.ocean : {};
  const look0 = Object.assign({}, cfg.look || {});
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  if (coarse && look0.quality == null) look0.quality = _num(cfg.mobile_quality, 0);
  const ocean = createOcean(THREE, { renderer, scene, camera, look: look0, area: _areaOf(cfg) });
  if (cfg.demo) ocean.setDemoIslands(true);
  const st = { sigCol: '', sigFlo: '', sigArea: _sigOf(_areaOf(cfg)), pending: true, t0: performance.now(), slow: 0, lockedLook: cfg.look ? JSON.parse(JSON.stringify(cfg.look)) : null, viz: null, vizOn: false, panel: null };

  /* ---------- helper data -> simulation ---------- */
  function proxiesOf(list) {
    return (list || []).map((p) => ({ positions: p.p, indices: p.i && p.i.length ? p.i : null }));
  }
  function applyHelpers(force) {
    if (lab.on) return true;
    let complete = true;
    const cols = (cfg.colliders || []).map((c) => {
      const names = c.parts || [];
      const meshes = names.map(findNode).filter(Boolean);
      if (meshes.length < names.length) complete = false;
      return { meshes: _topmost(meshes), proxies: proxiesOf(c.proxies) };
    });
    const sc = _sigOf([(cfg.colliders || []).map((c) => [c.parts, (c.proxies || []).map((p) => (p.p || []).length + ':' + (p.p || []).slice(0, 12).join())]), cols.map((c) => c.meshes.length)]);
    if (force || sc !== st.sigCol) {
      st.sigCol = sc;
      if (!cfg.demo) ocean.setColliders(cols.filter((c) => c.meshes.length || c.proxies.length));
    }
    const flo = (cfg.floaters || []).map((f) => {
      const names = f.parts || [];
      const objs = names.map(findNode).filter(Boolean);
      if (objs.length < names.length) complete = false;
      return { name: f.name, objects: _topmost(objs), center: f.center, length: f.length, width: f.width, bow: f.bow, buoyancy: f.buoyancy, spray: f.spray, hero: !!f.hero, hull: f.hull || null };
    });
    const sf = _sigOf([(cfg.floaters || []).map((f) => [f.name, f.parts, f.center, f.length, f.width, f.bow, f.buoyancy, f.spray, !!f.hero, _hullSig(f.hull)]), flo.map((f) => f.objects.length)]);
    if (force || sf !== st.sigFlo) {
      st.sigFlo = sf;
      ocean.setFloaters(flo.filter((f) => f.objects.length));
    }
    const a = _areaOf(cfg), sa = _sigOf(a);
    if (sa !== st.sigArea) { st.sigArea = sa; ocean.setArea(a); }
    if (tuner) refreshViz();
    return complete;
  }


  /* ---------- test lab: a box boat (hero), placeholder floaters and a box or rock island, for trying the water without a model ---------- */
  const lab = { on: false, hull: 'boat', island: 'box', placeholders: true, group: null, hidRoot: null, boat: null };
  function labClear() {
    if (!lab.group) return;
    scene.remove(lab.group);
    lab.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    lab.group = null; lab.boat = null;
  }
  function labBuild() {
    const A = ocean.getArea(), cx = A.center[0], cy = A.center[1], cz = A.center[2];
    const g = new THREE.Group(); g.name = 'PONK_OCEAN_LAB';
    const mat = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.5 : r });
    const L = 12.4, B = 3.6, D = 2.2;
    const hgs = [].concat(hullGeometry(lab.hull, L, B, D));
    const boat = new THREE.Group(); boat.name = 'Lab Yacht';
    const hm = mat(0xf2efe6, 0.4); hm.side = THREE.DoubleSide;
    hgs.forEach((hg, k) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(hg.p, 3)); geo.setIndex(hg.i); geo.computeVertexNormals();
      const hull = new THREE.Mesh(geo, k ? mat(0x8b97a0, 0.5) : hm); hull.name = 'Lab Hull ' + k; boat.add(hull);
      if (hg.vis) {
        const vg = new THREE.BufferGeometry();
        vg.setAttribute('position', new THREE.Float32BufferAttribute(hg.vis.p, 3)); vg.setIndex(hg.vis.i); vg.computeVertexNormals();
        const im = mat(0xb08a5a, 0.7); im.side = THREE.DoubleSide;
        const inner = new THREE.Mesh(vg, im); inner.name = 'Lab Hull Inside'; boat.add(inner);
      }
    });
    if (lab.hull !== 'open') { const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 4.0), mat(0xd9dde0)); cabin.name = 'Lab Cabin'; cabin.position.set(0, D / 2 + 0.45, -1); boat.add(cabin); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 12, 8), mat(0xcccccc)); mast.name = 'Lab Mast'; mast.position.set(0, D / 2 + 6, 1.5); boat.add(mast);
    boat.position.set(cx, cy, cz); g.add(boat);
    const hullData = hgs.map((hg) => { const hp = hg.p.slice(); for (let k = 0; k < hp.length; k += 3) { hp[k] += cx; hp[k + 1] += cy; hp[k + 2] += cz; } return { p: hp, i: hg.i }; });
    const floaters = [{ name: 'Lab Yacht', objects: [boat], center: [cx, cy, cz], length: L, width: B, bow: [0, 1], buoyancy: 1, spray: 1, hero: true, hull: hullData.length === 1 ? hullData[0] : hullData }];
    if (lab.placeholders) {
      const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.8, 14), mat(0xd9352b)); buoy.name = 'Lab Buoy'; buoy.position.set(cx + 26, cy + 0.3, cz + 14); g.add(buoy);
      const dinghy = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 4.6), mat(0xe9a23a)); dinghy.name = 'Lab Dinghy'; dinghy.position.set(cx - 24, cy + 0.1, cz + 22); g.add(dinghy);
      floaters.push({ name: 'Lab Buoy', objects: [buoy], center: [cx + 26, cy, cz + 14], length: 1.4, width: 1.4, bow: [0, 1], buoyancy: 1, spray: 0.4, hero: false });
      floaters.push({ name: 'Lab Dinghy', objects: [dinghy], center: [cx - 24, cy, cz + 22], length: 4.6, width: 2.2, bow: [0, 1], buoyancy: 1, spray: 0.5, hero: false });
    }
    let isl;
    if (lab.island === 'rock') {
      const pg = new THREE.PlaneGeometry(170, 170, 100, 100); pg.rotateX(-Math.PI / 2);
      const pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) { const r = Math.hypot(pp.getX(i), pp.getZ(i)); pp.setY(i, Math.max(-8, 9 * Math.exp(-r * r / (2 * 24 * 24)) - 3.2 + 0.8 * Math.sin(pp.getX(i) * 0.3) * Math.cos(pp.getZ(i) * 0.27) * Math.exp(-r * r / 1800))); }
      pg.computeVertexNormals();
      isl = new THREE.Mesh(pg, mat(0x7a8f5a, 1)); isl.position.set(cx - 70, cy, cz - 48);
    } else {
      isl = new THREE.Mesh(new THREE.BoxGeometry(46, 14, 34), mat(0x8a8f78, 1)); isl.position.set(cx - 70, cy + 3, cz - 48);
    }
    isl.name = 'Lab Island'; g.add(isl);
    scene.add(g); g.updateMatrixWorld(true);
    lab.group = g; lab.boat = boat;
    return { floaters, island: isl };
  }
  function labApply() {
    const rt = ctx.getRoot && ctx.getRoot();
    if (lab.on) {
      ocean.setFloaters([]); labClear();
      const b = labBuild();
      ocean.setColliders([{ meshes: [b.island], proxies: [] }]);
      ocean.setFloaters(b.floaters);
      if (rt && lab.hidRoot === null) { lab.hidRoot = rt.visible; rt.visible = false; }
      st.sigCol = ''; st.sigFlo = '';
    } else if (lab.group) {
      ocean.setFloaters([]); ocean.setColliders([]); labClear();
      if (rt && lab.hidRoot !== null) { rt.visible = lab.hidRoot; }
      lab.hidRoot = null;
      st.sigCol = ''; st.sigFlo = '';
      applyHelpers(true);
    }
  }
  function setLab(p) {
    const was = lab.on;
    Object.keys(p || {}).forEach((k) => { if (k in lab && k !== 'group') lab[k] = p[k]; });
    if (lab.on || was) labApply();
    if (tuner) refreshViz();
  }
  function labFrame() {
    if (!lab.boat) return;
    const bp = lab.boat.position;
    if (ctx.onFrame) { ctx.onFrame([bp.x, bp.y, bp.z]); return; }
    if (ctx.controls) {
      ctx.controls.target.set(bp.x, bp.y + 1, bp.z);
      camera.position.set(bp.x + 26, bp.y + 13, bp.z + 26);
      ctx.controls.update();
      if (ctx.requestRender) ctx.requestRender(800);
    }
  }

  /* ---------- tuner: helper preview lines ---------- */
  function refreshViz() {
    if (st.viz) { scene.remove(st.viz); st.viz.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); st.viz = null; }
    if (!st.vizOn) return;
    const g = new THREE.Group(); g.name = 'PONK_OCEAN_HELPERS';
    const line = (pts, color, loop) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
      const l = loop ? new THREE.LineLoop(geo, m) : new THREE.Line(geo, m);
      l.renderOrder = 999; l.frustumCulled = false; g.add(l); return l;
    };
    const a = _areaOf(cfg);
    const hx = a.size[0] / 2, hz = a.size[1] / 2, cy = a.center[1];
    line([[a.center[0] - hx, cy, a.center[2] - hz], [a.center[0] + hx, cy, a.center[2] - hz], [a.center[0] + hx, cy, a.center[2] + hz], [a.center[0] - hx, cy, a.center[2] + hz]], 0x3fb6ff, true);
    (cfg.floaters || []).forEach((f) => {
      const c = f.center || [0, 0, 0], L = (f.length || 6) / 2, W = (f.width || 2) / 2, b = f.bow || [0, 1];
      const bl = Math.hypot(b[0], b[1]) || 1, fx = b[0] / bl, fz = b[1] / bl, rx = -fz, rz = fx;
      const P = (u, v) => [c[0] + fx * u + rx * v, c[1], c[2] + fz * u + rz * v];
      line([P(L, W), P(L, -W), P(-L, -W), P(-L, W)], 0xffb02e, true);
      line([P(-L, 0), P(L, 0), P(L * 0.8, W * 0.5)], 0xffb02e, false);
    });
    (cfg.colliders || []).forEach((cl) => {
      (cl.proxies || []).forEach((p) => {
        const P = p.p || [], I = p.i && p.i.length ? p.i : null;
        const n = I ? I.length : P.length / 3, seg = [];
        for (let i = 0; i < n; i += 3) {
          const t = [0, 1, 2].map((k) => { const v = I ? I[i + k] : i + k; return new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); });
          seg.push(t[0], t[1], t[1], t[2], t[2], t[0]);
        }
        if (seg.length) {
          const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x6bff9a, transparent: true, opacity: 0.55, depthTest: false }));
          l.renderOrder = 998; l.frustumCulled = false; g.add(l);
        }
      });
    });
    scene.add(g); st.viz = g;
  }

  /* ---------- tuner: polling Blender for the current helpers ---------- */
  let pollTimer = 0;
  async function poll() {
    try {
      const r = await fetch(ctx.cfgUrl || '/__wce_ocean_cfg__', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const first = !st.polled; st.polled = true;
      cfg = Object.assign({}, cfg, j, { look: first ? (j.look || cfg.look) : cfg.look });
      if (first && j.look) { ocean.setLook(j.look); if (st.panel) st.panel.sync(j.look); }
      st.lockedLook = j.locked ? (j.look || null) : null;
      if (st.panel) st.panel.setLocked(!!j.locked);
      applyHelpers(false);
    } catch (e) { /* the add-on may be busy for a moment */ }
  }
  if (ctx.lab) setLab(typeof ctx.lab === 'object' ? Object.assign({ on: true }, ctx.lab) : { on: true });
  if (tuner) { poll(); pollTimer = setInterval(poll, 1500); }

  /* ---------- per frame ---------- */
  function tick(dt) {
    if (st.pending) {
      /* the model may still be loading: look for the named parts twice a second, for up to 90 s */
      const nowMs = performance.now();
      if (!st.started || nowMs >= st.nextTry) {
        st.nextTry = nowMs + 500;
        const done = applyHelpers(!st.started);
        st.started = true;
        if (done || nowMs - st.t0 > 90000) st.pending = false;
      }
    }
    const need = ocean.requiredFar();
    if (camera.far < need) { camera.far = need; camera.updateProjectionMatrix(); }
    ocean.update(dt);
    /* if the device cannot keep up, step the quality down once (never up) */
    if (!tuner && dt > 0.045) st.slow += dt; else st.slow = Math.max(0, st.slow - dt * 0.5);
    if (st.slow > 4 && ocean.look.quality > 0) { ocean.setLook({ quality: ocean.look.quality - 1 }); st.slow = 0; }
  }

  const handle = {
    ocean, tick, get config() { return cfg; }, lab, setLab, labFrame,
    setConfig(c) { cfg = c; applyHelpers(true); },
    dispose() { clearInterval(pollTimer); if (st.viz) scene.remove(st.viz); if (st.panel) st.panel.remove(); ocean.dispose(); },
  };
  if (tuner) {
    st.panel = mountTuner(ocean, {
      lockUrl: ctx.lockUrl || '/__wce_ocean_lock__',
      onViz(on) { st.vizOn = on; refreshViz(); },
      lab: { get state() { return lab; }, set: setLab, frame: labFrame },
      getLocked: () => st.lockedLook,
    });
  }
  return handle;
}

/* ====================================================================================================================
 * Tuner panel: every look slider, live. "Lock Look" posts the whole look to the add-on, which keeps it in the .blend
 * and bakes it into every export from then on.
 * ================================================================================================================== */
const _lg = (v) => 0.6 * Math.pow(10 / 0.6, v / 1000);
const _lgInv = (m) => Math.round(1000 * Math.log(m / 0.6) / Math.log(10 / 0.6));
const _TUNER_ROWS = [
  ['Sea', null],
  ['wind', 'Wind / sea state', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['waveAmp', 'Wave amplitude', 0, 3, 0.01, (v) => Math.round(v * 100) + '%'],
  ['waves', 'Wave size', 0, 1000, 1, (v) => '×' + _lg(v).toFixed(2), _lg, _lgInv],
  ['chop', 'Choppiness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['windDir', 'Wave direction', 0, 360, 1, (v) => Math.round(v) + '°'],
  ['speed', 'Time scale', 0, 2, 0.01, (v) => v.toFixed(2) + '×'],
  ['Look', null],
  ['transp', 'Transparency', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['foam', 'Foam amount', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['foamOpacity', 'Foam opacity', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['foamSoftness', 'Foam softness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['waterColor', 'Water colour', 'color'],
  ['foamTint', 'Foam tint', 'color'],
  ['reflect', 'Reflection', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['glint', 'Sun glitter', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['fogDist', 'Horizon haze', 150, 2000, 10, (v) => Math.round(v) + ' m'],
  ['Hero boat', null],
  ['boatSpeed', 'Speed', 0, 16, 0.1, (v) => v.toFixed(1) + ' m/s'],
  ['boatBob', 'Bob (up/down)', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['boatTilt', 'Tilt (pitch/roll)', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['boatSpray', 'Spray amount', 0, 3, 0.01, (v) => Math.round(v * 100) + '%'],
  ['reflectAmt', 'Boat reflection', 0, 3, 0.01, (v) => Math.round(v * 100) + '%'],
  ['boatShadow', 'Boat shadow on water', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['waterlineDark', 'Waterline darkening', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['wetHull', 'Wet hull', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['wetHeight', 'Wet band height', 0.02, 1.5, 0.01, (v) => v.toFixed(2) + ' m'],
  ['hullRing', 'Foam ring size', 0, 6, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullFoamOpacity', 'Foam ring opacity', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullFoamSoftness', 'Foam ring softness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullRingHoles', 'Foam ring holes', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullHoleSoft', 'Foam ring hole softness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullRebound', 'Water rebound', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['hullLevel', 'Waterline height', -1.5, 1.5, 0.01, (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' m'],
  ['hullRes', 'Hull detail', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ['bowWaveAmt', 'Bow wave size', 0, 2, 0.01, (v) => Math.round(v * 100) + '%'],
  ['@boatchecks'],
  ['Sun (only used when the scene has no HDRI / for glitter)', null],
  ['sunAz', 'Sun direction', 0, 360, 1, (v) => Math.round(v) + '°'],
  ['sunEl', 'Sun height', 0, 90, 1, (v) => Math.round(v) + '°'],
];

export function mountTuner(ocean, opt) {
  const css = document.createElement('style');
  css.textContent = `
#ponk-ocean-tuner{position:fixed;top:12px;right:12px;width:300px;max-height:calc(100vh - 24px);overflow:auto;z-index:2147483000;background:rgba(14,20,26,.88);color:#e8f1f5;border:1px solid rgba(255,255,255,.14);border-radius:10px;font:12px/1.35 system-ui,Segoe UI,Arial,sans-serif;backdrop-filter:blur(8px);box-shadow:0 8px 30px rgba(0,0,0,.45)}
#ponk-ocean-tuner h3{margin:0;padding:10px 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none}
#ponk-ocean-tuner .b{padding:0 12px 12px}
#ponk-ocean-tuner .sec{margin:10px 0 4px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55}
#ponk-ocean-tuner .r{display:grid;grid-template-columns:104px 1fr 54px;gap:8px;align-items:center;margin:5px 0}
#ponk-ocean-tuner .r span.v{text-align:right;opacity:.75;font-variant-numeric:tabular-nums}
#ponk-ocean-tuner input[type=range]{width:100%;accent-color:#3fb6ff}
#ponk-ocean-tuner input[type=color]{width:100%;height:22px;border:0;background:none;padding:0}
#ponk-ocean-tuner select,#ponk-ocean-tuner button{font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:5px 8px;cursor:pointer}
#ponk-ocean-tuner button:hover{background:rgba(255,255,255,.16)}
#ponk-ocean-tuner button.lock{background:#1a8fd6;border-color:#4cb6f2;font-weight:600}
#ponk-ocean-tuner .btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
#ponk-ocean-tuner .st{margin-top:8px;font-size:11px;opacity:.8}
#ponk-ocean-tuner .st.ok{color:#7be28f;opacity:1}
#ponk-ocean-tuner .st.err{color:#ff8f8f;opacity:1}
#ponk-ocean-tuner label.c{display:flex;gap:6px;align-items:center;margin:6px 0}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'ponk-ocean-tuner';
  el.innerHTML = '<h3><span>Ocean Tuner</span><span id="pot-fold">–</span></h3><div class="b"></div>';
  document.body.appendChild(el);
  const body = el.querySelector('.b');
  const look = ocean.look;
  const outs = {};
  _TUNER_ROWS.forEach((row) => {
    if (row[1] === null) { const s = document.createElement('div'); s.className = 'sec'; s.textContent = row[0]; body.appendChild(s); return; }
    if (row[0] === '@boatchecks') {
      [['boatCruise', 'Animate cruising (held in place, water flows past)'], ['hullShape', 'Use the real hull shape'], ['hullCut', 'Cut the water inside the hull'], ['bowWave', 'Real bow wave and wake (moves the water)'], ['reflectBoat', 'Mirror the boat and islands in the water'], ['reflectGlass', 'Show glass in that mirror image (slower)'], ['wetOn', 'Wet-hull material effect (off = materials untouched)'], ['trackParts', 'Follow animated parts']].forEach(([k, txt]) => {
        const lb = document.createElement('label'); lb.className = 'c';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!look[k];
        cb.addEventListener('change', () => ocean.setLook({ [k]: cb.checked }));
        lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + txt)); body.appendChild(lb);
        outs[k] = { set: (val) => { cb.checked = !!val; } };
      });
      const lo = document.createElement('label'); lo.className = 'c';
      const co = document.createElement('input'); co.type = 'checkbox'; co.id = 'pot-outline';
      co.addEventListener('change', () => ocean.setOutline && ocean.setOutline(co.checked));
      lo.appendChild(co); lo.appendChild(document.createTextNode(' Show the detected hull outline')); body.appendChild(lo);
      const info = document.createElement('div'); info.className = 'st'; info.id = 'pot-hullinfo'; info.textContent = 'hull: none'; body.appendChild(info);
      const tick = () => {
        const h = ocean.hullInfo && ocean.hullInfo();
        if (!h) { info.textContent = 'hull: no hull shape in use (soft foam)'; return; }
        info.textContent = 'hull map ' + h.tex[0] + ' x ' + h.tex[1] + ', ' + h.texelCm.toFixed(1) + ' cm per pixel, ' + h.points + ' outline pieces' + (h.meshes > 1 ? ', ' + h.meshes + ' meshes' : '') + ', rebuild ' + h.buildMs.toFixed(1) + ' ms';
      };
      tick(); const iv = setInterval(() => { if (!document.body.contains(el)) clearInterval(iv); else tick(); }, 600);
      return;
    }
    const [key, label, a, b, step, fmt, map, inv] = row;
    const r = document.createElement('div'); r.className = 'r';
    const lab = document.createElement('span'); lab.textContent = label; r.appendChild(lab);
    if (a === 'color') {
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = look[key];
      inp.addEventListener('input', () => ocean.setLook({ [key]: inp.value }));
      r.appendChild(inp); const v = document.createElement('span'); v.className = 'v'; v.textContent = ''; r.appendChild(v);
      outs[key] = { set: (val) => { inp.value = val; } };
    } else {
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = a; inp.max = b; inp.step = step;
      const toUi = (val) => (inv ? inv(val) : val), fromUi = (val) => (map ? map(+val) : +val);
      inp.value = toUi(look[key]);
      const v = document.createElement('span'); v.className = 'v';
      const show = () => { v.textContent = fmt(+inp.value); };
      inp.addEventListener('input', () => { ocean.setLook({ [key]: fromUi(inp.value) }); show(); });
      show(); r.appendChild(inp); r.appendChild(v);
      outs[key] = { set: (val) => { inp.value = toUi(val); show(); } };
    }
    body.appendChild(r);
  });
  const mkRow = (html) => { const d = document.createElement('div'); d.innerHTML = html; body.appendChild(d); return d; };
  const q = mkRow('<div class="r"><span>Quality</span><select id="pot-q"><option value="0">Low</option><option value="1">Medium</option><option value="2">High</option></select><span></span></div>');
  const qs = q.querySelector('select'); qs.value = String(look.quality);
  qs.addEventListener('change', () => ocean.setLook({ quality: +qs.value }));
  const sp = mkRow('<label class="c"><input type="checkbox" id="pot-spray"> Spray</label><label class="c"><input type="checkbox" id="pot-viz"> Show helpers (area, hulls, proxies)</label><label class="c"><input type="checkbox" id="pot-pause"> Pause waves</label>');
  const cbS = sp.querySelector('#pot-spray'), cbV = sp.querySelector('#pot-viz'), cbP = sp.querySelector('#pot-pause');
  cbS.checked = !!look.spray;
  cbS.addEventListener('change', () => ocean.setLook({ spray: cbS.checked }));
  cbV.addEventListener('change', () => opt.onViz && opt.onViz(cbV.checked));
  cbP.addEventListener('change', () => { ocean.paused = cbP.checked; });
  if (opt.lab) {
    const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = 'Test lab (boxes, no model needed)'; body.appendChild(sec);
    const lr = mkRow('<label class="c"><input type="checkbox" id="pot-lab"> Use test boxes instead of my scene</label><div class="r"><span>Hull</span><select id="pot-lab-hull"><option value="boat">Boat hull</option><option value="box">Plain box</option><option value="cat">Twin hulls (catamaran)</option><option value="fin">Hull + overlapping keel fin</option><option value="open">Open-top boat (shows the water kept out)</option></select><span></span></div><div class="r"><span>Island</span><select id="pot-lab-isl"><option value="box">Box island</option><option value="rock">Rock island</option></select><span></span></div><label class="c"><input type="checkbox" id="pot-lab-ph" checked> Placeholder floaters (buoy, dinghy)</label><div class="btns"><button id="pot-lab-frame">Frame the boat</button></div>');
    const g1 = lr.querySelector('#pot-lab'), g2 = lr.querySelector('#pot-lab-hull'), g3 = lr.querySelector('#pot-lab-isl'), g4 = lr.querySelector('#pot-lab-ph');
    const s0 = opt.lab.state; g1.checked = !!s0.on; g2.value = s0.hull; g3.value = s0.island; g4.checked = !!s0.placeholders;
    const push = () => opt.lab.set({ on: g1.checked, hull: g2.value, island: g3.value, placeholders: g4.checked });
    [g1, g2, g3, g4].forEach((n) => n.addEventListener('change', push));
    lr.querySelector('#pot-lab-frame').addEventListener('click', () => opt.lab.frame());
  }
  const btns = mkRow('<div class="btns"><button class="lock" id="pot-lock">Lock Look</button><button id="pot-reset">Reset to locked</button><button id="pot-copy">Copy JSON</button></div><div class="st" id="pot-st"></div>');
  const st = btns.querySelector('#pot-st');
  const say = (txt, cls) => { st.textContent = txt; st.className = 'st' + (cls ? ' ' + cls : ''); };
  const applyAll = (lk) => { ocean.setLook(lk); Object.keys(outs).forEach((k) => { if (k in ocean.look) outs[k].set(ocean.look[k]); }); qs.value = String(ocean.look.quality); cbS.checked = !!ocean.look.spray; };
  btns.querySelector('#pot-lock').addEventListener('click', async () => {
    say('Saving…');
    try {
      const r = await fetch(opt.lockUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ look: ocean.getLook() }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) say('Locked. This look is stored in the .blend and goes into every export.', 'ok');
      else say('The add-on did not accept the look: ' + (j.error || r.status), 'err');
    } catch (e) { say('Could not reach the add-on (is the Ocean Tuner still running in Blender?)', 'err'); }
  });
  btns.querySelector('#pot-reset').addEventListener('click', () => { const l = opt.getLocked && opt.getLocked(); if (l) { applyAll(l); say('Back to the locked look.'); } else say('Nothing locked yet.'); });
  btns.querySelector('#pot-copy').addEventListener('click', () => { const t = JSON.stringify(ocean.getLook(), null, 1); if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => say('Copied.'), () => say(t)); else say(t); });
  const fold = el.querySelector('h3'); let open = true;
  fold.addEventListener('click', () => { open = !open; body.style.display = open ? '' : 'none'; el.querySelector('#pot-fold').textContent = open ? '–' : '+'; });
  const api = {
    sync(lk) { applyAll(lk); },
    setLocked(on) { if (on && !st.textContent) say('A look is locked in the .blend.', 'ok'); },
    remove() { el.remove(); css.remove(); },
  };
  return api;
}
