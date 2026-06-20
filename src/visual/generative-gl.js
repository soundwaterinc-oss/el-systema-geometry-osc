// GPU generative display layer (WebGL2). Instead of flatly screening the field
// over the plant (lo-fi), this *transforms the plant image itself*: the live
// natural field becomes a flow/refraction field that domain-warps, refracts,
// folds or contours the source on the GPU, while keeping the evolving recolour.
// The scan lines stay as lines on the 2D layer above. Falls back gracefully:
// if WebGL2 is unavailable, isAvailable=false and the caller keeps the 2D path.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uPlant;   // the spinning/breathing source plant
uniform sampler2D uField;   // the colourised evolving natural field
uniform vec2 uRes;
uniform float uTime;
uniform float uBreath;      // 0..1
uniform float uWarp;        // displacement strength
uniform float uColorMix;    // how strongly the field recolours the plant
uniform int uMode;          // 0 flow · 1 refract · 2 kaleido · 3 contour
uniform vec3 uFieldRgb;     // palette accent (0..1)

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Central-difference gradient of the field's luminance — the flow direction.
// A wide stencil samples the field's large-scale flow (not per-spot noise) so
// the warp reads as liquid drift rather than glitchy grain.
vec2 fieldGrad(vec2 uv) {
  vec2 px = 3.0 / uRes;
  float l = luma(texture(uField, uv - vec2(px.x, 0.0)).rgb);
  float r = luma(texture(uField, uv + vec2(px.x, 0.0)).rgb);
  float d = luma(texture(uField, uv - vec2(0.0, px.y)).rgb);
  float u = luma(texture(uField, uv + vec2(0.0, px.y)).rgb);
  return vec2(r - l, u - d);
}

void main() {
  vec2 uv = vUv;
  float breath = 0.5 + 0.5 * uBreath;
  float warp = uWarp * (0.5 + 0.8 * breath);

  // Kaleidoscopic polar fold (mode 2) reshapes UVs before the flow warp.
  vec2 base = uv;
  if (uMode == 2) {
    vec2 c = uv - 0.5;
    float ang = atan(c.y, c.x);
    float rad = length(c);
    float seg = 6.2831853 / 6.0;
    ang = abs(mod(ang, seg) - seg * 0.5) + 0.3 * sin(uTime * 0.2);
    base = vec2(cos(ang), sin(ang)) * rad + 0.5;
  }

  // Two octaves of field flow domain-warp the sampling point — the plant
  // image is dragged along the living field rather than covered by it.
  vec2 g = fieldGrad(base);
  vec2 p = base + g * warp;
  p += fieldGrad(p) * warp * 0.5;
  p += 0.004 * vec2(sin(uTime * 0.3 + uv.y * 6.0), cos(uTime * 0.27 + uv.x * 6.0)) * breath;

  vec3 col;
  if (uMode == 1) {
    // Refract: field as a glassy normal, with a fine chromatic edge + a soft
    // specular sheen where the field is steep — the wet, modern look.
    vec2 n = g * (warp * 1.6);
    float ca = warp * 0.05 + 0.0009;
    float rr = texture(uPlant, p + n + vec2(ca, 0.0)).r;
    float gg = texture(uPlant, p + n).g;
    float bb = texture(uPlant, p + n - vec2(ca, 0.0)).b;
    col = vec3(rr, gg, bb);
    float spec = pow(clamp(length(g) * 4.0, 0.0, 1.0), 2.0);
    col += spec * 0.35 * uFieldRgb;
  } else if (uMode == 3) {
    // Contour: topographic iso-bands of the field carve glowing seams.
    float f = luma(texture(uField, p).rgb);
    float bands = abs(fract(f * 8.0 - uTime * 0.1) - 0.5) * 2.0;
    float seam = smoothstep(0.72, 1.0, bands);
    vec3 plant = texture(uPlant, p + g * warp).rgb;
    col = mix(plant, uFieldRgb, seam * 0.6);
  } else {
    // Flow (0) / kaleido (2): smooth domain-warp of the plant with only a fine
    // chromatic edge (no rainbow grain).
    float ca = warp * 0.04 + 0.0006;
    float rr = texture(uPlant, p + vec2(ca, 0.0)).r;
    float gg = texture(uPlant, p).g;
    float bb = texture(uPlant, p - vec2(ca, 0.0)).b;
    col = vec3(rr, gg, bb);
  }

  // Iridescent glaze (not a covering fill): take only the field's *hue*
  // deviation and let it catch the plant's own light — bright structure picks
  // up the colour, shadows stay the source. Colours the image for ANY palette
  // without ever painting a flat stain over it.
  vec3 fcol = texture(uField, p).rgb;
  float fi = max(luma(fcol), 0.001);
  vec3 hue = fcol / fi - 1.0;          // chroma deviation, ~0 on greys
  float pl = luma(col);                // plant luminance
  col += hue * uColorMix * pl * (0.45 + 0.25 * breath);

  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile: " + log);
  }
  return sh;
}

const MODE_INDEX = { flow: 0, refract: 1, kaleido: 2, contour: 3 };

export function createGenerativeRenderer(opts = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, opts.width || 1024);
  canvas.height = Math.max(2, opts.height || 1024);

  let gl = null;
  try {
    gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: true });
  } catch (_) {
    gl = null;
  }
  if (!gl) {
    return { canvas, isAvailable: false, setSize() {}, render() {} };
  }

  let program;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("link: " + gl.getProgramInfoLog(program));
    }
  } catch (err) {
    console.warn("generative-gl unavailable:", err.message);
    return { canvas, isAvailable: false, setSize() {}, render() {} };
  }

  // Fullscreen quad (triangle strip).
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const name of ["uPlant", "uField", "uRes", "uTime", "uBreath", "uWarp", "uColorMix", "uMode", "uFieldRgb"]) {
    U[name] = gl.getUniformLocation(program, name);
  }

  function makeTex(unit) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  const plantTex = makeTex(0);
  const fieldTex = makeTex(1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  function upload(tex, unit, srcCanvas) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
  }

  return {
    canvas,
    isAvailable: true,
    setSize(w, h) {
      const W = Math.max(2, Math.round(w));
      const H = Math.max(2, Math.round(h));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
    },
    render(plantCanvas, fieldCanvas, params = {}) {
      if (!plantCanvas || !fieldCanvas) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      upload(plantTex, 0, plantCanvas);
      upload(fieldTex, 1, fieldCanvas);
      gl.uniform1i(U.uPlant, 0);
      gl.uniform1i(U.uField, 1);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, params.time || 0);
      gl.uniform1f(U.uBreath, params.breath ?? 0.4);
      gl.uniform1f(U.uWarp, params.warp ?? 0.06);
      gl.uniform1f(U.uColorMix, params.colorMix ?? 0.6);
      const mode = typeof params.mode === "number" ? params.mode : (MODE_INDEX[params.mode] ?? 0);
      gl.uniform1i(U.uMode, mode);
      const rgb = params.fieldRgb || [0.82, 1.0, 0.35];
      gl.uniform3f(U.uFieldRgb, rgb[0], rgb[1], rgb[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

export const GENERATIVE_FX_MODES = Object.keys(MODE_INDEX);
