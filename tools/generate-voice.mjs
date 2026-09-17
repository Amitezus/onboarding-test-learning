#!/usr/bin/env node
/* ============================================================
   יצירת קריינות עברית מ-ElevenLabs
   ------------------------------------------------------------
   שימוש:
     export ELEVENLABS_API_KEY="sk_..."
     node tools/generate-voice.mjs            # מייצר רק מה שחסר
     node tools/generate-voice.mjs --list     # מציג מה ייווצר, בלי לקרוא ל-API
     node tools/generate-voice.mjs --force    # מייצר מחדש הכל
     node tools/generate-voice.mjs --only p1,p2

   הקולות נקבעים ב-tools/voices.json.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');

const args    = process.argv.slice(2);
const LIST    = args.includes('--list');
const FORCE   = args.includes('--force');
const onlyArg = args.find(a => a.startsWith('--only'));
const ONLY    = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null;

/* ---------- קריאת התוכן ---------- */

function loadContent(){
  const code = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!sandbox.window.CONTENT) throw new Error('content.js לא חשף את window.CONTENT');
  return sandbox.window.CONTENT;
}

/* ---------- איסוף כל שורות הקריינות ---------- */

function collectLines(C){
  const lines = [];
  const push = (id, who, text) => {
    if (!id || !text) return;
    if (lines.some(l => l.id === id)) return;       // מונע כפילויות
    lines.push({ id, who, text: text.trim() });
  };

  for (const [scene, beats] of Object.entries(C.SCENES))
    beats.forEach(b => push(b.id, b.who, b.t));

  push('nReveal', C.NOTICE.reveal.who, C.NOTICE.reveal.t);

  C.MOMENTS.forEach((m, i) => {
    push(`m${i}q`, 'adi', m.adi);
    m.options.forEach(o => push(`m${i}${o.k}`, 'adi', o.react));
  });

  push('fbStrong',  'narrator', C.FEEDBACK.voiceStrong);
  push('fbDevelop', 'narrator', C.FEEDBACK.voiceDevelop);

  return ONLY ? lines.filter(l => ONLY.includes(l.id)) : lines;
}

/* ---------- הגדרות קול ---------- */

function loadVoices(){
  const p = path.join(HERE, 'voices.json');
  if (!fs.existsSync(p)) throw new Error('חסר tools/voices.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ---------- ElevenLabs ---------- */

async function synth(line, cfg, apiKey){
  const voice = cfg.voices[line.who] || cfg.voices.narrator;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}?output_format=${cfg.output_format}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: line.text,
      model_id: cfg.model_id,
      voice_settings: voice.settings || cfg.default_settings
    })
  });

  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- ראשי ---------- */

async function main(){
  const C = loadContent();
  const lines = collectLines(C);
  const cfg = loadVoices();

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const pending = lines.filter(l =>
    FORCE || !fs.existsSync(path.join(AUDIO_DIR, `${l.id}.mp3`)));

  console.log(`\nסה"כ שורות קריינות: ${lines.length}`);
  console.log(`ממתינות ליצירה:     ${pending.length}`);
  console.log(`תווים בסך הכל:      ${pending.reduce((n, l) => n + l.text.length, 0)}\n`);

  if (LIST){
    lines.forEach(l => {
      const have = fs.existsSync(path.join(AUDIO_DIR, `${l.id}.mp3`)) ? '✓' : ' ';
      console.log(` ${have} ${l.id.padEnd(10)} ${l.who.padEnd(9)} ${l.text.slice(0, 68)}`);
    });
    console.log('\n(--list בלבד — לא בוצעה קריאה ל-API)\n');
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey){
    console.error('חסר מפתח. הריצו:\n  export ELEVENLABS_API_KEY="sk_..."\n');
    process.exit(1);
  }
  if (!pending.length){ console.log('הכל קיים כבר. אין מה לייצר.\n'); return; }

  let ok = 0, fail = 0;
  for (const line of pending){
    process.stdout.write(` → ${line.id.padEnd(10)} `);
    try {
      const buf = await synth(line, cfg, apiKey);
      fs.writeFileSync(path.join(AUDIO_DIR, `${line.id}.mp3`), buf);
      console.log(`✓ ${(buf.length / 1024).toFixed(0)}KB`);
      ok++;
      await new Promise(r => setTimeout(r, 260));   // עדין מול ה-API
    } catch (err){
      console.log(`✗ ${err.message}`);
      fail++;
    }
  }

  console.log(`\nהסתיים. נוצרו ${ok}, נכשלו ${fail}.`);
  if (fail) console.log('טיפ: ודאו שה-model_id ב-voices.json תומך בעברית (eleven_turbo_v2_5 או eleven_v3).\n');
}

main().catch(e => { console.error('\nשגיאה:', e.message, '\n'); process.exit(1); });
