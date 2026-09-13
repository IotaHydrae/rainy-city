/* ==========================================================================
   雨城 · Rainy City — 页面交互
   控制台 / 天气读数 / 时钟 / 沉浸模式 / 滚动出现
   ========================================================================== */
(function () {
  'use strict';

  var city = window.RainyCity;

  var $ = function (id) { return document.getElementById(id); };

  var rainSlider      = $('rainSlider');
  var lightningToggle = $('lightningToggle');
  var soundToggle     = $('soundToggle');
  var immersiveToggle = $('immersiveToggle');
  var immersiveBtn    = $('immersiveBtn');

  var weatherLabel = $('weatherLabel');
  var weatherRate  = $('weatherRate');
  var weatherTemp  = $('weatherTemp');
  var statRain     = $('statRain');
  var statTemp     = $('statTemp');
  var statWind     = $('statWind');
  var statVis      = $('statVis');
  var clockEl      = $('clock') || document.querySelector('.clock');

  /* ------------------------------------------------------------ 雨量读数 --- */

  /* 滑杆 → 毫米每小时：用一点曲率，让小雨区间更有手感 */
  function toRate(v) {
    return Math.pow(v / 100, 1.5) * 32;
  }

  function labelFor(v) {
    if (v <= 0.5) return '无雨';
    if (v < 28)  return '小雨';
    if (v < 62)  return '中雨';
    if (v < 86)  return '大雨';
    return '暴雨';
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  var base = { temp: 11.6, wind: 5.2 };
  var mm = toRate(58);

  function render(jitter) {
    var v = Number(rainSlider ? rainSlider.value : 58);
    mm = toRate(v);

    var temp = base.temp + (jitter ? (Math.random() - 0.5) * 0.6 : 0);
    var wind = base.wind + (jitter ? (Math.random() - 0.5) * 0.8 : 0);
    var vis  = clamp(9.4 - mm * 0.26, 0.5, 10);

    if (weatherLabel) weatherLabel.textContent = labelFor(v);
    if (weatherRate)  weatherRate.textContent  = mm.toFixed(1);
    if (weatherTemp)  weatherTemp.textContent  = temp.toFixed(1);

    if (statRain) statRain.textContent = mm.toFixed(1);
    if (statTemp) statTemp.textContent = temp.toFixed(1);
    if (statWind) statWind.textContent = Math.max(0.2, wind).toFixed(1);
    if (statVis)  statVis.textContent  = vis.toFixed(1);
  }

  /* ---------------------------------------------------------------- 滑杆 --- */

  if (rainSlider) {
    var apply = function () {
      var v = Number(rainSlider.value);
      rainSlider.style.setProperty('--fill', v + '%');
      if (city) city.setRain(v);
      render(false);
    };

    rainSlider.addEventListener('input', apply);
    apply();
  } else {
    render(false);
  }

  /* ------------------------------------------------------------ 开关按钮 --- */

  function bindToggle(el, onChange) {
    if (!el) return;
    el.addEventListener('click', function () {
      var next = el.getAttribute('aria-pressed') !== 'true';
      el.setAttribute('aria-pressed', String(next));
      onChange(next);
    });
  }

  bindToggle(lightningToggle, function (on) {
    if (city) city.setLightning(on);
  });

  /* 雨声：浏览器给不出 AudioContext 时，按钮不能假装已经打开 */
  function setSound(on) {
    var ok = city ? city.setSound(on) : false;
    if (soundToggle) {
      soundToggle.setAttribute('aria-pressed', String(!!ok));
      if (on && !ok) soundToggle.title = '当前浏览器不支持雨声';
    }
    return !!ok;
  }

  if (soundToggle) {
    soundToggle.addEventListener('click', function () {
      setSound(soundToggle.getAttribute('aria-pressed') !== 'true');
    });
  }

  var motionToggle = $('motionToggle');
  bindToggle(motionToggle, function (on) {
    if (city) city.setMotion(on);
  });

  /* ------------------------------------------------------------ 沉浸模式 --- */

  function setImmersive(on) {
    document.body.classList.toggle('is-immersive', on);

    if (immersiveToggle) immersiveToggle.setAttribute('aria-pressed', String(on));
    if (immersiveBtn) immersiveBtn.textContent = on ? '退出雨夜' : '进入雨夜';

    if (on) {
      /* 记录当前位置，退出时回到原处 */
      document.body.dataset.scroll = String(window.pageYOffset || 0);
    } else {
      var y = Number(document.body.dataset.scroll || 0);
      window.scrollTo(0, y);
    }
  }

  if (immersiveBtn) {
    immersiveBtn.addEventListener('click', function () {
      setImmersive(!document.body.classList.contains('is-immersive'));
    });
  }

  if (immersiveToggle) {
    immersiveToggle.addEventListener('click', function () {
      setImmersive(!document.body.classList.contains('is-immersive'));
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (walk && walk.isActive()) { exitWalk(); return; }
    if (document.body.classList.contains('is-immersive')) setImmersive(false);
  });

  /* ---------------------------------------------------------------- 时钟 --- */

  function tickClock() {
    if (!clockEl) return;
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mmn = String(d.getMinutes()).padStart(2, '0');
    clockEl.textContent = hh + ':' + mmn;
  }
  tickClock();
  setInterval(tickClock, 15000);

  /* ------------------------------------------------------------ 读数抖动 --- */

  setInterval(function () { render(true); }, 3200);

  /* -------------------------------------------------------- 滚动出现动画 --- */

  if ('IntersectionObserver' in window) {
    var targets = document.querySelectorAll('.section, .footer');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 2) * 90 + 'ms';
      io.observe(el);
    });
  }

  /* -------------------------------------------- 滚动时让城市稍稍退后 --- */

  var dimEl = document.getElementById('sceneDim');
  if (dimEl) {
    var updateDim = function () {
      var vh = window.innerHeight || 1;
      var y = window.pageYOffset || 0;
      var k = Math.max(0, Math.min(1, y / (vh * 0.85)));
      dimEl.style.opacity = (k * 0.5).toFixed(3);
    };
    window.addEventListener('scroll', updateDim, { passive: true });
    window.addEventListener('resize', updateDim);
    updateDim();
  }

  /* ---------------------------------------------------------- 街景漫步 --- */

  var walk       = window.RainyWalk;
  var walkBtn    = $('walkBtn');
  var walkExit   = $('walkExit');
  var sceneSwitch = $('sceneSwitch');

  /* 下拉跟随当前场景：漫步 = walk，锁定 = 对应地标 id */
  function syncSceneSwitch() {
    if (!sceneSwitch) return;
    if (!walk || !walk.isActive()) { sceneSwitch.value = 'walk'; return; }
    sceneSwitch.value = walk.isLocked() ? walk.lockName() : 'walk';
  }

  /* 测试用：切换并锁定到街景内部的某个场景（后续新场景在这里加分支） */
  function lockScene(name) {
    if (!walk) return;
    if (!walk.isActive()) enterWalk();
    if (name === 'walk') walk.resume();
    else walk.focus(name);
    syncSceneSwitch();
  }

  if (sceneSwitch) {
    sceneSwitch.addEventListener('change', function () {
      lockScene(sceneSwitch.value);
    });
  }

  function enterWalk() {
    if (!walk || walk.isActive()) return;
    if (document.body.classList.contains('is-immersive')) setImmersive(false);
    document.body.classList.add('is-walking');
    walk.enter();
    if (window.history && history.replaceState) history.replaceState(null, '', '#walk');
    syncSceneSwitch();
  }

  function exitWalk() {
    if (!walk || !walk.isActive()) return;
    walk.exit();
    document.body.classList.remove('is-walking');
    if (window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    syncSceneSwitch();
  }

  if (walkBtn) walkBtn.addEventListener('click', enterWalk);
  if (walkExit) walkExit.addEventListener('click', exitWalk);

  /* 支持直接用 #walk 打开街景；再加 ?at=2 可以直接落到第 3 个地点 */
  if (location.hash === '#walk') {
    var at = Number((location.search.match(/[?&]at=(\d+)/) || [])[1]);
    window.requestAnimationFrame(function () {
      enterWalk();
      if (at >= 0) walk.jumpTo(at);
    });
  }

  /* ← → / A D 控制行走方向 */
  function onWalkKey(e, down) {
    if (!walk || !walk.isActive()) return false;
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      walk.steer(down ? -1 : 0);
      if (down) syncSceneSwitch();     // 手动行走会解除锁定，下拉跟着跳回「漫步」
      return true;
    }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      walk.steer(down ? 1 : 0);
      if (down) syncSceneSwitch();
      return true;
    }
    return false;
  }
  document.addEventListener('keydown', function (e) { if (onWalkKey(e, true)) e.preventDefault(); });
  document.addEventListener('keyup', function (e) { onWalkKey(e, false); });

  /* -------------------------------------------- 键盘：静音快捷（M 键） --- */

  document.addEventListener('keydown', function (e) {
    if (e.key === 'm' || e.key === 'M') {
      if (!soundToggle) return;
      setSound(soundToggle.getAttribute('aria-pressed') !== 'true');
    }
  });
})();
