'use strict';
/* 几何自检：不依赖浏览器，把 scene.js 跑在一个「记录型 Canvas 桩」上，
   收集每一次 fillRect，然后检查几条硬性不变量。

   1. 每个窗格都必须被某个楼体完全包住          → 窗不会飘在天上
   2. 会明灭的窗格绝不能和烘焙层里的窗格重叠      → 关灯后不会剩一个淡黄小方框
   3. 所有窗格坐标都是整数                      → 方块清楚，不会糊边
   4. 闪烁窗格分布在多栋楼上                    → 遮挡判定没有退化成「只有最后一栋楼」
*/

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCENE = path.join(__dirname, '..', 'assets', 'scene.js');
const src = fs.readFileSync(SCENE, 'utf8');
const MARGIN = Number((src.match(/var MARGIN\s*=\s*(\d+)/) || [])[1]);

const W = 1600, H = 1000;
const WIN = '#ffdd2b';
const recorded = [];

function makeCtx(surface) {
  const ctx = {
    surface, _fill: '#000', _stroke: '#000', _alpha: 1,
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    setTransform() {}, save() {}, restore() {}, translate() {}, scale() {},
    beginPath() {}, closePath() {}, rect() {}, moveTo() {}, lineTo() {},
    arc() {}, fill() {}, stroke() {}, clip() {}, clearRect() {},
    drawImage() {}, fillText() {}, measureText() { return { width: 0 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect(x, y, w, h) {
      recorded.push({ surface, x, y, w, h, fill: ctx._fill, alpha: ctx._alpha });
    }
  };
  Object.defineProperty(ctx, 'fillStyle', { get: () => ctx._fill, set: v => { ctx._fill = v; } });
  Object.defineProperty(ctx, 'strokeStyle', { get: () => ctx._stroke, set: v => { ctx._stroke = v; } });
  Object.defineProperty(ctx, 'globalAlpha', { get: () => ctx._alpha, set: v => { ctx._alpha = v; } });
  return ctx;
}

const makeCanvas = surface => ({
  width: 0, height: 0, style: {},
  getContext: () => makeCtx(surface)
});

const canvasEl = makeCanvas('main');
const flashEl = { style: {} };
let rafCb = null;

const sandbox = {
  console, Math, Date, JSON, isNaN, parseInt, parseFloat,
  performance: { now: () => 1000 },
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestAnimationFrame(cb) { rafCb = cb; return 1; },
  cancelAnimationFrame() {},
  document: {
    getElementById: id => (id === 'scene' ? canvasEl : id === 'flash' ? flashEl : null),
    createElement: () => makeCanvas('off'),
    addEventListener() {},
    hidden: false
  },
  window: {
    innerWidth: W, innerHeight: H, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    pageYOffset: 0
  }
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'scene.js' });

/* 跑一帧：闪烁窗格画在主画布上（起始都是「亮」） */
if (rafCb) rafCb(1200);

const eps = 0.01;
const inside = (r, b) => r.x >= b.x - eps && r.y >= b.y - eps &&
                         r.x + r.w <= b.x + b.w + eps && r.y + r.h <= b.y + b.h + eps;
const overlap = (a, b) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps &&
                          a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;

const baked = recorded.filter(r => r.surface === 'off');
const solids = baked.filter(r => r.fill !== WIN);
const bakedWin = baked.filter(r => r.fill === WIN);

/* 烘焙层是按「先远景后近景、每栋楼先画楼体再画窗格」的顺序画的，
   所以一扇窗是否可见，取决于它之后有没有别的楼体把它整个盖住。
   被盖住的窗格本来就不显示，和它重叠不算问题。 */
let seqI = 0;
recorded.forEach(r => { if (r.surface === 'off') r._i = seqI++; });
const solidsSeq = solids.slice().sort((a, b) => a._i - b._i);
const occluded = w => solidsSeq.some(s => s._i > w._i && inside(w, s));
const visibleWin = bakedWin.filter(w => !occluded(w));

const flickers = recorded
  .filter(r => r.surface === 'main' && r.fill === WIN)
  .map(r => ({ ...r, x: r.x + MARGIN }));   // 主画布坐标 → 烘焙层坐标

const fails = [];

/* 1. 窗格不能飘在天上 */
const floating = bakedWin.filter(w => !solids.some(b => inside(w, b)));
if (floating.length) fails.push(`有 ${floating.length} 个窗格不在任何楼体内`);

/* 2. 会明灭的窗格不能和「看得见」的烘焙窗格重叠
      —— 只和被遮挡的窗格重叠是安全的（那些窗本来就看不见） */
const clash = [];
visibleWin.forEach(bw => {
  flickers.forEach(fw => { if (overlap(bw, fw)) clash.push({ bw, fw }); });
});
if (clash.length) fails.push(`有 ${clash.length} 处明灭窗格与可见窗格重叠（关灯会残留）`);

/* 3. 整像素对齐 */
const frac = [...bakedWin, ...flickers].filter(r =>
  !Number.isInteger(r.x) || !Number.isInteger(r.y) ||
  !Number.isInteger(r.w) || !Number.isInteger(r.h));
if (frac.length) fails.push(`有 ${frac.length} 个窗格坐标不是整数`);

/* 4. 闪烁窗格应分布在多栋楼上 */
const owner = new Set();
flickers.forEach(f => {
  const host = solids
    .filter(b => inside(f, b))
    .sort((p, q) => p.w * p.h - q.w * q.h)[0];
  if (host) owner.add(host.x + ':' + host.y + ':' + host.w);
});
if (flickers.length && owner.size < 2) {
  fails.push(`闪烁窗格只落在 ${owner.size} 栋楼上（遮挡判定可能退化）`);
}

console.log('MARGIN                =', MARGIN);
console.log('楼体                  =', solids.length);
console.log('烘焙层窗格            =', bakedWin.length, '（可见', visibleWin.length,
            '/ 被后楼盖住', bakedWin.length - visibleWin.length, '）');
console.log('明灭窗格              =', flickers.length, '（分布在', owner.size, '栋楼）');
console.log('悬浮窗格              =', floating.length);
console.log('明灭/可见窗格重叠     =', clash.length);
console.log('非整数坐标窗格        =', frac.length);

if (clash.length) {
  console.log('\n重叠样例（烘焙层坐标）：');
  clash.slice(0, 3).forEach(({ bw, fw }) => {
    console.log(`  烘焙窗 x=${bw.x} y=${bw.y} w=${bw.w} h=${bw.h}`);
    console.log(`  明灭窗 x=${fw.x} y=${fw.y} w=${fw.w} h=${fw.h}`);
  });
}
if (floating.length) {
  console.log('\n悬浮样例（烘焙层坐标）：');
  floating.slice(0, 3).forEach(w => {
    const near = solids.map(b => ({ b, d: Math.abs((b.x + b.w / 2) - (w.x + w.w / 2)) }))
                       .sort((p, q) => p.d - q.d)[0].b;
    console.log(`  窗 @x=${w.x} y=${w.y}  vs  最近的楼 x=${near.x}..${near.x + near.w}`);
  });
}

console.log('\n结论：' + (fails.length ? '失败\n  - ' + fails.join('\n  - ') : '全部通过'));
process.exit(fails.length ? 1 : 0);
