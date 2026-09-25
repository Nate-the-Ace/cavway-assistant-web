// A ViewCube in the style of Fusion: a labelled cube in the viewport corner
// that turns with the camera. Click a face, edge or corner to look from that
// side; drag it to orbit; the house returns to the home view. Faces are named
// by compass direction, since a cave has no front.

const S = 64; // cube edge, px

// Face: outward normal n, and the world directions of the label's right (u)
// and down (v) as seen from outside. u x v = -n, because CSS space is
// left-handed while the survey frame (x east, y north, z up) is right-handed.
const FACES = [
  { name: 'TOP', n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { name: 'BOTTOM', n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  { name: 'N', n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, -1] },
  { name: 'S', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { name: 'E', n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
  { name: 'W', n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, -1] },
];

const HOUSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 8 8 2.5 14 8M4 7v6.5h3v-4h2v4h3V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

const TRI = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 2 9 8H1z" fill="currentColor"/></svg>';
const ROLL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 9.5a5 5 0 1 0 1.8-5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 1.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const m3d = (cols) => `matrix3d(${cols.flat().map((x) => +x.toFixed(6)).join(',')})`;

export class ViewCube {
  // viewport: a Viewport (_basis(), animateTo(dir), step(kind), orbit(dx, dy), home(), setOrtho(on), setHome(reset))
  constructor(host, viewport) {
    this.vp = viewport;
    this.el = document.createElement('div');
    this.el.className = 'viewcube';
    this.el.innerHTML = `
      <button class="vc-home" title="View options" aria-haspopup="menu">${HOUSE}<span class="vc-caret">▾</span></button>
      <div class="vc-menu" role="menu" hidden>
        <button role="menuitem" data-act="home">Go Home</button>
        <hr>
        <button role="menuitemradio" data-act="ortho">Orthographic</button>
        <button role="menuitemradio" data-act="persp">Perspective</button>
        <hr>
        <button role="menuitem" data-act="sethome">Set current view as Home</button>
        <button role="menuitem" data-act="resethome">Reset Home</button>
      </div>
      <div class="vc-stage"><div class="vc-cube"></div></div>
      <div class="vc-arrows">
        <button class="vc-arrow vc-up" data-step="up" title="Rotate to the face above">${TRI}</button>
        <button class="vc-arrow vc-down" data-step="down" title="Rotate to the face below">${TRI}</button>
        <button class="vc-arrow vc-left" data-step="left" title="Rotate to the face on the left">${TRI}</button>
        <button class="vc-arrow vc-right" data-step="right" title="Rotate to the face on the right">${TRI}</button>
        <button class="vc-roll vc-ccw" data-step="ccw" title="Roll 90° anticlockwise">${ROLL}</button>
        <button class="vc-roll vc-cw" data-step="cw" title="Roll 90° clockwise">${ROLL}</button>
      </div>`;
    host.appendChild(this.el);
    this.cube = this.el.querySelector('.vc-cube');
    this.menu = this.el.querySelector('.vc-menu');
    this.el.querySelector('.vc-home').onclick = (e) => { e.stopPropagation(); this._toggleMenu(); };
    this.menu.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'home') viewport.home();
      if (act === 'ortho' || act === 'persp') viewport.setOrtho(act === 'ortho');
      if (act === 'sethome') viewport.setHome();
      if (act === 'resethome') { viewport.setHome(true); viewport.home(); }
      this._toggleMenu(false);
    };
    // Anything but the menu and its button closes it -- the cube and arrows included.
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest?.('.vc-menu, .vc-home')) this._toggleMenu(false);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._toggleMenu(false); });
    this.el.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => viewport.step(b.dataset.step); });
    for (const f of FACES) {
      const face = document.createElement('div');
      face.className = 'vc-face';
      face.style.transform = m3d([[...f.u, 0], [...f.v, 0], [...f.n, 0], [...f.n.map((x) => (x * S) / 2), 1]]);
      face.innerHTML = `<span class="vc-label">${f.name}</span>`;
      // 3x3 hit zones: centre = face, sides = edges, corners = corners.
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const cell = document.createElement('div');
          cell.className = 'vc-cell';
          cell.dataset.dir = [0, 1, 2].map((i) => f.n[i] + col * f.u[i] + row * f.v[i]).join(',');
          face.appendChild(cell);
        }
      }
      this.cube.appendChild(face);
    }
    this._input();
    this.update();
  }

  _toggleMenu(open = this.menu.hidden) {
    this.menu.hidden = !open;
    if (!open) return;
    for (const b of this.menu.querySelectorAll('[role=menuitemradio]')) {
      b.setAttribute('aria-checked', String((b.dataset.act === 'ortho') === this.vp.ortho));
    }
  }

  // World -> screen: x = right.w, y (down) = -up.w, z (toward viewer) = -fwd.w.
  update() {
    const { fwd, right, up } = this.vp._basis();
    this.el.classList.toggle('vc-aligned', this.vp.faceAligned());
    this.cube.style.transform = m3d([
      [right[0], -up[0], -fwd[0], 0], [right[1], -up[1], -fwd[1], 0], [right[2], -up[2], -fwd[2], 0], [0, 0, 0, 1],
    ]);
  }

  _input() {
    let down = null;
    this.cube.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false, cell: e.target.closest('.vc-cell') };
      this.cube.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.cube.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 3) return;
      down.moved = true;
      down.x = e.clientX; down.y = e.clientY;
      this.vp.orbit(dx, dy);
    });
    this.cube.addEventListener('pointerup', () => {
      if (down && !down.moved && down.cell) this.vp.animateTo(down.cell.dataset.dir.split(',').map(Number));
      down = null;
    });
  }
}
