/* ============================================================
   Narrator Engine
   מסנכרן שלושה דברים לכל "ביט" של מידע:
     1. קול   — קובץ mp3 מ-ElevenLabs, ואם אין — קול הדפדפן (he-IL)
     2. טקסט  — הקלדה בסגנון צ'אט, בקצב שמותאם לאורך האודיו
     3. חשיפה — אלמנטים שנכנסים למסך יחד עם המשפט שמסביר אותם

   כל השמעה עוברת דרך תור אחד (serialize), כך ששני קולות לא יכולים
   להישמע במקביל — גם אם שתי נקודות בקוד מבקשות לדבר באותו רגע.
   ============================================================ */

const Narrator = (() => {

  const state = {
    muted: false,
    paused: false,
    audioReady: false,      // נפתח אחרי אינטראקציה ראשונה של המשתמש
    scene: null,
    beatIndex: 0,
    token: 0,               // מבטל רצף שרץ כשעוברים מסך
    activeAudio: null,
    speed: 1
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- תור השמעה ---------- */
  /* כל דיבור נכנס לתור. אין דרך ששניים יתנגנו יחד. */
  let chain = Promise.resolve();
  function serialize(fn){
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  }

  /* ---------- עזרים ---------- */

  /* מבוסס setTimeout ולא requestAnimationFrame: rAF נעצר לחלוטין בטאב רקע,
     וזה היה מקפיא את הקריינות באמצע. השעון סופר זמן פעיל בלבד, כך שהשהיה
     לא נספרת ומעבר לטאב אחר רק מאט את הקצב במקום לתקוע אותו. */
  const sleep = (ms, token) => new Promise(res => {
    let remaining = ms, last = performance.now();
    const step = () => {
      if (token !== undefined && token !== state.token) return res('abort');
      const now = performance.now();
      if (!state.paused) remaining -= (now - last);
      last = now;
      if (remaining <= 0) return res();
      setTimeout(step, Math.min(remaining, 100));
    };
    setTimeout(step, Math.min(ms, 100));
  });

  /* ---------- מוזיקת רקע (גלי אלפא) ---------- */

  const Music = (() => {
    const BASE = 0.16, DUCK = 0.05;
    let el = null, on = false, fadeTimer = null;

    function init(){
      if (el) return el;
      el = new Audio('alpha-flow.mp3');
      el.loop = true;
      el.volume = 0;
      return el;
    }

    function fadeTo(target, ms = 600){
      if (!el) return;
      clearInterval(fadeTimer);
      const from = el.volume, steps = Math.max(1, Math.round(ms / 40));
      let i = 0;
      fadeTimer = setInterval(() => {
        i++;
        el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
        if (i >= steps) clearInterval(fadeTimer);
      }, 40);
    }

    function start(){
      init();
      on = true;
      el.play().then(() => fadeTo(BASE, 1800)).catch(() => { on = false; });
    }

    function stop(){ on = false; fadeTo(0, 500); setTimeout(() => el && el.pause(), 560); }

    function toggle(){ on ? stop() : start(); return on; }

    /* מנמיך את המוזיקה בזמן שהקריינית מדברת, ומחזיר אחרי */
    function duck(isDucking){
      if (!on || !el) return;
      fadeTo(isDucking ? DUCK : BASE, isDucking ? 260 : 900);
    }

    return { start, stop, toggle, duck, isOn: () => on };
  })();

  /* ---------- אודיו קריינות ---------- */

  function audioPath(beat){ return `audio/${beat.id}.mp3`; }

  /* מנגן mp3 אם קיים. מחזיר משך בפועל, או null אם אין קובץ. */
  function playFile(beat){
    return new Promise(resolve => {
      if (state.muted || !state.audioReady) return resolve(null);
      const a = new Audio(audioPath(beat));
      a.preload = 'auto';
      let settled = false;
      const done = (val) => { if (!settled){ settled = true; resolve(val); } };

      a.addEventListener('loadedmetadata', () => {
        state.activeAudio = a;
        a.play().then(() => done({ el: a, duration: a.duration * 1000 }))
                .catch(() => done(null));
      });
      a.addEventListener('error', () => done(null));
      setTimeout(() => done(null), 1200); // אין קובץ — לא תוקעים את החוויה
    });
  }

  /* קול הדפדפן כגיבוי — עובד בעברית על macOS (Carmit) ובדפדפנים תומכים */
  function speakFallback(beat){
    if (state.muted || !state.audioReady) return null;
    if (!('speechSynthesis' in window)) return null;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(beat.t);
      u.lang = 'he-IL';
      const voices = window.speechSynthesis.getVoices();
      const he = voices.find(v => /he[-_]IL/i.test(v.lang));
      if (he) u.voice = he;
      window.speechSynthesis.speak(u);
      return u;
    } catch (e){ return null; }
  }

  function stopAudio(){
    if (state.activeAudio){ state.activeAudio.pause(); state.activeAudio = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /* ---------- הקלדה ---------- */

  /* מקליד טקסט לתוך אלמנט. אם ידוע משך האודיו — פורש את התווים לאורכו. */
  async function typeInto(el, text, durationMs, token){
    if (!el) return;
    el.classList.add('typing');
    el.textContent = '';

    if (reduceMotion){           // נגישות: בלי אנימציית הקלדה
      el.textContent = text;
      el.classList.remove('typing');
      return;
    }

    const chars = [...text];
    /* קריינות עברית יוצאת סביב 70–85ms לתו. התקרה מאפשרת לטקסט לעקוב אחרי
       הקול במקום לרוץ לפניו; המקדם 0.92 מסיים את ההקלדה רגע לפני סוף המשפט. */
    const perChar = durationMs
      ? Math.min(110, Math.max(16, (durationMs * 0.92) / chars.length))
      : (34 / state.speed);

    let i = 0, elapsed = 0, last = performance.now();
    await new Promise(res => {
      const step = () => {
        if (token !== state.token){ el.textContent = text; return res(); }
        const now = performance.now();
        if (!state.paused) elapsed += (now - last);
        last = now;
        const target = Math.min(chars.length, Math.floor(elapsed / perChar));
        if (target > i){ i = target; el.textContent = chars.slice(0, i).join(''); }
        if (i >= chars.length) return res();
        setTimeout(step, Math.max(12, Math.min(perChar, 40)));
      };
      step();
    });

    el.textContent = text;
    el.classList.remove('typing');
  }

  /* ---------- חשיפה ---------- */

  function reveal(selectors){
    (selectors || []).forEach((sel, idx) => {
      document.querySelectorAll(sel).forEach(node => {
        setTimeout(() => node.classList.add('revealed'), idx * 90);
      });
    });
  }

  function revealAll(sceneId){
    const beats = window.CONTENT.SCENES[sceneId] || [];
    beats.forEach(b => {
      reveal(b.show); reveal(b.show2);
      if (b.el){
        const el = document.querySelector(b.el);
        if (el){ el.textContent = b.d || b.t; el.classList.remove('typing'); }
      }
    });
  }

  /* ---------- סרגל השליטה ---------- */

  function renderDots(sceneId, active){
    const wrap = document.getElementById('beatDots');
    if (!wrap) return;
    const beats = window.CONTENT.SCENES[sceneId] || [];
    wrap.innerHTML = beats.map((b, i) =>
      `<i class="${i < active ? 'done' : i === active ? 'now' : ''}"></i>`).join('');
  }

  function setSpeaker(who){
    const bar = document.getElementById('narratorBar');
    if (!bar) return;
    bar.dataset.speaker = who || 'narrator';
    const label = document.getElementById('speakerLabel');
    if (label) label.textContent = who === 'adi' ? 'עדי' : 'הקול המנחה';
  }

  function setPlayingUI(on){
    const bar = document.getElementById('narratorBar');
    if (bar) bar.classList.toggle('speaking', !!on);
    Music.duck(!!on);
  }

  /* ---------- השמעת ביט בודד ---------- */

  async function playBeat(beat, el, token){
    setSpeaker(beat.who);
    setPlayingUI(true);

    const audio = await playFile(beat);
    if (token !== state.token){ setPlayingUI(false); return; }
    if (!audio) speakFallback(beat);

    await typeInto(el, beat.d || beat.t, audio ? audio.duration : null, token);
    if (token !== state.token){ setPlayingUI(false); return; }

    // ממתינים לסיום האודיו אם הוא ארוך מההקלדה
    if (audio && audio.el && !audio.el.ended){
      const remain = (audio.el.duration - audio.el.currentTime) * 1000;
      if (remain > 60) await sleep(remain, token);
    }
    setPlayingUI(false);
  }

  /* ---------- הרצת סצנה ---------- */

  function play(sceneId){
    const beats = window.CONTENT.SCENES[sceneId];
    if (!beats) return Promise.resolve();

    stopAudio();
    const token = ++state.token;
    state.scene = sceneId;
    state.paused = false;

    // איפוס טקסטים של הסצנה
    beats.forEach(b => {
      if (b.el){ const el = document.querySelector(b.el); if (el) el.textContent = ''; }
    });

    document.getElementById('narratorBar')?.classList.add('active');

    return serialize(async () => {
      for (let i = 0; i < beats.length; i++){
        if (token !== state.token) return;
        const beat = beats[i];
        state.beatIndex = i;

        renderDots(sceneId, i);
        reveal(beat.show);

        await playBeat(beat, beat.el ? document.querySelector(beat.el) : null, token);
        if (token !== state.token) return;

        reveal(beat.show2);

        if (beat.hold){ await waitForClick(token); if (token !== state.token) return; }
        else if (beat.wait){ await sleep(beat.wait, token); if (token !== state.token) return; }
      }

      renderDots(sceneId, beats.length);
      document.dispatchEvent(new CustomEvent('scene:done', { detail: { scene: sceneId } }));
    });
  }

  /* ביט בודד מחוץ לסצנה — למשל תגובה של עדי אחרי בחירה.
     נכנס לאותו תור, ולכן ימתין לקריינות שרצה כרגע במקום לדבר מעליה. */
  function speak(beat, el){
    return serialize(async () => {
      const token = state.token;
      await playBeat(beat, el, token);
    });
  }

  function waitForClick(token){
    return new Promise(res => {
      const cleanup = () => {
        document.removeEventListener('click', handler);
        document.removeEventListener('keydown', keyHandler);
        clearInterval(guard);
      };
      const handler = () => { cleanup(); res(); };
      const keyHandler = (e) => {
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); cleanup(); res(); }
      };
      document.addEventListener('click', handler);
      document.addEventListener('keydown', keyHandler);
      const guard = setInterval(() => {
        if (token !== state.token){ cleanup(); res('abort'); }
      }, 120);
    });
  }

  /* ---------- שליטה ---------- */

  function stop(){ state.token++; stopAudio(); setPlayingUI(false); }

  function togglePause(){
    state.paused = !state.paused;
    if (state.activeAudio) state.paused ? state.activeAudio.pause() : state.activeAudio.play();
    if ('speechSynthesis' in window) state.paused ? speechSynthesis.pause() : speechSynthesis.resume();
    return state.paused;
  }

  function toggleMute(){
    state.muted = !state.muted;
    if (state.muted) stopAudio();
    return state.muted;
  }

  function replay(){ if (state.scene) play(state.scene); }

  function skip(){
    const scene = state.scene;
    stop();
    if (scene){
      revealAll(scene);
      renderDots(scene, (window.CONTENT.SCENES[scene] || []).length);
    }
    document.dispatchEvent(new CustomEvent('scene:done', { detail: { scene, skipped: true } }));
  }

  function enableAudio(){ state.audioReady = true; }

  return { play, speak, stop, skip, replay, togglePause, toggleMute, enableAudio, revealAll, state, Music };
})();

window.Narrator = Narrator;
