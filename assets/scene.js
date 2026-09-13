/* ==========================================================================
   雨城 · Rainy City — 实时绘制的像素雨夜城市
   --------------------------------------------------------------------------
   全部画面由 Canvas 2D 逐帧绘制，没有任何背景图片：
     · 天空      石板蓝渐变 + 极淡的城市底光
     · 云层      三条扇贝形云带，各自不同速度漂移（视差）
     · 楼群      远近两层黑色剪影，金色窗格随机点亮
     · 雨        数百条按风向斜落的雨丝，远近不同粗细与透明度
     · 雷闪      随机间隔的多次短闪，先照亮云层再轻微提亮全屏
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  if (!canvas) return;

  var ctx = canvas.getContext('2d', { alpha: false });
  var flashEl = document.getElementById('flash');
  var TAU = Math.PI * 2;

  /* 楼群画布左右各留出的余量，用于视差位移时不露边 */
  var MARGIN = 80;
  /* 楼体向画布下方多延伸的高度，防止上移后露空 */
  var EXTRA_BOTTOM = 90;

  /* 这里的主角就是会动的雨夜，所以默认始终播放，不受系统「减少动态效果」影响——
     那个偏好只作为提示暴露出去，让用户用控制台里的「动效」按钮自己决定停不停。 */
  var prefersLess = false;
  try {
    prefersLess = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) { /* 忽略 */ }

  var COLOR = {
    skyTop:     '#36485a',
    skyMid:     '#28353f',
    skyLow:     '#1a222a',
    cloudDark:  '#6e6e6e',
    cloudMid:   '#a9a9a9',
    cloudLight: '#d6d6d6',
    far:        '#0a1219',
    near:       '#000000',
    window:     '#ffdd2b'
  };

  /* ------------------------------------------------------------- 随机数 --- */
  /* 固定种子：每次刷新城市的轮廓都一样，只有窗灯在变 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------------- 状态 --- */

  var state = {
    W: 0, H: 0, dpr: 1, scale: 1,
    bands: [],
    city: { canvas: null, w: 0, h: 0 },
    buildings: [],
    flickers: [],
    drops: [],
    intensity: 0.93,          // 0 – 1.6
    lightningOn: true,
    cityVisible: true,
    flash: 0,
    nextStrike: 0,
    strikeAt: -1e9,
    scrollY: 0,
    scrollSmooth: 0,
    px: 0, py: 0,             // 指针目标 -1 – 1
    sx: 0, sy: 0,             // 平滑后的指针
    running: false,
    motion: true,
    visible: true,
    last: 0,
    rafId: 0
  };

  /* ------------------------------------------------------------- 尺寸 --- */

  function resize() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    state.W = W;
    state.H = H;
    state.dpr = dpr;
    /* 以视口高度为基准，保证不同屏幕上云与窗格的相对比例一致 */
    state.scale = Math.max(0.55, Math.min(H / 900, 2.2));

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildClouds();
    buildCity();
    buildDrops();
  }

  /* --------------------------------------------------------------- 云层 --- */

  function buildClouds() {
    var H = state.H;
    /* 绘制顺序就是层叠顺序：先画最下面那条暗云，再往上盖亮的 */
    state.bands = [
      { base: 0.186 * H, r: 0.080 * H, color: COLOR.cloudDark,  speed:  7.0, detail: 0.62, phase:  0 },
      { base: 0.120 * H, r: 0.062 * H, color: COLOR.cloudMid,   speed: -4.6, detail: 0.62, phase: 53 },
      { base: 0.052 * H, r: 0.048 * H, color: COLOR.cloudLight, speed:  3.0, detail: 0.62, phase: 19 }
    ];
  }

  function drawBand(band, dx, dy) {
    var W = state.W;
    var r = band.r;
    var period = r * 2.06;
    var base = band.base + dy;
    var off = ((dx % period) + period) % period;
    var startX = -period * 2 + off;
    var endX = W + period * 2;
    var fx = startX + period * 0.5;
    var x;

    ctx.beginPath();
    /* 从画布顶部一路填到基准线 */
    ctx.rect(-MARGIN * 4, -state.H * 2, W + MARGIN * 8, base + state.H * 2);

    for (x = startX; x < endX; x += period) {
      ctx.moveTo(x + r, base);
      ctx.arc(x, base, r, 0, TAU);
    }
    /* 半格错开的第二排，做出鱼鳞一样的双层扇贝 */
    var fr = r * band.detail;
    var fy = base + r * 0.20;
    for (x = fx; x < endX; x += period) {
      ctx.moveTo(x + fr, fy);
      ctx.arc(x, fy, fr, 0, TAU);
    }

    ctx.fillStyle = band.color;
    ctx.fill();
  }

  /* --------------------------------------------------------------- 楼群 --- */

  function buildCity() {
    var W = state.W, H = state.H, rnd = mulberry32(20260913);
    var bottom = H + EXTRA_BOTTOM;
    var layers = [
      { color: COLOR.far,  lit: 0.26, minH: 0.26, maxH: 0.60, minW: 0.055, maxW: 0.115, alpha: 0.55 },
      { color: COLOR.near, lit: 0.40, minH: 0.34, maxH: 0.82, minW: 0.062, maxW: 0.145, alpha: 1 }
    ];
    var all = [];
    var li, i;

    for (li = 0; li < layers.length; li++) {
      var L = layers[li];
      var arr = [];
      var x = -0.12 * W - MARGIN;

      while (x < W + 0.12 * W + MARGIN) {
        var w = (L.minW + rnd() * (L.maxW - L.minW)) * H;
        var h = (L.minH + rnd() * (L.maxH - L.minH)) * H;
        if (rnd() < 0.14) h *= 1.24;                    // 偶尔冒出一座高塔
        h = Math.min(h, H * 0.97);
        arr.push({ x: x, w: w, y: bottom - h, layer: li, lit: L.lit, alpha: L.alpha, color: L.color });
        x += w * (0.74 + rnd() * 0.40);                 // 相邻楼体部分重叠
      }
      all.push(arr);
    }

    state.buildings = all;
    renderCityLayer();
  }

  function renderCityLayer() {
    var W = state.W, H = state.H, dpr = state.dpr;
    var rnd = mulberry32(777001);
    var bw = W + MARGIN * 2;
    var bh = H + EXTRA_BOTTOM;

    var cv = document.createElement('canvas');
    cv.width = Math.round(bw * dpr);
    cv.height = Math.round(bh * dpr);
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 以视口高度决定窗格尺寸 */
    var cellW = 0.0152 * H;
    var cellH = 0.0192 * H;
    var win   = 0.0128 * H;
    var padX  = 0.020 * H;
    var padY  = 0.026 * H;

    var flickers = [];

    for (var li = 0; li < state.buildings.length; li++) {
      var arr = state.buildings[li];
      var isNear = (li === state.buildings.length - 1);

      for (var i = 0; i < arr.length; i++) {
        var b = arr[i];
        /* 楼体在带余量的画布上的位置 —— 窗格必须用同一套坐标，否则窗会飘到楼外面去 */
        var bx = b.x + MARGIN;
        c.fillStyle = b.color;
        c.fillRect(bx, b.y, b.w, bh - b.y);

        var left = bx + padX;
        var right = bx + b.w - padX;
        var cols = Math.floor((right - left) / cellW);
        var rows = Math.floor((bh - win - (b.y + padY)) / cellH);
        if (cols < 1 || rows < 1) continue;

        /* 该楼右侧没有被后一栋近景楼遮住的范围（同样换算到画布坐标） */
        var visRight = Infinity;
        if (isNear && i + 1 < arr.length) visRight = arr[i + 1].x + MARGIN;

        var r, col, runStart, runLen;

        for (r = 0; r < rows; r++) {
          var wy = b.y + padY + r * cellH;
          col = 0;
          while (col < cols) {
            if (rnd() > b.lit) { col++; continue; }

            runStart = col;
            /* 有一成的机会顺手点亮右边一两格，连成一条亮带 */
            runLen = 1;
            if (rnd() < 0.26) runLen = 2;
            if (runLen === 1 && rnd() < 0.10) runLen = 3;
            if (runStart + runLen > cols) runLen = cols - runStart;

            var wx = left + runStart * cellW;
            var ww = win + (runLen - 1) * cellW;

            /* 吸附到整像素：窗格要的是方块，不是抗锯齿的糊边 */
            var rx = Math.round(wx);
            var ry = Math.round(wy);
            var rw = Math.max(1, Math.round(ww));
            var rh = Math.max(1, Math.round(win));

            /* 只有近景、且没有被遮挡的亮带才会随机明灭 */
            var willFlicker = isNear && wx + ww <= visRight && rnd() < 0.085;

            if (willFlicker) {
              /* 会明灭的窗格不进烘焙层 —— 灭的时候什么都不画。
                 之前是「先烘焙再涂黑盖掉」，但楼群整层会被 drawImage 重采样，
                 黑色盖不住抗锯齿留下的黄边，关灯后就会剩一个淡淡的小方框。
                 存坐标时换回场景坐标：主画布上画它时会再叠一次视差位移。 */
              flickers.push({
                x: rx - MARGIN, y: ry, w: rw, h: rh,
                on: true,
                next: performance.now() + 400 + Math.random() * 5000
              });
            } else {
              c.globalAlpha = b.alpha;
              c.fillStyle = COLOR.window;
              c.fillRect(rx, ry, rw, rh);
              c.globalAlpha = 1;
            }

            col += runLen;
          }
        }
      }
    }

    state.city.canvas = cv;
    state.city.w = bw;
    state.city.h = bh;
    state.flickers = flickers;
  }

  /* --------------------------------------------------------------- 雨 --- */

  function rainCount() {
    var area = state.W * state.H;
    var max = Math.max(120, Math.min(Math.round(area / 7000), 620));
    return Math.round(max * state.intensity);
  }

  function makeDrop(seeded) {
    var d = Math.pow(Math.random(), 0.7);        // 多数是远景细雨
    var depth = 0.15 + d * 0.85;
    var speed = (380 + depth * 620) * state.scale;
    return {
      x: Math.random() * (state.W + 260) - 130,
      y: seeded ? Math.random() * state.H : -30 - Math.random() * 140,
      vx: -speed * 0.145,
      vy: speed,
      len: (12 + depth * 38) * state.scale,
      w: depth > 0.72 ? 1.7 : 1,
      a: 0.13 + depth * 0.46
    };
  }

  function buildDrops() {
    var n = Math.max(rainCount(), 40);
    state.drops = [];
    for (var i = 0; i < n; i++) state.drops.push(makeDrop(true));
  }

  function syncDrops() {
    var want = rainCount();
    var cur = state.drops.length;
    while (cur < want) { state.drops.push(makeDrop(true)); cur++; }
    if (cur > want) state.drops.length = want;
  }

  function drawRain(dt) {
    var W = state.W, H = state.H;
    var drops = state.drops;
    var buckets = [[], [], [], []];

    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.y > H + 40 || d.x < -160) {
        d.y = -30 - Math.random() * 160;
        d.x = Math.random() * (W + 320) - 130;
        d.vy = d.vy;                              // 保持原速度
      }

      var b = d.a < 0.3 ? 0 : d.a < 0.45 ? 1 : d.a < 0.6 ? 2 : 3;
      buckets[b].push(d);
    }

    var alphas = [0.20, 0.33, 0.46, 0.62];
    var widths = [0.9, 1.1, 1.35, 1.8];
    ctx.lineCap = 'round';

    for (var k = 0; k < 4; k++) {
      var arr = buckets[k];
      if (!arr.length) continue;
      ctx.globalAlpha = alphas[k];
      ctx.strokeStyle = '#d5ecfa';
      ctx.lineWidth = widths[k];
      ctx.beginPath();
      for (var j = 0; j < arr.length; j++) {
        var p = arr[j];
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len * 0.145, p.y - p.len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- 天空 --- */

  function drawSky() {
    var W = state.W, H = state.H;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLOR.skyTop);
    g.addColorStop(0.42, COLOR.skyMid);
    g.addColorStop(1, COLOR.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(-MARGIN * 4, -H, W + MARGIN * 8, H * 2);

    /* 城市底光：楼群根部一点点暖色雾气 */
    var rg = ctx.createRadialGradient(W * 0.5, H * 1.06, 0, W * 0.5, H * 1.06, H * 0.95);
    rg.addColorStop(0, 'rgba(255,214,60,.10)');
    rg.addColorStop(0.55, 'rgba(255,214,60,.03)');
    rg.addColorStop(1, 'rgba(255,214,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(-MARGIN * 4, 0, W + MARGIN * 8, H);
  }

  /* --------------------------------------------------------------- 雷闪 --- */

  function strikeAlpha(t) {
    if (t < 0 || t > 620) return 0;
    if (t < 55)  return 0.34 * (t / 55);
    if (t < 130) return 0.34 * (1 - (t - 55) / 75);
    if (t < 195) return 0.52 * ((t - 130) / 65);
    if (t < 300) return 0.52 * (1 - (t - 195) / 105);
    if (t < 350) return 0.20;
    if (t < 600) return 0.20 * (1 - (t - 350) / 250);
    return 0;
  }

  function updateLightning(now) {
    var lit = 0;

    if (state.lightningOn && state.intensity > 0.08) {
      if (now >= state.nextStrike) {
        state.strikeAt = now;
        state.nextStrike = now + 6000 + Math.random() * 12000;
        if (Audio.ready && Audio.enabled) Audio.thunder();
      }
      lit = strikeAlpha(now - state.strikeAt);
    }
    state.flash = lit;

    /* 云层与天空先被照亮（画在楼群之前），楼体只被极轻微提亮 */
    if (lit > 0) {
      ctx.globalAlpha = Math.min(lit, 0.6);
      ctx.fillStyle = '#e8f1fb';
      ctx.fillRect(-MARGIN * 4, -state.H, state.W + MARGIN * 8, state.H * 2);
      ctx.globalAlpha = Math.min(lit * 0.16, 0.12);
      ctx.fillStyle = '#cfe3f4';
      ctx.fillRect(-MARGIN * 4, -state.H, state.W + MARGIN * 8, state.H * 2);
      ctx.globalAlpha = 1;
    }

    if (flashEl) flashEl.style.opacity = (lit * 0.16).toFixed(3);
  }

  /* --------------------------------------------------------------- 主循环 --- */

  function frame(ts) {
    var now = typeof ts === 'number' ? ts : performance.now();
    var dt = state.last ? (now - state.last) / 1000 : 0.016;
    state.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    /* 循环常驻；「动效」关掉时只是不再重画，所以再打开一定立刻恢复 */
    state.rafId = requestAnimationFrame(frame);
    if (!state.motion) return;

    /* 指针与滚动的平滑 */
    state.sx += (state.px - state.sx) * Math.min(1, dt * 3.2);
    state.sy += (state.py - state.sy) * Math.min(1, dt * 3.2);
    state.scrollSmooth += (state.scrollY - state.scrollSmooth) * Math.min(1, dt * 4);

    var sc = Math.max(-1, Math.min(1, state.scrollSmooth / 900));
    var cloudY = -sc * 26;
    /* 楼群整像素平移：drawImage 不重采样，窗格才是清楚的小方块 */
    var cityY  = Math.round(-sc * 12);
    var cityX  = Math.round(state.sx * 7);
    var t = now / 1000;

    ctx.save();

    drawSky();

    /* 云层：速度 + 指针视差，越靠下的云走得越快 */
    for (var i = 0; i < state.bands.length; i++) {
      var b = state.bands[i];
      var dx = b.phase + t * b.speed - state.sx * (16 - i * 4) * state.scale;
      var dy = cloudY * (1 - i * 0.22);
      drawBand(b, dx, dy);
    }

    /* 楼群与窗灯：街景漫步模式下要让出地平线，只留天空、云和雨 */
    if (state.cityVisible) {
      if (state.city.canvas) {
        ctx.drawImage(state.city.canvas, -MARGIN + cityX, cityY, state.city.w, state.city.h);
      }

      /* 窗灯：会明灭的那些没有烘焙进楼群，所以这里只负责「点亮」。
         灭掉就是不再画它 —— 楼体本来就是黑的，不会留下任何痕迹。 */
      var fl = state.flickers;
      if (fl.length) {
        ctx.fillStyle = COLOR.window;
        for (var f = 0; f < fl.length; f++) {
          var fw = fl[f];
          if (now >= fw.next) {
            fw.on = !fw.on;
            fw.next = now + 500 + Math.random() * 5200;
          }
          if (fw.on) ctx.fillRect(fw.x + cityX, fw.y + cityY, fw.w, fw.h);
        }
      }
    }

    /* 雨 */
    drawRain(dt);

    /* 雷闪 */
    updateLightning(now);

    ctx.restore();
  }

  function startLoop() {
    if (state.running) return;
    state.running = true;
    state.last = 0;
    state.rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
  }

  /* --------------------------------------------------------------- 音频 --- */

  var Audio = {
    ready: false,
    enabled: false,
    ctx: null,
    master: null,
    noise: null,
    gain: null,

    init: function () {
      if (this.ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) { return; }

      var ctxA = this.ctx;
      var len = Math.floor(ctxA.sampleRate * 3);
      var buf = ctxA.createBuffer(1, len, ctxA.sampleRate);
      var data = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;      // 轻微的布朗化，更像雨而不是电流声
        data[i] = white * 0.7 + last * 3.5;
      }
      this.noise = buf;

      var master = ctxA.createGain();
      master.gain.value = 0;
      master.connect(ctxA.destination);
      this.master = master;

      /* 主雨声：噪声过低通 */
      var src = ctxA.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var lp = ctxA.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      lp.Q.value = 0.6;
      var shelf = ctxA.createBiquadFilter();
      shelf.type = 'highpass';
      shelf.frequency.value = 220;

      var g = ctxA.createGain();
      g.gain.value = 0.5;

      src.connect(shelf);
      shelf.connect(lp);
      lp.connect(g);
      g.connect(master);
      src.start(0);

      this.ready = true;
      this.setLevel();
    },

    setEnabled: function (on) {
      this.enabled = !!on;
      if (this.enabled) {
        this.init();
        if (!this.ready) { this.enabled = false; return false; }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      }
      if (!this.ready) return false;
      var t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.enabled ? this.level() : 0, t, 0.25);
      return this.enabled;
    },

    level: function () {
      return 0.10 + Math.min(state.intensity, 1.6) * 0.16;
    },

    setLevel: function () {
      if (!this.ready || !this.enabled) return;
      var t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.level(), t, 0.2);
    },

    thunder: function () {
      if (!this.ready || !this.enabled) return;
      var c = this.ctx;
      var t = c.currentTime + 0.05 + Math.random() * 0.35;

      var s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;

      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(520, t);
      lp.frequency.exponentialRampToValueAtTime(85, t + 2.4);

      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);

      s.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      s.start(t);
      s.stop(t + 3);
    }
  };

  /* --------------------------------------------------------------- 事件 --- */

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  window.addEventListener('scroll', function () {
    state.scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  }, { passive: true });

  if (window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', function (e) {
      state.px = (e.clientX / window.innerWidth) * 2 - 1;
      state.py = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopLoop(); else startLoop();
  });

  /* --------------------------------------------------------------- 对外接口 --- */

  window.RainyCity = {
    prefersReduced: prefersLess,
    setRain: function (v) {
      state.intensity = Math.max(0, Math.min(1.6, v / 100 * 1.6));
      syncDrops();
      Audio.setLevel();
    },
    setLightning: function (on) {
      state.lightningOn = !!on;
      if (!on) {
        if (flashEl) flashEl.style.opacity = '0';
        state.strikeAt = -1e9;
      }
    },
    setSound: function (on) { return Audio.setEnabled(on); },
    setMotion: function (on) { state.motion = !!on; },
    isMotion: function () { return state.motion; },
    /* 街景漫步模式会临时关掉楼群，把地平线让出来 */
    setCityVisible: function (v) { state.cityVisible = !!v; },
    flashLevel: function () { return state.flash; },
    strikeNow: function () { state.strikeAt = performance.now(); }
  };

  /* --------------------------------------------------------------- 启动 --- */

  resize();
  state.nextStrike = performance.now() + 2400;
  startLoop();
})();
