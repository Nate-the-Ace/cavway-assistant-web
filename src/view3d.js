// 3D viewport. The geometry is CaveCAD's own: the export CSV goes through
// CaveCAD's CsFormatCsv reader, CsNetwork.resolve and CsMesh3d.build (vendored
// unmodified in vendor/cavecad), exactly as the CaveCAD 3D panel builds it.
// This file only draws the buffers, like RCave3dView does natively.

const CORE = ['CsAngles.js', 'CsModel.js', 'CsTraverse.js', 'CsLrud.js', 'CsClosure.js', 'CsFrontier.js',
  'CsNetwork.js', 'Format/CsCsv.js', 'CsMesh3d.js'];
let coreLoaded = null;

// Classic scripts, in order, with the QCAD include() shimmed out (load order covers it).
export function loadCore(base = 'vendor/cavecad/') {
  if (coreLoaded) return coreLoaded;
  window.include = () => {};
  window.includeBasePath = '';
  coreLoaded = CORE.reduce((p, f) => p.then(() => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = base + f;
    s.onload = ok;
    s.onerror = () => fail(new Error('Could not load ' + f));
    document.head.appendChild(s);
  })), Promise.resolve());
  return coreLoaded;
}

// CaveCAD CSV text -> CsMesh3d.build result plus station labels.
export function buildMesh(csv, colorBy) {
  const survey = window.CsFormatCsv.parse(csv);
  const resolved = window.CsNetwork.resolve(survey);
  const mesh = window.CsMesh3d.build(survey, resolved, { colorBy });
  mesh.labels = window.CsMesh3d.stationLabels(resolved);
  return mesh;
}

const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c;
uniform mat4 mvp; uniform mat3 nm; uniform float lit; varying vec3 vc;
void main() {
  gl_Position = mvp * vec4(p, 1.0);
  vec3 N = normalize(nm * n);
  float d = abs(N.z) * 0.75 + 0.25;
  vc = mix(c, c * d, lit);
}`;
const FS = `precision mediump float; varying vec3 vc; void main() { gl_FragColor = vec4(vc, 1.0); }`;

function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

export class Viewport {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    this.prog = prog;
    this.loc = {
      p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c'),
      mvp: gl.getUniformLocation(prog, 'mvp'), nm: gl.getUniformLocation(prog, 'nm'), lit: gl.getUniformLocation(prog, 'lit'),
    };
    this.yaw = -30; this.pitch = 30; this.dist = 50; this.target = [0, 0, 0];
    this.showWalls = true;
    this.buffers = null;
    this._input();
  }

  _buf(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  }

  setMesh(mesh) {
    const gl = this.gl;
    if (this.buffers) for (const b of Object.values(this.buffers)) if (b instanceof WebGLBuffer) gl.deleteBuffer(b);
    const t = mesh.triangles, l = mesh.lines;
    this.buffers = {
      tp: this._buf(t.positions), tn: this._buf(t.normals), tc: this._buf(t.colors), tCount: t.positions.length / 3,
      lp: this._buf(l.positions), lc: this._buf(l.colors), lCount: l.positions.length / 3,
      zero: this._buf(new Array(Math.max(t.positions.length, l.positions.length)).fill(0)),
    };
    this.labels = mesh.labels;
    const same = this.bounds && ['x', 'y', 'z'].every((k) => this.bounds.min[k] === mesh.bounds.min[k] && this.bounds.max[k] === mesh.bounds.max[k]);
    this.bounds = mesh.bounds;
    if (!same) this.viewAll();
    this.draw();
  }

  // Fits the bounding BOX as seen from the current direction (not its sphere,
  // which makes a long cave seen side-on a thread -- CaveCAD found this).
  viewAll() {
    const b = this.bounds;
    if (!b) return;
    this.target = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
    const { right, up, fwd } = this._basis();
    let w = 0, h = 0, depth = 0;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const d = [x - this.target[0], y - this.target[1], z - this.target[2]];
      w = Math.max(w, Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]));
      h = Math.max(h, Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]));
      depth = Math.max(depth, Math.abs(d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]));
    }
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const half = Math.max(h, w / aspect, 0.5) * 1.1;
    this.dist = half / Math.tan((this.fov / 2) * (Math.PI / 180)) + depth;
  }

  get fov() { return 40; }

  _basis() {
    const y = (this.yaw * Math.PI) / 180, p = (this.pitch * Math.PI) / 180;
    const fwd = [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)]; // camera looks along fwd
    const right = [Math.cos(y), -Math.sin(y), 0];
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    return { fwd, right, up };
  }

  _matrices() {
    const { fwd, right, up } = this._basis();
    const eye = this.target.map((t, i) => t - fwd[i] * this.dist);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const view = new Float32Array([
      right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0,
      -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1,
    ]);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const f = 1 / Math.tan((this.fov / 2) * (Math.PI / 180));
    const near = Math.max(0.05, this.dist / 1000), far = this.dist * 20 + 1000;
    const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
    const nm = new Float32Array([right[0], up[0], -fwd[0], right[1], up[1], -fwd[1], right[2], up[2], -fwd[2]]);
    return { mvp: mat4mul(proj, view), nm };
  }

  draw() {
    const gl = this.gl, c = this.canvas, dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    gl.viewport(0, 0, W, H);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    gl.clearColor(...(dark ? [0.09, 0.09, 0.085] : [0.965, 0.965, 0.955]), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    this.overlay.replaceChildren();
    this.onDraw?.();
    if (!this.buffers) return;
    const b = this.buffers, L = this.loc;
    const { mvp, nm } = this._matrices();
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(L.mvp, false, mvp);
    gl.uniformMatrix3fv(L.nm, false, nm);
    const attr = (loc, buf) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); };
    if (this.showWalls && b.tCount) {
      gl.uniform1f(L.lit, 1);
      attr(L.p, b.tp); attr(L.n, b.tn); attr(L.c, b.tc);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, b.tCount);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    if (b.lCount) {
      gl.uniform1f(L.lit, 0);
      attr(L.p, b.lp); attr(L.n, b.zero); attr(L.c, b.lc);
      gl.drawArrays(gl.LINES, 0, b.lCount);
    }
    this._labels(mvp);
  }

  // Station names as HTML over the canvas (CaveCAD learnt overlays belong outside GL too).
  _labels(mvp) {
    const { positions, names } = this.labels || { positions: [], names: [] };
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const every = Math.max(1, Math.ceil(names.length / 50));
    for (let i = 0; i < names.length; i += every) {
      const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (cw <= 0) continue;
      const sx = ((mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / cw + 1) / 2 * w;
      const sy = (1 - ((mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / cw + 1) / 2) * h;
      if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
      const d = document.createElement('span');
      d.textContent = names[i];
      d.style.transform = `translate(${sx + 4}px, ${sy - 14}px)`;
      this.overlay.appendChild(d);
    }
  }

  _input() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        // Pan in the camera's own basis, not world axes.
        const { right, up } = this._basis();
        const s = (2 * this.dist * Math.tan((this.fov / 2) * (Math.PI / 180))) / c.clientHeight;
        this.target = this.target.map((t, i) => t - right[i] * dx * s + up[i] * dy * s);
      } else {
        this.orbit(dx, dy);
        return;
      }
      this.draw();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist *= Math.exp(e.deltaY * 0.0015);
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.viewAll(); this.draw(); });
  }

  orbit(dx, dy) {
    this._anim = null;
    this.yaw = (this.yaw + dx * 0.4) % 360;
    this.pitch = Math.max(-89.9, Math.min(89.9, this.pitch + dy * 0.4));
    this.draw();
  }

  home() { this._tween(-30, 30); }

  // Look from direction `dir` (camera placed on that side), as a ViewCube click.
  animateTo(dir) {
    const len = Math.hypot(...dir);
    const f = dir.map((x) => -x / len);
    const pitch = (Math.asin(Math.max(-1, Math.min(1, -f[2]))) * 180) / Math.PI;
    // Straight down or up has no heading of its own: keep north up.
    const yaw = Math.abs(f[2]) > 0.999 ? 0 : (Math.atan2(f[0], f[1]) * 180) / Math.PI;
    this._tween(yaw, Math.max(-89.9, Math.min(89.9, pitch)));
  }

  _tween(yaw, pitch, ms = 300) {
    const y0 = this.yaw, p0 = this.pitch;
    const dy = ((yaw - y0 + 540) % 360) - 180; // shortest way round
    const t0 = performance.now();
    const anim = (this._anim = {});
    const step = (now) => {
      if (this._anim !== anim) return;
      const t = Math.min(1, (now - t0) / ms), e = t * t * (3 - 2 * t);
      this.yaw = y0 + dy * e;
      this.pitch = p0 + (pitch - p0) * e;
      this.draw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
