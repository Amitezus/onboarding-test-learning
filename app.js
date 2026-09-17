/* ============================================================
   App — ניווט בגלילה נעולה, תרגול, משוב וארגז הכלים
   ============================================================ */

const { SCENES, NOTICE, MOMENTS, PRINCIPLES, FEEDBACK, CHAPTERS, STEPS } = window.CONTENT;

const ORDER = STEPS.map(s => s.id);

const state = {
  unlocked: -1,          // אינדקס המסך הגבוה ביותר שנפתח
  current: 0,
  moment: 0,
  answers: [],
  score: 0,
  noticeAnswered: false,
  tools: [],
  busy: false,
  seen: new Set()
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const icon = (name) => `<span class="ms" aria-hidden="true">${name}</span>`;

const screens = $$('.screen');
const idxOf = (name) => ORDER.indexOf(name);
const sceneFor = (name) =>
  name === 'practice' ? 'practiceIntro' :
  name === 'feedback' ? 'feedbackIntro' : name;

/* ============================================================
   שער כניסה
   ============================================================ */

function enter(withSound){
  if (withSound){
    Narrator.enableAudio();
    Narrator.Music.start();
    setMusicBtn(true);
  }
  $('#gate').classList.add('gone');
  const app = $('#app');
  app.setAttribute('aria-hidden','false');
  app.classList.add('ready');
  setTimeout(() => $('#gate').remove(), 600);
  go('welcome');
}

$('#gateSound').onclick  = () => enter(true);
$('#gateSilent').onclick = () => { Narrator.toggleMute(); setMuteBtn(true); enter(false); };

/* ============================================================
   גלילה נעולה
   ------------------------------------------------------------
   המסמך מכיל רק מסכים שנפתחו ועוד אחד במצב הצצה. אין לאן לגלול
   מעבר להצצה — זו הנעילה, בלי לחטוף אירועי גלילה מהדפדפן.
   ============================================================ */

function renderOpen(){
  screens.forEach((el, i) => {
    el.classList.toggle('is-open', i <= state.unlocked);
    el.classList.toggle('is-peek', i === state.unlocked + 1);
  });
  $('#peekHint').hidden = state.unlocked + 1 >= screens.length;
}

function scrollToScreen(i, smooth = true){
  const el = screens[i];
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

function go(name){
  if (state.busy) return;
  const i = idxOf(name);
  if (i < 0) return;

  const advancing = i > state.unlocked;
  if (advancing){
    state.unlocked = i;
    renderOpen();
  }

  setRail(i);
  // ההצצה כבר על המסך, אז נותנים לה רגע להיפתח לפני שגוללים
  requestAnimationFrame(() => scrollToScreen(i));

  const scene = sceneFor(name);
  if (advancing || !state.seen.has(scene)) enterScreen(name, scene);
}

/* מה שקורה כשנכנסים למסך בפעם הראשונה */
function enterScreen(name, scene){
  Narrator.stop();
  state.current = idxOf(name);

  if (name === 'landing')  renderLanding();
  if (name === 'notice')   renderNotice();
  if (name === 'feedback') renderFeedback();

  const replaying = state.seen.has(scene);
  state.seen.add(scene);

  if (SCENES[scene] && !replaying){
    const done = Narrator.play(scene);
    // כל דיבור נוסף מתחיל רק אחרי שהקריינות של המסך הסתיימה
    if (name === 'practice') done.then(() => startPractice());
    if (name === 'feedback') done.then(() => speakCoach());
  } else {
    if (SCENES[scene]) Narrator.revealAll(scene);
    if (name === 'practice') startPractice();
    if (name === 'feedback') speakCoach();
  }
}

document.addEventListener('click', (e) => {
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }
  const act = e.target.closest('[data-action]');
  if (act) ACTIONS[act.dataset.action]?.();
});

$('#homeBtn').onclick = () => go('landing');

const ACTIONS = { finishChapter: () => finishChapter() };

/* ============================================================
   סרגל ההתקדמות האנכי
   ============================================================ */

function buildRail(){
  $('#railSteps').innerHTML = STEPS.map((st, i) => `
    <li><button class="rail-step" data-i="${i}" tabindex="-1">
      <span class="rail-label">${st.label}</span>
      <span class="rail-bar"></span>
    </button></li>`).join('');

  $$('#railSteps .rail-step').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i;
      if (i <= state.unlocked) scrollToScreen(i);
    };
  });
}

function setRail(i){
  state.current = i;
  $('#railNow').textContent = i + 1;
  $$('#railSteps .rail-step').forEach((btn, n) => {
    btn.classList.toggle('done', n <= state.unlocked);
    btn.classList.toggle('now', n === i);
    btn.tabIndex = n <= state.unlocked ? 0 : -1;
  });
}

/* מסנכרן את הסרגל כשגוללים ידנית בין מסכים שכבר נפתחו */
const railObserver = new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    const i = screens.indexOf(en.target);
    if (i >= 0 && i !== state.current) setRail(i);
  });
}, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

screens.forEach(el => railObserver.observe(el));

/* ============================================================
   מפת המסע + ארגז הכלים
   ============================================================ */

function renderLanding(){
  $('#skillTrack').innerHTML = CHAPTERS.map((c, i) => {
    const done = state.tools.length > i;
    const cls  = done ? 'done' : c.state === 'current' ? 'current' : 'locked';
    const mark = done ? 'check_circle' : c.state === 'current' ? 'radio_button_checked' : 'lock';
    return `<button class="pcard ${cls}" data-slot="${i}"
             ${cls === 'locked' ? 'disabled' : ''} ${cls !== 'locked' ? 'data-go="persona"' : ''}>
      <span class="pcard-photo face-${c.face}"></span>
      <span class="pcard-body">
        <span class="pcard-top">
          <span class="pcard-num">${c.n}</span>
          <span class="pcard-state">${icon(mark)}</span>
        </span>
        <span class="pcard-name">${c.name}</span>
        <span class="pcard-role">${c.role}</span>
        <span class="pcard-quote">${c.quote}</span>
        <span class="pcard-skill">${icon(c.icon)}<span>${c.skill}</span></span>
      </span>
    </button>`;
  }).join('');

  $('#tbCount').textContent = `${state.tools.length} / 5`;
  $('#tbSlots').innerHTML = CHAPTERS.map((c, i) => {
    const filled = state.tools.includes(c.skill);
    // המיומנות מוצגת תמיד — מה שמשתנה הוא אם היא פתוחה או נעולה
    return `<div class="tb-slot ${filled ? 'filled' : 'locked'}" data-slot="${i}">
      <span class="slot-top">
        <span class="slot-num">${c.n}</span>
        ${icon(filled ? 'check_circle' : 'lock')}
      </span>
      ${icon(c.icon)}
      <span class="slot-name">${c.skill}</span>
    </div>`;
  }).join('');

  linkMapHover();
}

/* מדגיש את השרשרת דמות → גשר → משבצת בארגז */
function linkMapHover(){
  const stems = $$('#mapStems i');
  const setLink = (i, on) => {
    $$(`.pcard[data-slot="${i}"]`).forEach(e => e.classList.toggle('linked', on));
    $$(`.tb-slot[data-slot="${i}"]`).forEach(e => e.classList.toggle('linked', on));
    stems[i]?.classList.toggle('linked', on);
  };
  $$('.pcard, .tb-slot').forEach(el => {
    const i = +el.dataset.slot;
    el.addEventListener('mouseenter', () => setLink(i, true));
    el.addEventListener('mouseleave', () => setLink(i, false));
    el.addEventListener('focus',      () => setLink(i, true));
    el.addEventListener('blur',       () => setLink(i, false));
  });
}

/* ============================================================
   שליפה לפני הסבר
   ============================================================ */

function renderNotice(){
  state.noticeAnswered = false;
  $('#noticeResult').hidden = true;
  $('#noticeReveal').hidden = true;

  $('#noticeOptions').innerHTML = NOTICE.options.map((o, i) => `
    <button class="notice-opt" data-opt="${i}">
      <span class="opt-mark">${['א','ב','ג'][i]}</span>
      <span>${o.t}</span>
    </button>`).join('');

  $$('#noticeOptions .notice-opt').forEach(btn => {
    btn.onclick = () => chooseNotice(+btn.dataset.opt, btn);
  });
}

async function chooseNotice(i, btn){
  if (state.noticeAnswered) return;
  state.noticeAnswered = true;

  const opt = NOTICE.options[i];
  $$('#noticeOptions .notice-opt').forEach(b => b.disabled = true);
  btn.classList.add(opt.ok ? 'ok' : 'no');

  if (!opt.ok){
    const rightIdx = NOTICE.options.findIndex(o => o.ok);
    $$('#noticeOptions .notice-opt')[rightIdx].classList.add('ok');
  }

  const res = $('#noticeResult');
  res.hidden = false;
  $('#nrMark').innerHTML = icon(opt.ok ? 'check' : 'priority_high');
  $('#nrMark').classList.toggle('no', !opt.ok);
  $('#nrTitle').textContent = opt.ok ? 'זיהוי מדויק.' : 'לא בדיוק — וזו טעות נפוצה.';
  $('#nrWhy').textContent = opt.why;

  await sleep(900);
  $('#noticeReveal').hidden = false;
  await Narrator.speak(
    { id:'nReveal', who:NOTICE.reveal.who, t:NOTICE.reveal.t },
    $('#nRevealText')
  );
}

/* ============================================================
   השיחה המדומה
   ============================================================ */

function startPractice(){
  state.moment = 0;
  state.answers = [];
  state.score = 0;
  $('#chatBody').innerHTML = '';
  $('#logItems').innerHTML = '';
  $('#logEmpty').hidden = false;
  $('#logCount').textContent = '0 / 3';
  runMoment();
}

function addBubble(cls, text){
  const b = document.createElement('div');
  b.className = `chat-bubble ${cls}`;
  b.textContent = text;
  $('#chatBody').appendChild(b);
  b.scrollIntoView({ block:'nearest', behavior:'smooth' });
  return b;
}

async function typingIndicator(ms){
  const t = document.createElement('div');
  t.className = 'chat-typing';
  t.innerHTML = '<i></i><i></i><i></i>';
  $('#chatBody').appendChild(t);
  $('#chatStatus').textContent = 'מקלידה…';
  await sleep(ms);
  t.remove();
  $('#chatStatus').textContent = 'שיחת שירות';
}

async function runMoment(){
  const m = MOMENTS[state.moment];
  state.busy = true;

  $('#momentNo').textContent = state.moment + 1;
  $('#answers').innerHTML = '';
  $('#answerArea').style.opacity = '.35';

  await typingIndicator(900);
  const bubble = addBubble('customer', '');
  await Narrator.speak({ id:`m${state.moment}q`, who:'adi', t:m.adi }, bubble);

  $('#answerArea').style.opacity = '1';
  $('#answers').innerHTML = m.options.map((o, i) => `
    <button class="answer" data-i="${i}">
      <span class="letter">${o.k}</span><span>${o.t}</span>
    </button>`).join('');

  $$('#answers .answer').forEach(btn => {
    btn.onclick = () => chooseAnswer(+btn.dataset.i, btn);
  });

  state.busy = false;
}

/* הניתוח נשאר על המסך ונצבר — לא מופיע לרגע ונעלם */
function addLogEntry(momentIdx, opt, principle){
  $('#logEmpty').hidden = true;
  const cls  = opt.v >= 3 ? 'good' : opt.v > 0 ? 'part' : 'bad';
  const mark = opt.v >= 3 ? 'check_circle' : opt.v > 0 ? 'error' : 'cancel';

  const li = document.createElement('li');
  li.className = `fl-item ${cls}`;
  li.innerHTML = `${icon(mark)}
    <div class="fl-body">
      <b>${momentIdx + 1}. ${principle}</b>
      <p>${opt.note}</p>
    </div>`;
  $('#logItems').appendChild(li);
  $('#logCount').textContent = `${state.answers.length} / 3`;
}

async function chooseAnswer(i, btn){
  if (state.busy) return;
  state.busy = true;

  const m = MOMENTS[state.moment];
  const opt = m.options[i];

  $$('#answers .answer').forEach(b => {
    b.disabled = true;
    if (b !== btn) b.classList.add('dim');
  });
  btn.classList.add(opt.v >= 3 ? 'correct' : opt.v > 0 ? 'partial' : 'wrong');

  state.answers.push(opt.v);
  state.score += opt.v;

  await sleep(420);
  addBubble(`agent ${opt.v >= 3 ? '' : 'weak'}`, opt.t);

  // התגובה של עדי — התוצאה של הבחירה, לא ציון
  await typingIndicator(1000);
  const reactBubble = addBubble('customer', '');
  await Narrator.speak({ id:`m${state.moment}${opt.k}`, who:'adi', t:opt.react }, reactBubble);

  addLogEntry(state.moment, opt, m.principle);

  await sleep(900);

  if (state.moment < MOMENTS.length - 1){
    state.moment++;
    state.busy = false;
    runMoment();
  } else {
    state.busy = false;
    go('feedback');
  }
}

/* ============================================================
   משוב
   ============================================================ */

function renderFeedback(){
  const max = MOMENTS.reduce((sum, m) => sum + Math.max(...m.options.map(o => o.v)), 0);
  const score = Math.round(state.score / max * 100);
  const band = FEEDBACK.bands.find(b => score >= b.min);

  $('#feedbackHeadline').textContent = band.headline;
  $('#feedbackVerdict').textContent = band.verdict;

  const ring = $('#ringFill');
  const circumference = 327;
  ring.style.strokeDashoffset = circumference;
  setTimeout(() => {
    ring.style.strokeDashoffset = circumference - (circumference * score / 100);
    ring.style.stroke = score >= 80 ? 'var(--ok)' : score >= 55 ? 'var(--coral)' : 'var(--warn)';
  }, 320);

  let shown = 0;
  const bigNum = $('#scoreBig');
  bigNum.textContent = '0';
  const counter = setInterval(() => {
    shown += Math.max(1, Math.round(score / 28));
    if (shown >= score){ shown = score; clearInterval(counter); }
    bigNum.textContent = shown;
  }, 38);

  $('#feedbackRows').innerHTML = PRINCIPLES.map(p => {
    const got = state.answers[p.moment] ?? 0;
    const pct = got >= p.min ? 88 + Math.round(Math.random() * 10) : 34 + Math.round(got * 8);
    return `<div class="feedback-row">
      <div class="feedback-row-top"><b>${p.name}</b><strong>${pct}%</strong></div>
      <div class="meter"><i data-w="${pct}" class="${pct >= 80 ? 'strong' : ''}"></i></div>
      <p>${p.sub}</p>
    </div>`;
  }).join('');

  setTimeout(() => {
    $$('#feedbackRows .meter i').forEach((el, i) => {
      setTimeout(() => el.style.width = el.dataset.w + '%', i * 160);
    });
  }, 500);

  const strong = (state.answers[2] ?? 0) >= 4;
  $('#coachMessage').textContent = strong ? FEEDBACK.coachStrong : FEEDBACK.coachDevelop;
}

/* הקול של המשוב האישי — רק אחרי שקריינות המסך הסתיימה */
function speakCoach(){
  const strong = (state.answers[2] ?? 0) >= 4;
  return Narrator.speak({
    id: strong ? 'fbStrong' : 'fbDevelop',
    who: 'narrator',
    t: strong ? FEEDBACK.voiceStrong : FEEDBACK.voiceDevelop
  }, null);
}

/* ============================================================
   סיום פרק
   ============================================================ */

function finishChapter(){
  const skill = CHAPTERS[0].skill;
  if (!state.tools.includes(skill)) state.tools.push(skill);

  $('#toolCount').textContent = state.tools.length;
  const mini = $('#toolboxMini');
  mini.classList.add('pop');
  setTimeout(() => mini.classList.remove('pop'), 460);

  renderLanding();
  showToast('פרק 01 הושלם · "תקשורת מותאמת" נשמרה בארגז הכלים');
  go('landing');
}

function showToast(text){
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3400);
}

/* ============================================================
   שליטה בקריינות ובמוזיקה
   ============================================================ */

function setMuteBtn(muted){
  const b = $('#btnMute');
  b.querySelector('.ms').textContent = muted ? 'volume_off' : 'volume_up';
  b.classList.toggle('is-active', muted);
}

function setMusicBtn(on){
  const b = $('#btnMusic');
  b.querySelector('.ms').textContent = on ? 'music_note' : 'music_off';
  b.classList.toggle('is-active', on);
}

$('#btnPause').onclick = () => {
  const paused = Narrator.togglePause();
  $('#btnPause').querySelector('.ms').textContent = paused ? 'play_arrow' : 'pause';
  $('#btnPause').classList.toggle('is-active', paused);
};

$('#btnReplay').onclick = () => Narrator.replay();
$('#btnSkip').onclick   = () => Narrator.skip();

$('#btnMute').onclick = () => {
  const muted = Narrator.toggleMute();
  setMuteBtn(muted);
  showToast(muted ? 'הקריינות הושתקה · הטקסט ממשיך להופיע' : 'הקריינות הופעלה');
};

$('#btnMusic').onclick = () => {
  Narrator.enableAudio();
  const on = Narrator.Music.toggle();
  setMusicBtn(on);
  showToast(on ? 'מוזיקת רקע · גלי אלפא' : 'מוזיקת הרקע כבתה');
};

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'Escape') Narrator.skip();
  if (e.key === 'm' || e.key === 'M') $('#btnMute').click();
});

/* ============================================================
   אתחול
   ============================================================ */

document.body.classList.add('js-on');
buildRail();
renderLanding();
renderOpen();

if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

// האייקונים נחשפים רק אם גופן Material Symbols באמת נטען
const FONT = '24px "Material Symbols Rounded"';
if (document.fonts?.load){
  document.fonts.load(FONT)
    .then(() => { if (document.fonts.check(FONT)) document.body.classList.add('icons-ready'); })
    .catch(() => {});
} else {
  document.body.classList.add('icons-ready');
}
