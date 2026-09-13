/* ==========================================================================
   雨城 · 街景漫步 —— 2D 伪 3D 街道
   --------------------------------------------------------------------------
   投影：一台高度 CAM_H、焦距 FOCAL 的相机，沿街站在 z=0 处。
     地面某点（深度 z）=  screenY = horizon + FOCAL*CAM_H / z
     物体在某深度的缩放   =  FOCAL / z            （像素 / 世界单位）
   于是人行道自动向灭点收拢，越远的楼越小、越暗、越偏上，
   这就是「伪 3D」的全部来源 —— 画面本身仍然是一层层 2D 图元。

   视角：镜头正对街道，所以人物是侧面，四栋店面的正脸对着镜头。
   图层顺序（由远及近）：
     远景楼群 → 近景店面 → 人行道 → 倒影 → 人物 → 前景雨
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('walk');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var TAU = Math.PI * 2;
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  /* ------------------------------------------------------------ 相机参数 --- */

  var FOCAL        = 520;    // 焦距（像素）
  var CAM_H        = 1.6;    // 相机离地高度（世界单位）
  var FACADE_Z     = 6.0;    // 店面所在的深度
  var SIDEWALK_Z   = 1.65;   // 人行道离镜头最近的深度
  var PLAYER_Z     = 3.0;    // 人物行走的深度
  var TILE         = 0.9;    // 人行道砖的边长（世界单位）
  var LEAD         = 0.115;  // 人物偏左的比例，右边留出更多街道

  var C = {
    pave:      '#161d25',
    paveLit:   '#1d2731',
    joint:     'rgba(140,180,215,.10)',
    curb:      '#334454',
    facade:    '#0c1219',
    facade2:   '#0f1720',
    window:    '#ffdd2b',
    windowCool:'#8fd6ff',
    neonPink:  '#ff5aa8',
    neonCyan:  '#4fd8ff',
    neonGreen: '#5ce08a',
    neonAmber: '#ffb347',
    hoodie:    '#2b3542',
    hoodieHi:  '#3b4757',
    pants:     '#1a212a',
    shoe:      '#0d1116',
    skin:      '#c99a76'
  };

  var S = {
    W: 0, H: 0, dpr: 1,
    horizon: 0, K: 0,
    active: false, running: false,
    raf: 0, last: 0, now: 0
  };

  var cam = { x: 0, sx: 0 };
  var player = { x: 0, z: PLAYER_Z, dir: 1, speed: 1.35, phase: 0, steer: 0 };
  var street = { slots: [], length: 0, start: 0 };
  var marks = [];        // 四栋地标的世界坐标
  var drops = [];
  var splashes = [];
  var puddles = [];

  /* ---------------------------------------------------------------- 工具 --- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* 世界坐标 → 屏幕 */
  function groundY(z) { return S.horizon + S.K / z; }
  function scaleAt(z) { return FOCAL / z; }
  function screenX(worldX, z) { return S.W * 0.5 + (worldX - cam.sx) * FOCAL / z; }

  /* --------------------------------------------------------------- 街道 --- */

  var LANDMARKS = [
    { id: 'neon',  name: '霓虹街区',      w: 10.0, h: 13.0, draw: drawNeon,  anim: animNeon },
    { id: 'store', name: '24 小时便利店', w: 8.4,  h: 5.0,  draw: drawStore, anim: animStore },
    { id: 'deck',  name: '云端观景台',    w: 9.0,  h: 15.0, draw: drawDeck,  anim: animDeck },
    { id: 'radio', name: '雨夜电台',      w: 9.2,  h: 4.8,  draw: drawRadio, anim: animRadio }
  ];

  function buildStreet() {
    var rnd = mulberry32(20260301);
    var slots = [], x = 0, li = 0, i;

    for (i = 0; i < 27; i++) {
      if (i % 3 === 0) {
        var lm = LANDMARKS[li % LANDMARKS.length];
        li++;
        slots.push({
          kind: 'landmark', def: lm, x: x, w: lm.w, h: lm.h,
          seed: Math.floor(rnd() * 1e6),
          lit: true, flash: 0, vu: [0, 0, 0, 0, 0]
        });
        x += lm.w;
      } else {
        var w = 5.2 + rnd() * 3.4;
        var floors = rnd() < 0.42 ? 1 : (rnd() < 0.6 ? 2 : 3);
        slots.push({
          kind: 'plain', x: x, w: w, h: floors * 4.2,
          variant: Math.floor(rnd() * 4),
          seed: Math.floor(rnd() * 1e6)
        });
        x += w;
      }
    }

    street.slots = slots;
    street.length = x;

    marks = [];
    for (i = 0; i < slots.length; i++) {
      if (slots[i].kind === 'landmark') {
        marks.push({ slot: slots[i], name: slots[i].def.name, id: slots[i].def.id });
      }
    }
  }

  /* 人行道上的水洼，位置固定 */
  function buildPuddles() {
    var rnd = mulberry32(913377);
    puddles = [];
    for (var i = 0; i < 26; i++) {
      puddles.push({
        x: rnd() * street.length,
        z: SIDEWALK_Z + 0.5 + rnd() * (FACADE_Z - SIDEWALK_Z - 0.8),
        r: 0.7 + rnd() * 1.9,
        seed: rnd() * TAU
      });
    }
  }

  /* --------------------------------------------------------------- 雨 --- */

  function buildDrops() {
    var n = Math.round(clamp(S.W * S.H / 5200, 90, 260));
    drops = [];
    for (var i = 0; i < n; i++) drops.push(newDrop(true));
  }

  function newDrop(seeded) {
    var depth = 0.2 + Math.random() * 0.8;
    var sp = (520 + depth * 760);
    return {
      x: Math.random() * (S.W + 320) - 160,
      y: seeded ? Math.random() * S.H : -40 - Math.random() * 160,
      vx: -sp * 0.16,
      vy: sp,
      len: 16 + depth * 46,
      w: depth > 0.7 ? 1.8 : 1.1,
      a: 0.16 + depth * 0.5
    };
  }

  function updateRain(dt) {
    var i, d;
    for (i = 0; i < drops.length; i++) {
      d = drops[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > S.H + 50 || d.x < -190) {
        d.y = -40 - Math.random() * 180;
        d.x = Math.random() * (S.W + 380) - 160;
        d.len = 16 + Math.random() * 46;
      }
    }

    /* 地面溅起的小水花 */
    if (Math.random() < dt * 26 && splashes.length < 70) {
      var z = SIDEWALK_Z + Math.random() * (FACADE_Z - SIDEWALK_Z);
      splashes.push({ x: cam.sx + (Math.random() - 0.5) * 16, z: z, t: 0, life: 0.4 + Math.random() * 0.3 });
    }
    for (i = splashes.length - 1; i >= 0; i--) {
      splashes[i].t += dt;
      if (splashes[i].t > splashes[i].life) splashes.splice(i, 1);
    }
  }

  function drawRain() {
    var i, d;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d9edfb';
    for (i = 0; i < drops.length; i++) {
      d = drops[i];
      ctx.globalAlpha = d.a;
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * 0.16, d.y - d.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 水花：地面上的一圈小涟漪，按深度缩放 */
    for (i = 0; i < splashes.length; i++) {
      var sp = splashes[i];
      var k = sp.t / sp.life;
      var x = screenX(sp.x, sp.z);
      var y = groundY(sp.z);
      var r = (0.06 + k * 0.22) * scaleAt(sp.z);
      if (x < -60 || x > S.W + 60) continue;
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.strokeStyle = '#bcdcf2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.34, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ 人行道 --- */

  function drawSidewalk() {
    var zN = SIDEWALK_Z, zF = FACADE_Z;
    var yN = groundY(zN), yF = groundY(zF);
    var i, z, y, x1, x2, k;

    var g = ctx.createLinearGradient(0, yF, 0, S.H);
    g.addColorStop(0, '#1b2430');
    g.addColorStop(0.45, C.pave);
    g.addColorStop(1, '#10161d');
    ctx.fillStyle = g;
    ctx.fillRect(0, yF, S.W, S.H - yF + 2);

    /* 铺装：横向砖缝（等距深度 → 天然透视疏密） */
    ctx.strokeStyle = C.joint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (z = zN; z <= zF; z += 0.16) {
      y = groundY(z);
      ctx.moveTo(0, y);
      ctx.lineTo(S.W, y);
    }
    ctx.stroke();

    /* 纵向砖缝：等距世界坐标 → 全部汇聚到灭点 */
    ctx.beginPath();
    var from = Math.floor((cam.sx - 20) / TILE) * TILE;
    for (var wx = from; wx < cam.sx + 20; wx += TILE) {
      x1 = screenX(wx, zN);
      x2 = screenX(wx, zF);
      ctx.moveTo(x1, yN);
      ctx.lineTo(x2, yF);
    }
    ctx.stroke();

    /* 路缘石 */
    ctx.fillStyle = C.curb;
    ctx.fillRect(0, yF - 3, S.W, 3);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, yF + 1, S.W, 5);
    ctx.globalAlpha = 1;

    /* 靠墙一侧的积水反光带 */
    var wall = ctx.createLinearGradient(0, yF, 0, yF + (yN - yF) * 0.45);
    wall.addColorStop(0, 'rgba(150,200,240,.10)');
    wall.addColorStop(1, 'rgba(150,200,240,0)');
    ctx.fillStyle = wall;
    ctx.fillRect(0, yF, S.W, (yN - yF) * 0.45);

    /* 水洼 */
    for (i = 0; i < puddles.length; i++) {
      var p = puddles[i];
      var pz = p.z;
      var px = screenX(p.x, pz);
      var s = scaleAt(pz);
      var rx = p.r * s;
      if (px + rx < -40 || px - rx > S.W + 40) continue;
      var py = groundY(pz);
      var ry = p.r * s * 0.30;
      var gg = ctx.createRadialGradient(px, py, 0, px, py, rx);
      gg.addColorStop(0, 'rgba(190,225,250,.16)');
      gg.addColorStop(0.7, 'rgba(150,195,235,.07)');
      gg.addColorStop(1, 'rgba(140,185,225,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, TAU);
      ctx.fill();

      /* 水面上抖动的反光 */
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#cfe8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (k = -1; k <= 1; k++) {
        var wy = py + k * ry * 0.45 + Math.sin(S.now * 1.6 + p.seed + k) * 1.2;
        ctx.moveTo(px - rx * 0.6, wy);
        ctx.lineTo(px + rx * 0.6, wy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /* 招牌灯光打在人行道上的倒影 */
  function drawSpill(x0, x1, baseY, s, color, strength) {
    var w = x1 - x0;
    var h = (baseY - groundY(FACADE_Z)) + (S.H - baseY) * 0.8;
    var g = ctx.createLinearGradient(0, baseY, 0, baseY + h);
    g.addColorStop(0, hexA(color, 0.22 * strength));
    g.addColorStop(0.45, hexA(color, 0.07 * strength));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x0, baseY, w, h);
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* --------------------------------------------------------------- 远景 --- */

  function drawBackdrop() {
    var z = 16;
    var s = scaleAt(z);
    var base = groundY(z);
    var rnd = mulberry32(5150);
    var x = 0, i;

    /* 地平线雾带 */
    var g = ctx.createLinearGradient(0, base - 210, 0, base + 30);
    g.addColorStop(0, 'rgba(38,54,70,0)');
    g.addColorStop(0.62, 'rgba(40,58,76,.55)');
    g.addColorStop(1, 'rgba(24,36,48,.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, base - 210, S.W, 250);

    /* 远处剪影楼群 */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S.W, base);
    ctx.clip();
    for (i = 0; i < 90; i++) {
      var w = (1.6 + rnd() * 3.2) * s;
      var h = (3 + rnd() * 13) * s;
      var bx = ((rnd() * 220 - cam.sx * 0.18) * s) % (S.W + 400) - 200;
      if (bx < -220) bx += S.W + 400;
      ctx.fillStyle = i % 3 === 0 ? '#131c26' : '#0f1721';
      ctx.fillRect(bx, base - h, w, h);
      if (rnd() < 0.5) {
        ctx.fillStyle = 'rgba(255,221,43,.30)';
        ctx.fillRect(bx + w * 0.22, base - h + h * 0.18, w * 0.16, w * 0.16);
        ctx.fillRect(bx + w * 0.58, base - h + h * 0.34, w * 0.16, w * 0.16);
      }
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------- 立面 --- */

  /* 一栋楼的通用外壳：楼体 + 层线 + 女儿墙 */
  function shell(x0, x1, baseY, s, units, color, litColor) {
    var w = x1 - x0;
    var h = units * s;
    var top = baseY - h;
    var g = ctx.createLinearGradient(x0, top, x0, baseY);
    g.addColorStop(0, color);
    g.addColorStop(0.7, litColor);
    g.addColorStop(1, '#080d12');
    ctx.fillStyle = g;
    ctx.fillRect(x0, top, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x0, top, w, 4);
    return top;
  }

  /* 窗格阵列 */
  function windows(x0, x1, top, baseY, s, rng, opt) {
    opt = opt || {};
    var pitchX = (opt.pitchX || 1.15) * s;
    var pitchY = (opt.pitchY || 1.6) * s;
    var ww = (opt.w || 0.66) * s;
    var wh = (opt.h || 0.92) * s;
    var padX = (opt.padX || 0.5) * s;
    var startY = (opt.top || 0.9) * s;

    var cols = Math.floor((x1 - x0 - padX * 2) / pitchX);
    var rows = Math.floor((baseY - top - startY * 1.0) / pitchY);
    var lit = opt.lit === undefined ? 0.42 : opt.lit;
    var warm = opt.warm === undefined ? 0.75 : opt.warm;

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var on = rng() < lit;
        var x = x0 + padX + c * pitchX;
        var y = top + startY + r * pitchY;
        if (y + wh > baseY - 0.4 * s) continue;
        if (on) {
          ctx.fillStyle = rng() < warm ? C.window : C.windowCool;
          ctx.globalAlpha = 0.55 + rng() * 0.45;
        } else {
          ctx.fillStyle = '#070b10';
          ctx.globalAlpha = 1;
        }
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(ww), Math.round(wh));
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 发光文字 */
  function glowText(text, x, y, size, color, align, blur) {
    ctx.save();
    ctx.font = '700 ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = blur === undefined ? size * 0.9 : blur;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* ------------------------------------------------- 地标 1：霓虹街区 --- */

  function drawNeon(g, x0, x1, baseY, s, slot) {
    var rnd = mulberry32(slot.seed);
    var w = x1 - x0;
    var top = shell(x0, x1, baseY, s, slot.h, '#0d141d', '#111a24');

    /* 楼体竖向壁柱 */
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    for (var px = x0; px < x1; px += 3.2 * s) ctx.fillRect(px, top, 2, baseY - top);

    windows(x0, x1, top, baseY - 5.6 * s, s, rnd, { lit: 0.5, pitchX: 1.3, pitchY: 1.5, w: 0.7, h: 0.85 });

    /* 底层店铺：暖光橱窗 */
    var shopTop = baseY - 3.1 * s;
    ctx.fillStyle = '#0a0f15';
    ctx.fillRect(x0, shopTop, w, baseY - shopTop);
    for (var i = 0; i < 4; i++) {
      var bx = x0 + (0.5 + i * 2.3) * s;
      var bw = 1.7 * s;
      if (bx + bw > x1 - 0.3 * s) break;
      var gg = ctx.createLinearGradient(0, shopTop, 0, baseY);
      gg.addColorStop(0, 'rgba(255,206,120,.55)');
      gg.addColorStop(1, 'rgba(255,150,60,.18)');
      ctx.fillStyle = gg;
      ctx.fillRect(bx, shopTop + 0.6 * s, bw, 2.1 * s);
      ctx.fillStyle = 'rgba(10,14,20,.85)';
      ctx.fillRect(bx + bw * 0.42, shopTop + 0.6 * s, 3, 2.1 * s);
    }

    /* 霓虹招牌：粉色横匾 */
    var sy = baseY - 4.4 * s;
    var sh = 1.3 * s;
    ctx.fillStyle = 'rgba(8,12,18,.94)';
    ctx.fillRect(x0 + 0.7 * s, sy, w - 1.4 * s, sh);
    ctx.strokeStyle = hexA(C.neonPink, 0.85);
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 0.7 * s + 1, sy + 1, w - 1.4 * s - 2, sh - 2);
    glowText('霓 虹 街 区', (x0 + x1) / 2, sy + sh * 0.54, Math.round(0.82 * s), C.neonPink, 'center', 0.9 * s);

    /* 竖挂霓虹灯箱 */
    var cols = [C.neonCyan, C.neonAmber, C.neonGreen];
    var chars = ['霓', '虹', '街'];
    for (var v = 0; v < 3; v++) {
      var vx = x0 + (1.6 + v * 3.0) * s;
      var vy = baseY - (7.4 + v * 1.6) * s;
      if (vx + 0.9 * s > x1) break;
      ctx.fillStyle = 'rgba(6,10,15,.9)';
      ctx.fillRect(vx, vy, 0.9 * s, 2.6 * s);
      ctx.strokeStyle = hexA(cols[v], 0.9);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx + 1, vy + 1, 0.9 * s - 2, 2.6 * s - 2);
      glowText(chars[v], vx + 0.45 * s, vy + 1.3 * s, Math.round(0.5 * s), cols[v], 'center', 0.5 * s);
    }

    /* 檐口霓虹灯管 */
    ctx.strokeStyle = hexA(C.neonCyan, 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 3, baseY - 3.25 * s);
    ctx.lineTo(x1 - 3, baseY - 3.25 * s);
    ctx.stroke();

    slot.spill = C.neonPink;
  }

  function animNeon(slot, x0, x1, baseY, s) {
    /* 横匾偶尔闪一下 */
    if (S.now > slot.flash) {
      slot.flash = S.now + 0.06 + Math.random() * 0.12;
      slot.lit = !slot.lit;
      if (!slot.lit && Math.random() < 0.6) slot.flash = S.now + 0.3 + Math.random() * 2.4;
    }
    if (!slot.lit) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(8,12,18,.9)';
      ctx.fillRect(x0 + 0.7 * s, baseY - 4.4 * s, x1 - x0 - 1.4 * s, 1.3 * s);
      ctx.globalAlpha = 1;
    }
  }

  /* --------------------------------------------- 地标 2：24 小时便利店 --- */

  function drawStore(g, x0, x1, baseY, s, slot) {
    var w = x1 - x0;
    var top = shell(x0, x1, baseY, s, slot.h, '#131a22', '#1a232c');

    /* 玻璃门面：里面是亮的 */
    var gTop = baseY - 3.5 * s;
    var gg = ctx.createLinearGradient(0, gTop, 0, baseY);
    gg.addColorStop(0, '#fff3d6');
    gg.addColorStop(0.55, '#ffe2ae');
    gg.addColorStop(1, '#e8c98d');
    ctx.fillStyle = gg;
    ctx.fillRect(x0 + 0.35 * s, gTop, w - 0.7 * s, baseY - gTop - 0.25 * s);

    /* 内部货架 */
    ctx.fillStyle = 'rgba(150,120,80,.35)';
    for (var r = 0; r < 3; r++) {
      ctx.fillRect(x0 + 0.6 * s, gTop + (0.75 + r * 0.85) * s, w - 1.4 * s, 0.16 * s);
    }
    var rnd = mulberry32(slot.seed);
    for (var i = 0; i < 26; i++) {
      ctx.fillStyle = ['#e0685a', '#4a9ad4', '#e5b34a', '#6bbf7a', '#c46ba8'][i % 5];
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x0 + (0.7 + rnd() * (w / s - 1.9)) * s,
                   gTop + (0.55 + Math.floor(rnd() * 3) * 0.85) * s,
                   0.16 * s, 0.2 * s);
    }
    ctx.globalAlpha = 1;

    /* 顶灯管 */
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(x0 + 0.7 * s, gTop + 0.14 * s, w - 1.4 * s, 0.1 * s);

    /* 自动门 */
    var dx = x0 + w - 3.2 * s;
    ctx.strokeStyle = '#3f8f63';
    ctx.lineWidth = 3;
    ctx.strokeRect(dx, gTop + 0.15 * s, 2.1 * s, baseY - gTop - 0.4 * s);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillRect(dx + 0.12 * s, gTop + 0.3 * s, 0.9 * s, baseY - gTop - 0.7 * s);
    ctx.fillRect(dx + 1.1 * s, gTop + 0.3 * s, 0.9 * s, baseY - gTop - 0.7 * s);

    /* 招牌横带 */
    var fy = baseY - 4.5 * s;
    var fh = 0.95 * s;
    ctx.fillStyle = '#f4f6f2';
    ctx.fillRect(x0 + 0.2 * s, fy, w - 0.4 * s, fh);
    ctx.fillStyle = '#2f9e5e';
    ctx.fillRect(x0 + 0.2 * s, fy, (w - 0.4 * s) * 0.28, fh);
    ctx.fillStyle = '#e8792b';
    ctx.fillRect(x0 + 0.2 * s + (w - 0.4 * s) * 0.72, fy, (w - 0.4 * s) * 0.28, fh);

    ctx.save();
    ctx.fillStyle = '#1d2a22';
    ctx.font = '800 ' + Math.round(0.52 * s) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('24 小时便利店', (x0 + x1) / 2, fy + fh * 0.54);
    ctx.restore();

    /* 牌匾灯管 */
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(x0 + 0.2 * s, fy - 3, w - 0.4 * s, 3);

    /* 屋顶：矮墙 + 排风 + 灯箱 */
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(x0, top, w, 5);
    ctx.fillStyle = '#1b242e';
    ctx.fillRect(x0 + 0.8 * s, top - 0.55 * s, 1.1 * s, 0.55 * s);
    ctx.fillRect(x0 + 2.4 * s, top - 0.4 * s, 0.8 * s, 0.4 * s);
    var lbx = x1 - 2.6 * s;
    ctx.fillStyle = 'rgba(10,16,22,.95)';
    ctx.fillRect(lbx, top - 1.1 * s, 1.5 * s, 1.1 * s);
    ctx.strokeStyle = hexA(C.neonGreen, 0.9);
    ctx.lineWidth = 2;
    ctx.strokeRect(lbx + 1, top - 1.1 * s + 1, 1.5 * s - 2, 1.1 * s - 2);
    glowText('24', lbx + 0.75 * s, top - 0.52 * s, Math.round(0.6 * s), C.neonGreen, 'center', 0.5 * s);

    /* 门口杂物：自动售货机、垃圾桶 */
    ctx.fillStyle = '#0d1a26';
    ctx.fillRect(x0 + 0.45 * s, baseY - 1.8 * s, 1.0 * s, 1.8 * s);
    ctx.fillStyle = 'rgba(90,190,255,.75)';
    ctx.fillRect(x0 + 0.55 * s, baseY - 1.65 * s, 0.8 * s, 0.95 * s);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(x0 + 0.55 * s, baseY - 0.6 * s, 0.8 * s, 0.12 * s);

    slot.spill = '#ffd9a0';
  }

  function animStore(slot, x0, x1, baseY, s) {
    /* 顶灯轻微呼吸 */
    ctx.globalAlpha = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(S.now * 2.4 + slot.seed));
    ctx.fillStyle = '#fff6dd';
    ctx.fillRect(x0 + 0.35 * s, baseY - 3.5 * s, x1 - x0 - 0.7 * s, 3.25 * s);
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------- 地标 3：云端观景台 --- */

  function drawDeck(g, x0, x1, baseY, s, slot) {
    var w = x1 - x0;
    var top = shell(x0, x1, baseY, s, slot.h, '#0b131c', '#101b26');

    /* 玻璃幕墙：竖挺 + 层线 */
    var mull = 0.95 * s;
    for (var x = x0; x < x1; x += mull) {
      ctx.fillStyle = 'rgba(120,200,240,.13)';
      ctx.fillRect(x, top, 2, baseY - top);
    }
    for (var fl = 1; fl * 3.4 * s < baseY - top; fl++) {
      var y = baseY - fl * 3.4 * s;
      ctx.fillStyle = 'rgba(120,200,240,.10)';
      ctx.fillRect(x0, y, w, 2);
      /* 亮着的楼层 */
      if (fl % 2 === (slot.seed % 2)) {
        ctx.fillStyle = 'rgba(150,215,255,.16)';
        ctx.fillRect(x0, y - 2.6 * s, w, 2.6 * s);
      }
    }

    /* 入口：雨篷 + 灯带 */
    var ey = baseY - 3.3 * s;
    ctx.fillStyle = 'rgba(180,230,255,.16)';
    ctx.fillRect(x0, ey, w, 3.3 * s);
    ctx.fillStyle = '#0a1017';
    ctx.fillRect(x0, baseY - 2.4 * s, w, 2.4 * s);
    ctx.fillStyle = 'rgba(190,235,255,.5)';
    ctx.fillRect(x0 + 0.4 * s, baseY - 2.35 * s, w - 0.8 * s, 1.5 * s);
    ctx.fillStyle = 'rgba(10,16,24,.75)';
    ctx.fillRect(x0 + w * 0.44, baseY - 2.35 * s, 2, 2.35 * s);

    /* 雨篷 */
    ctx.fillStyle = '#0e1720';
    ctx.fillRect(x0 + 0.3 * s, ey - 0.5 * s, w - 0.6 * s, 0.5 * s);
    ctx.fillStyle = 'rgba(120,215,255,.6)';
    ctx.fillRect(x0 + 0.3 * s, ey - 0.08 * s, w - 0.6 * s, 3);

    /* 门楣招牌 */
    glowText('云端观景台', (x0 + x1) / 2, ey - 1.15 * s, Math.round(0.72 * s), C.neonCyan, 'center', 0.7 * s);
    glowText('68F', (x0 + x1) / 2, ey - 1.95 * s, Math.round(0.46 * s), '#bde8ff', 'center', 0.4 * s);

    /* 云朵 logo */
    var cx = x0 + w * 0.5, cy = baseY - 6.1 * s, cr = 0.4 * s;
    ctx.fillStyle = hexA(C.neonCyan, 0.85);
    ctx.beginPath();
    ctx.arc(cx - cr * 0.9, cy, cr * 0.72, 0, TAU);
    ctx.arc(cx, cy - cr * 0.32, cr, 0, TAU);
    ctx.arc(cx + cr * 1.0, cy, cr * 0.66, 0, TAU);
    ctx.fill();

    /* 观光电梯井 */
    slot.shaft = { x: x1 - 2.3 * s, w: 1.9 * s, top: baseY - 9.6 * s, bottom: baseY - 3.3 * s };
    ctx.fillStyle = 'rgba(8,14,20,.85)';
    ctx.fillRect(slot.shaft.x, slot.shaft.top, slot.shaft.w, slot.shaft.bottom - slot.shaft.top);
    ctx.strokeStyle = 'rgba(120,215,255,.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(slot.shaft.x, slot.shaft.top, slot.shaft.w, slot.shaft.bottom - slot.shaft.top);

    slot.spill = C.neonCyan;
  }

  function animDeck(slot, x0, x1, baseY, s) {
    var sh = slot.shaft;
    if (!sh) return;
    /* 电梯轿厢上下跑 */
    var k = 0.5 + 0.5 * Math.sin(S.now * 0.55 + slot.seed * 0.01);
    var cy = sh.bottom - 0.55 * s - (sh.bottom - sh.top - 1.3 * s) * k;
    ctx.fillStyle = 'rgba(190,240,255,.9)';
    ctx.fillRect(sh.x + 4, cy, sh.w - 8, 0.85 * s);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(sh.x + 4, cy, sh.w - 8, 3);

    /* 顶部扫射灯 */
    var a = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(S.now * 1.4));
    ctx.globalAlpha = a;
    ctx.fillStyle = C.neonCyan;
    ctx.fillRect(x0, baseY - 10.4 * s, x1 - x0, 0.7 * s);
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------ 地标 4：雨夜电台 --- */

  function drawRadio(g, x0, x1, baseY, s, slot) {
    var rnd = mulberry32(slot.seed);
    var w = x1 - x0;
    var top = shell(x0, x1, baseY, s, slot.h, '#121820', '#1c232c');

    /* 装饰线脚 */
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(x0, top + 0.5 * s, w, 2);
    ctx.fillRect(x0, baseY - 4.9 * s, w, 2);

    /* 演播室大窗：暖光 + DJ 剪影 */
    var wx = x0 + 0.8 * s, wy = baseY - 3.9 * s, ww = w - 1.6 * s, wh = 1.9 * s;
    var gg = ctx.createLinearGradient(0, wy, 0, wy + wh);
    gg.addColorStop(0, 'rgba(255,196,110,.92)');
    gg.addColorStop(1, 'rgba(214,132,60,.72)');
    ctx.fillStyle = gg;
    ctx.fillRect(wx, wy, ww, wh);

    /* 里面的人 */
    ctx.fillStyle = 'rgba(40,22,10,.85)';
    ctx.beginPath();
    ctx.arc(wx + ww * 0.42, wy + wh * 0.42, wh * 0.19, 0, TAU);
    ctx.fill();
    ctx.fillRect(wx + ww * 0.42 - wh * 0.26, wy + wh * 0.56, wh * 0.52, wh * 0.5);
    /* 麦克风 */
    ctx.strokeStyle = 'rgba(40,22,10,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.78, wy + wh);
    ctx.lineTo(wx + ww * 0.74, wy + wh * 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,22,10,.9)';
    ctx.fillRect(wx + ww * 0.72, wy + wh * 0.38, 2, wh * 0.14);

    /* 窗框分格 */
    ctx.fillStyle = 'rgba(12,16,22,.9)';
    ctx.fillRect(wx + ww * 0.5, wy, 3, wh);
    ctx.fillRect(wx, wy + wh, ww, 3);

    slot.vuBox = { x: wx + ww * 0.06, y: wy + wh * 0.66, w: ww * 0.2, h: wh * 0.22 };

    /* ON AIR 灯箱 */
    var ay = baseY - 5.5 * s;
    ctx.fillStyle = 'rgba(10,12,16,.95)';
    ctx.fillRect(x0 + w * 0.5 - 1.5 * s, ay, 3.0 * s, 0.85 * s);
    glowText('ON AIR', x0 + w * 0.5, ay + 0.46 * s, Math.round(0.42 * s), '#ff4d5e', 'center', 0.6 * s);

    /* 电台名牌 */
    ctx.fillStyle = 'rgba(8,12,17,.9)';
    ctx.fillRect(x0 + 0.6 * s, baseY - 1.35 * s, w - 3.4 * s, 1.15 * s);
    ctx.save();
    ctx.font = '700 ' + Math.round(0.36 * s) + 'px ' + FONT;
    ctx.fillStyle = C.neonAmber;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = C.neonAmber;
    ctx.shadowBlur = 0.4 * s;
    ctx.fillText('雨夜电台 · FM 98.7', x0 + 0.85 * s, baseY - 0.78 * s);
    ctx.restore();

    /* 门 */
    ctx.fillStyle = 'rgba(255,196,110,.5)';
    ctx.fillRect(x1 - 2.5 * s, baseY - 2.3 * s, 1.5 * s, 2.3 * s);
    ctx.strokeStyle = 'rgba(12,16,22,.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x1 - 2.5 * s, baseY - 2.3 * s, 1.5 * s, 2.3 * s);

    /* 屋顶：天线杆 + 卫星锅 */
    var rx = x0 + w * 0.34;
    ctx.strokeStyle = '#3a4756';
    ctx.lineWidth = Math.max(2, 0.08 * s);
    ctx.beginPath();
    ctx.moveTo(rx - 0.5 * s, top);
    ctx.lineTo(rx, top - 1.0 * s);
    ctx.lineTo(rx + 0.5 * s, top);
    ctx.moveTo(rx, top - 1.0 * s);
    ctx.lineTo(rx, top - 1.9 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx - 0.3 * s, top - 0.6 * s);
    ctx.lineTo(rx + 0.3 * s, top - 0.6 * s);
    ctx.stroke();

    var dx = x0 + w * 0.7, dy = top - 0.85 * s;
    ctx.fillStyle = '#5a6b7c';
    ctx.beginPath();
    ctx.ellipse(dx, dy, 0.5 * s, 0.68 * s, -0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b3542';
    ctx.beginPath();
    ctx.ellipse(dx, dy, 0.3 * s, 0.44 * s, -0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#5a6b7c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx + 0.42 * s, dy - 0.4 * s);
    ctx.stroke();

    slot.beacon = { x: rx, y: top - 2.0 * s };
    slot.dish = { x: dx, y: dy };
  }

  function animRadio(slot, x0, x1, baseY, s) {
    /* VU 表：随雨声起伏 */
    var box = slot.vuBox;
    if (box) {
      for (var i = 0; i < 5; i++) {
        var h = (0.25 + 0.75 * Math.abs(Math.sin(S.now * (1.6 + i * 0.7) + i))) * box.h;
        ctx.fillStyle = i < 4 ? C.neonGreen : '#ff8a5c';
        ctx.globalAlpha = 0.9;
        ctx.fillRect(box.x + i * (box.w / 5.6), box.y + box.h - h, box.w / 7.4, h);
      }
      ctx.globalAlpha = 1;
    }
    /* 塔顶红色警示灯 */
    if (slot.beacon) {
      var on = (S.now % 1.6) < 0.85;
      ctx.globalAlpha = on ? 0.95 : 0.18;
      ctx.fillStyle = '#ff4d5e';
      ctx.beginPath();
      ctx.arc(slot.beacon.x, slot.beacon.y, 0.1 * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------- 普通楼 --- */

  function drawPlain(g, x0, x1, baseY, s, slot) {
    var rnd = mulberry32(slot.seed);
    var w = x1 - x0;
    var top = shell(x0, x1, baseY, s, slot.h, slot.variant % 2 ? '#0d141c' : '#101821',
                    slot.variant % 2 ? '#121a24' : '#151e28');

    windows(x0, x1, top, baseY - 3.4 * s, s, rnd, {
      lit: 0.36, pitchX: 1.2, pitchY: 1.55, w: 0.68, h: 0.8,
      warm: slot.variant % 3 === 0 ? 0.4 : 0.85
    });

    /* 底层店面：卷帘门 / 小招牌 */
    var gy = baseY - 3.0 * s;
    ctx.fillStyle = '#0a0f15';
    ctx.fillRect(x0, gy, w, baseY - gy);

    if (slot.variant % 4 === 0) {
      /* 卷帘门 */
      ctx.fillStyle = '#151d26';
      ctx.fillRect(x0 + 0.4 * s, gy + 0.6 * s, w - 0.8 * s, 2.4 * s);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (var ry = gy + 0.7 * s; ry < baseY - 0.1 * s; ry += 0.3 * s) {
        ctx.fillRect(x0 + 0.4 * s, ry, w - 0.8 * s, 2);
      }
    } else {
      /* 亮着的小店 */
      var gg = ctx.createLinearGradient(0, gy, 0, baseY);
      gg.addColorStop(0, 'rgba(255,205,130,.42)');
      gg.addColorStop(1, 'rgba(255,150,70,.12)');
      ctx.fillStyle = gg;
      ctx.fillRect(x0 + 0.5 * s, gy + 0.5 * s, w - 1.0 * s, 2.3 * s);
      ctx.fillStyle = 'rgba(10,14,20,.9)';
      ctx.fillRect(x0 + w * 0.5 - 1, gy + 0.5 * s, 3, 2.3 * s);
    }

    /* 雨篷 */
    ctx.fillStyle = slot.variant % 3 === 0 ? '#5a2a33' : '#243344';
    ctx.fillRect(x0 + 0.25 * s, gy - 0.28 * s, w - 0.5 * s, 0.28 * s);
  }

  /* --------------------------------------------------------------- 人物 --- */

  /* 在「脚底原点、向上为负、单位为世界单位」的空间里画一个连帽衫男子 */
  function walkerBody(g, ph, bodyColor) {
    var hoodie = bodyColor || C.hoodie;
    var hoodieHi = bodyColor || C.hoodieHi;
    var pants = bodyColor || C.pants;
    var shoe = bodyColor || C.shoe;
    var skin = bodyColor || C.skin;

    var HIP = -0.86, SHO = -1.40, HEAD = -1.585;

    function seg(ax, ay, bx, by, w, color) {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }

    /* --- 腿 --- */
    function leg(p, front) {
      var thigh = 0.52 * Math.sin(p);
      var knee = 0.66 * Math.max(0, Math.sin(p - 1.15));
      var kx = 0.46 * Math.sin(thigh);
      var ky = HIP + 0.46 * Math.cos(thigh);
      var shin = thigh - knee;
      var ax = kx + 0.44 * Math.sin(shin);
      var ay = ky + 0.44 * Math.cos(shin);

      seg(0, HIP, kx, ky, 0.145, pants);
      seg(kx, ky, ax, ay, 0.125, pants);

      /* 鞋 */
      g.fillStyle = shoe;
      g.beginPath();
      g.moveTo(ax - 0.055, ay - 0.02);
      g.lineTo(ax - 0.06, ay + 0.055);
      g.lineTo(ax + 0.20, ay + 0.055);
      g.quadraticCurveTo(ax + 0.25, ay + 0.05, ax + 0.24, ay - 0.01);
      g.lineTo(ax + 0.06, ay - 0.075);
      g.closePath();
      g.fill();
      return front ? { x: ax, y: ay } : null;
    }

    /* 后腿先画 */
    leg(ph + Math.PI, false);

    /* --- 躯干（略前倾） --- */
    g.save();
    g.translate(0, HIP);
    g.rotate(-0.055);
    g.translate(0, -HIP);

    g.fillStyle = hoodie;
    g.beginPath();
    var tw = 0.175;
    var ty0 = HIP - 0.02, ty1 = SHO - 0.09;
    g.moveTo(-tw, ty0);
    g.lineTo(tw, ty0);
    g.lineTo(tw + 0.02, ty1);
    g.quadraticCurveTo(0.02, ty1 - 0.06, -tw + 0.02, ty1);
    g.closePath();
    g.fill();

    /* 连帽衫口袋 */
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 0.02;
    g.beginPath();
    g.moveTo(-0.12, HIP - 0.16);
    g.quadraticCurveTo(0, HIP - 0.24, 0.14, HIP - 0.14);
    g.stroke();

    /* --- 远侧手臂 --- */
    function arm(p, color) {
      var up = 0.46 * Math.sin(p + Math.PI);
      var ex = -0.01 + 0.30 * Math.sin(up);
      var ey = SHO + 0.30 * Math.cos(up);
      var fore = up + 0.42;
      var hx = ex + 0.27 * Math.sin(fore);
      var hy = ey + 0.27 * Math.cos(fore);
      seg(-0.01, SHO, ex, ey, 0.12, color);
      seg(ex, ey, hx, hy, 0.10, color);
      g.fillStyle = color;
      g.beginPath();
      g.arc(hx, hy, 0.072, 0, TAU);
      g.fill();
    }

    arm(ph + 0.5, bodyColor || '#232b36');   /* 后臂暗一点 */

    /* --- 兜帽 + 头 --- */
    g.fillStyle = hoodie;
    g.beginPath();
    g.arc(0.10, HEAD + 0.02, 0.152, 0, TAU);       /* 脸侧的帽兜 */
    g.arc(-0.035, HEAD + 0.055, 0.125, 0, TAU);    /* 后脑的帽子 */
    g.fill();

    /* 帽檐下沿 */
    g.fillStyle = bodyColor || '#232b36';
    g.beginPath();
    g.moveTo(-0.14, HEAD + 0.13);
    g.quadraticCurveTo(0.05, HEAD + 0.22, 0.21, HEAD + 0.12);
    g.lineTo(0.16, HEAD + 0.03);
    g.quadraticCurveTo(0.02, HEAD + 0.13, -0.10, HEAD + 0.06);
    g.closePath();
    g.fill();

    /* 兜帽开口：很暗，只留一点下巴 */
    g.fillStyle = bodyColor || '#070a0e';
    g.beginPath();
    g.ellipse(0.115, HEAD + 0.035, 0.055, 0.078, -0.12, 0, TAU);
    g.fill();
    if (!bodyColor) {
      g.fillStyle = hexA(C.skin, 0.55);
      g.beginPath();
      g.ellipse(0.128, HEAD + 0.085, 0.026, 0.024, 0, 0, TAU);
      g.fill();
    }

    /* 抽绳 */
    if (!bodyColor) {
      g.strokeStyle = 'rgba(210,220,232,.45)';
      g.lineWidth = 0.014;
      g.beginPath();
      g.moveTo(0.055, HEAD + 0.13);
      g.lineTo(0.045, HEAD + 0.29);
      g.moveTo(0.10, HEAD + 0.14);
      g.lineTo(0.115, HEAD + 0.30);
      g.stroke();
    }

    /* --- 近侧手臂 --- */
    arm(ph, hoodieHi);

    g.restore();

    /* 前腿最后画，压在躯干上 */
    leg(ph, true);
  }

  function drawPlayer() {
    var s = scaleAt(PLAYER_Z);
    var px = screenX(player.x, PLAYER_Z);
    var py = groundY(PLAYER_Z);
    if (px < -s * 4 || px > S.W + s * 4) return;

    /* 地面投影 */
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    ctx.ellipse(px, py - 0.02 * s, 0.34 * s, 0.09 * s, 0, 0, TAU);
    ctx.fill();

    /* 湿地面上的倒影：翻转并压扁 */
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.translate(px, py);
    ctx.scale(player.dir * s, -s * 0.52);
    ctx.translate(0, 0.02);
    walkerBody(ctx, player.phase, null);
    ctx.restore();

    /* 霓虹边缘光：整体偏移两个像素先画一遍，露出的边就成了描边 */
    ctx.save();
    ctx.translate(px - 2.2 * player.dir, py - 2.2);
    ctx.scale(player.dir * s, s);
    ctx.globalAlpha = 0.55;
    walkerBody(ctx, player.phase, '#7fd8ff');
    ctx.restore();

    /* 本体 */
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(player.dir * s, s);
    walkerBody(ctx, player.phase, null);
    ctx.restore();
  }

  /* --------------------------------------------------------------- 主循环 --- */

  function drawBackdropClear() {
    /* 画布保持透明：天空、云、远处的雨由底下的主场景负责 */
  }

  function draw() {
    var s = scaleAt(FACADE_Z);
    var baseY = groundY(FACADE_Z);
    var i, slot;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.W, S.H);

    drawBackdrop();

    /* 近景店面（都在同一深度，左右相邻，不会互相遮挡） */
    var x0, x1;
    for (i = 0; i < street.slots.length; i++) {
      slot = street.slots[i];
      x0 = screenX(slot.x, FACADE_Z);
      x1 = screenX(slot.x + slot.w, FACADE_Z);
      if (x1 < -80 || x0 > S.W + 80) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, baseY);
      ctx.clip();
      if (slot.kind === 'landmark') slot.def.draw(ctx, x0, x1, baseY, s, slot);
      else drawPlain(ctx, x0, x1, baseY, s, slot);
      ctx.restore();
    }

    drawSidewalk();

    /* 招牌在湿地上的光斑 */
    for (i = 0; i < street.slots.length; i++) {
      slot = street.slots[i];
      if (slot.kind !== 'landmark' || !slot.spill) continue;
      x0 = screenX(slot.x, FACADE_Z);
      x1 = screenX(slot.x + slot.w, FACADE_Z);
      if (x1 < -80 || x0 > S.W + 80) continue;
      drawSpill(x0, x1, baseY, s, slot.spill, 1);
    }

    /* 地标上会动的部分 */
    for (i = 0; i < street.slots.length; i++) {
      slot = street.slots[i];
      if (slot.kind !== 'landmark') continue;
      x0 = screenX(slot.x, FACADE_Z);
      x1 = screenX(slot.x + slot.w, FACADE_Z);
      if (x1 < -80 || x0 > S.W + 80) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, baseY);
      ctx.clip();
      if (slot.def.anim) slot.def.anim(slot, x0, x1, baseY, s);
      ctx.restore();
    }

    drawPlayer();
    drawRain();
  }

  function frame(ts) {
    if (!S.running) return;

    var now = typeof ts === 'number' ? ts : performance.now();
    var dt = S.last ? (now - S.last) / 1000 : 0.016;
    S.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    S.raf = requestAnimationFrame(frame);

    /* 跟随主场景的「动效」开关 */
    var city = window.RainyCity;
    var motion = city ? city.isMotion() : true;
    if (!motion) { draw(); return; }

    S.now = now / 1000;

    /* 行走：按住方向键时听用户的，松手就自动向前；
       走到街道两端就掉头，这样街道不必首尾相接也能一直走下去。 */
    if (player.steer !== 0) {
      player.dir = player.steer;
    } else if (player.x <= 0.6) {
      player.dir = 1;
    } else if (player.x >= street.length - 0.6) {
      player.dir = -1;
    }

    player.phase += dt * player.speed * 4.4;
    if (player.phase > TAU * 1000) player.phase -= TAU * 1000;
    player.x = clamp(player.x + player.speed * dt * player.dir, 0, street.length);

    /* 镜头：让人物落在画面偏左处 */
    var lead = S.W * LEAD * PLAYER_Z / FOCAL;
    cam.x = player.x + lead;
    cam.sx = cam.x;

    updateRain(dt);
    draw();

    /* 雷闪时整体提亮一点，和底下的主场景对上 */
    if (city && city.flashLevel) {
      var f = city.flashLevel();
      if (f > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(f * 0.22, 0.18);
        ctx.fillStyle = '#cfe3f4';
        ctx.fillRect(0, 0, S.W, S.H);
        ctx.restore();
      }
    }
  }

  /* --------------------------------------------------------------- 尺寸 --- */

  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    S.W = W; S.H = H; S.dpr = dpr;
    S.horizon = H * 0.46;
    S.K = FOCAL * CAM_H;

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildDrops();
    buildPuddles();
    draw();
  }

  /* ------------------------------------------------------------ 对外接口 --- */

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (!S.active) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  function nearest() {
    var best = null, bd = 1e9;
    for (var i = 0; i < street.slots.length; i++) {
      var sl = street.slots[i];
      if (sl.kind !== 'landmark') continue;
      var c = sl.x + sl.w * 0.5;
      var d = Math.abs(c - (player.x + 1.4));
      if (d < bd) { bd = d; best = sl; }
    }
    return best;
  }

  window.RainyWalk = {
    isActive: function () { return S.active; },

    enter: function () {
      if (S.active) return;
      S.active = true;
      canvas.classList.add('is-on');
      resize();
      S.last = 0;
      if (!S.running) {
        S.running = true;
        S.raf = requestAnimationFrame(frame);
      }
      var city = window.RainyCity;
      if (city && city.setCityVisible) city.setCityVisible(false);
    },

    exit: function () {
      if (!S.active) return;
      S.active = false;
      canvas.classList.remove('is-on');
      S.running = false;
      cancelAnimationFrame(S.raf);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var city = window.RainyCity;
      if (city && city.setCityVisible) city.setCityVisible(true);
    },

    /* 导航只列四个地点 */
    list: function () {
      var seen = {}, out = [];
      for (var i = 0; i < marks.length; i++) {
        if (seen[marks[i].id]) continue;
        seen[marks[i].id] = 1;
        out.push({ name: marks[i].name, id: marks[i].id });
      }
      return out;
    },

    /* 走到第 i 个地点最近的那一处前面 */
    jumpTo: function (i) {
      var ids = this.list();
      var want = ids[i] && ids[i].id;
      if (!want) return;
      if (!S.active) this.enter();

      var best = null, bd = 1e9;
      for (var k = 0; k < marks.length; k++) {
        if (marks[k].id !== want) continue;
        var c = marks[k].slot.x + marks[k].slot.w * 0.5;
        var d = c - player.x;
        if (d < -0.5) d += street.length;   // 落在身后的算成一整圈的距离
        if (d < bd) { bd = d; best = marks[k]; }
      }
      if (!best) return;

      var lead = S.W * LEAD * PLAYER_Z / FOCAL;
      player.x = clamp(best.slot.x + best.slot.w * 0.5 - 1.2 - lead, 0, street.length);
      cam.x = player.x + lead;
      cam.sx = cam.x;
    },

    current: function () {
      var n = nearest();
      return n ? { name: n.def.name, id: n.def.id } : null;
    },

    /* 方向：-1 往左，1 往右，0 交回自动 */
    steer: function (d) { player.steer = d < 0 ? -1 : d > 0 ? 1 : 0; }
  };

  buildStreet();
})();
