// Robi en clase, versión web: corre en la tablet (o en el PC) desde GitHub Pages.
// Los datos (alumnos, asistencia, agenda) viven en la hoja de Google del profe (ver nube/Codigo.gs);
// aquí no hay nombres de niños: se traen de la nube con la clave guardada en este aparato.
const $ = (id) => document.getElementById(id);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hoyISO = () => new Date().toLocaleDateString("en-CA");
const ahoraHHMM = () => new Date().toTimeString().slice(0, 5);
const minutos = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const lim = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function leer(clave, def) { try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : def; } catch { return def; } }
function guardar(clave, v) { try { localStorage.setItem(clave, JSON.stringify(v)); } catch {} }

// ---------- grupos y horario ----------
const GRADOS = { "01": "Primero", "02": "Segundo", "03": "Tercero", "04": "Cuarto", "05": "Quinto" };
const GRADOS_EN = { "01": "First", "02": "Second", "03": "Third", "04": "Fourth", "05": "Fifth" };
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const letra = (g) => String.fromCharCode(64 + +g.slice(2, 4));
const nombreGrupo = (g) => `${GRADOS[g.slice(0, 2)] || g.slice(0, 2)} ${letra(g)}`;
const nombreGrupoEn = (g) => `${GRADOS_EN[g.slice(0, 2)] || ""} ${letra(g)}`;
const corto = (g) => `${+g.slice(0, 2)}°${letra(g)}`;
const gradoDe = (g) => String(+g.slice(0, 2));
const pequenos = (g) => +g.slice(0, 2) <= 2;   // 1° y 2°: español con eco en inglés

const NUBE = leer("robi_nube", null);   // { url, clave }
const D = Object.assign({ alumnos: [], horario: {}, agenda: [], clases: [] }, leer("robi_datos", {}));
const TOMADAS = leer("robi_tomadas", {});      // "fecha|grupo" → { ausentes: [matrículas] } (lo de este aparato)
let PENDIENTES = leer("robi_pendientes", []);  // lo que aún no llega a la nube (sin internet)

function alumnosDe(g) { return D.alumnos.filter((a) => a.grupo === g); }
function gruposConAlumnos() { return [...new Set(D.alumnos.map((a) => a.grupo))].sort(); }

const enRango = (e, f) => e.fecha <= f && f <= (e.hasta || e.fecha);
const paraGrupo = (e, g) => !e.para || e.para === "todos" || e.para === g || e.para === gradoDe(g);
function agendaDel(fecha, g) { return D.agenda.filter((e) => enRango(e, fecha) && (!g || paraGrupo(e, g))); }

// Las clases del día según el horario, recortadas a la hora de salida del grado.
// Las que choca un "sin clase" de la agenda quedan en 'perdidas'.
function clasesDel(fecha) {
  const H = D.horario;
  const dia = new Date(fecha + "T12:00").getDay();
  if (!H || (H._festivos || []).includes(fecha)) return { clases: [], perdidas: [] };
  const clases = [], perdidas = [];
  for (const c0 of H[DIAS[dia]] || []) {
    const salida = (H._salida || {})[gradoDe(c0.grupo)] || "23:59";
    if (c0.inicio >= salida) continue;
    const c = { ...c0, fin: c0.fin < salida ? c0.fin : salida };
    const choca = agendaDel(fecha, c.grupo).some((e) => e.tipo === "sin_clase" &&
      (!e.hora_desde || (e.hora_desde < c.fin && (e.hora_hasta || "23:59") > c.inicio)));
    (choca ? perdidas : clases).push(c);
  }
  return { clases, perdidas };
}

function claseDeHoy(g) { return clasesDel(hoyISO()).clases.find((c) => c.grupo === g); }

// ¿después de esta clase viene un descanso del grado? (entonces a los 10 min empieza el desayuno)
function antesDeDescanso(c) {
  return ((D.horario._descansos || {})[gradoDe(c.grupo)] || []).some(([ini]) => Math.abs(minutos(ini) - minutos(c.fin)) <= 10);
}

// la asistencia de una clase: lo de este aparato manda; si no, lo que dice la nube
function asistenciaDe(fecha, g) {
  const local = TOMADAS[`${fecha}|${g}`];
  if (local) return local.ausentes;
  const fila = D.clases.find((c) => c.fecha === fecha && c.grupo === g);
  return fila ? fila.ausentes.split(" ").filter(Boolean) : null;
}

// quién faltó a la clase anterior del grupo (para darle la bienvenida)
function faltaronAntes(g, fecha) {
  const fechas = new Set([...D.clases.filter((c) => c.grupo === g).map((c) => c.fecha),
    ...Object.keys(TOMADAS).filter((k) => k.endsWith("|" + g)).map((k) => k.split("|")[0])]);
  const antes = [...fechas].filter((f) => f < fecha).sort().pop();
  return antes ? asistenciaDe(antes, g) || [] : [];
}

// ---------- la nube ----------
async function nube(datos, get = false) {
  if (!NUBE) throw new Error("sin nube");
  const cuerpo = { ...datos, clave: NUBE.clave };
  const r = get ? await fetch(`${NUBE.url}?${new URLSearchParams(cuerpo)}`)
    : await fetch(NUBE.url, { method: "POST", body: JSON.stringify(cuerpo) });   // text/plain: sin preflight
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "error");
  return j;
}

function encolar(datos) {
  PENDIENTES.push(datos);
  guardar("robi_pendientes", PENDIENTES);
  enviarPendientes();
}

let enviando = false;
async function enviarPendientes() {
  if (enviando || !PENDIENTES.length) return pintarEstadoNube();
  enviando = true;
  try {
    while (PENDIENTES.length) {
      await nube(PENDIENTES[0]);
      PENDIENTES.shift();
      guardar("robi_pendientes", PENDIENTES);
    }
  } catch {} finally { enviando = false; pintarEstadoNube(); }
}

function pintarEstadoNube() {
  $("estadoNube").textContent = PENDIENTES.length ? `📴 ${PENDIENTES.length} por subir` : "☁️ Al día";
}

async function traerTodo() {
  try {
    const j = await nube({ accion: "todo" }, true);
    Object.assign(D, { alumnos: j.alumnos, horario: j.horario, agenda: j.agenda, clases: j.clases });
    guardar("robi_datos", D);
    // lo que la nube ya tiene no hace falta guardarlo aparte
    for (const k of Object.keys(TOMADAS)) {
      const [f, g] = k.split("|");
      if (!PENDIENTES.some((p) => p.fecha === f && p.grupo === g) && D.clases.some((c) => c.fecha === f && c.grupo === g)) delete TOMADAS[k];
    }
    guardar("robi_tomadas", TOMADAS);
    return true;
  } catch (e) {
    if (e.message === "clave") { $("nubeMensaje").textContent = "La clave no es correcta."; mostrar("configurar"); }
    return false;
  }
}

// ---------- Robi en pixel art (el mismo de la app del PC) ----------
const R = { animo: "normal", hablando: false, feliz: false, dormido: false, emote: null, emoteDesde: 0, emoteHasta: 0 };
const PAL = { o: "#1d2b4f", h: "#b8c6ff", hl: "#e3e9ff", f: "#0b1226", e: "#6ff3ff", b: "#ffffff", c: "#ff5d8f", y: "#ffbe0b", p: "#ff5d8f", v: "#06d6a0" };
const ARCOIRIS = ["#ff5d8f", "#ffbe0b", "#06d6a0", "#3a86ff", "#8338ec"];
const CORAZON_GRANDE = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
const CORAZON_CHICO = ["0000000", "0110110", "0111110", "0011100", "0001000", "0000000"];
const SOMBRERO = ["......kk........", ".....kak........", ".....kaak.......", "....kaaaak......",
  "....kaaaaak.....", "...kaaaaaaak....", "...kbbbbbbbk....", "..kaaaaaaaaak...", "kkkkkkkkkkkkkkkk"];
const DISFRACES = { 9: { k: "#1d2b4f", a: "#8338ec", b: "#ffbe0b" }, 11: { k: "#1d2b4f", a: "#e63946", b: "#ffffff", pompon: true } };
const VIVO = { mirada: { x: 0, y: 0 }, mirarA: { x: 0, y: 0 }, proxMirada: 0, proxParpadeo: 2000, parpadeoHasta: 0, antena: 0, antenaVel: 0 };
const OJOS = { izq: { w: 10, h: 12 }, der: { w: 10, h: 12 }, feliz: 0, sueno: 0, ceja: 0 };
const POSE = { izq: { x: 8, meta: 8 }, der: { x: 8, meta: 8 } };
const OJEADAS = [{ x: -3, y: 0 }, { x: 3, y: 0 }, { x: -2, y: -2 }, { x: 2, y: -2 }, { x: 0, y: 2 }, { x: 0, y: 0 }];

function ojo(px, cx, cy, o, lado) {
  const W = Math.max(2, Math.round(o.w)), H = Math.max(1, Math.round(o.h));
  const x0 = Math.round(cx - W / 2), y0 = Math.round(cy - H / 2), r = Math.min(3, Math.floor(Math.min(W, H) / 2));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i + 0.5, y = j + 0.5, u = x / W - 0.5, adentro = -lado * u;
    if ((x - lim(x, r, W - r)) ** 2 + (y - lim(y, r, H - r)) ** 2 > r * r) continue;
    const parpado = OJOS.sueno + Math.max(0, OJOS.ceja) * (adentro + 0.5) * 0.5 + Math.max(0, -OJOS.ceja) * (0.5 - adentro) * 0.5;
    if (y < parpado * H) continue;
    if (OJOS.feliz > 0.05 && (u / 0.65) ** 2 + ((y / H - 1.6 + 0.45 * OJOS.feliz) / 0.6) ** 2 < 1) continue;
    const brillo = H >= 8 && parpado < 0.05 && OJOS.feliz < 0.3 && i >= 1 && i <= 2 && j >= 1 && j <= 2;
    px(x0 + i, y0 + j, 1, 1, brillo ? PAL.b : PAL.e);
  }
}

function pintarRobi(ctx, t) {
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const dibujo = (filas, x, y, c) => filas.forEach((f, j) => [...f].forEach((v, i) => v === "1" && px(x + i, y + j, 1, 1, c)));
  const forma = (x, y, w, h, c) => { for (let r = 0; r < h; r++) { const i = (r === 0 || r === h - 1) ? 2 : (r === 1 || r === h - 2) ? 1 : 0; px(x + i, y + r, w - 2 * i, 1, c); } };
  const caja = (x, y, w, h, relleno, brillo) => { forma(x, y, w, h, PAL.o); forma(x + 1, y + 1, w - 2, h - 2, relleno); if (brillo) px(x + 4, y + 2, Math.floor(w / 3), 1, brillo); };
  ctx.clearRect(0, 0, 64, 64);
  const seg = t / 1000, tic = (vel, n = 2) => Math.floor(seg * vel) % n;
  const emo = R.emoteHasta > t ? R.emote : null, feliz = R.feliz || emo === "feliz";
  const cabeza = R.hablando ? tic(5) : (Math.sin(seg * 2.2) > 0.6 ? 1 : 0);

  const brazo = (x0, y0, lado, grados, largo = 10, r = 4) => {
    const a = grados * Math.PI / 180, dx = lado * Math.sin(a), dy = Math.cos(a), x1 = x0 + dx * largo, y1 = y0 + dy * largo;
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.max(y0, y1) + r; y++)
      for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.max(x0, x1) + r; x++) {
        const cx = x + 0.5, cy = y + 0.5, p = lim((cx - x0) * dx + (cy - y0) * dy, 0, largo);
        const d = Math.hypot(cx - x0 - dx * p, cy - y0 - dy * p);
        if (d <= r) px(x, y, 1, 1, d > r - 1.2 ? PAL.o : PAL.y);
      }
  };
  brazo(13, 46, -1, POSE.izq.x);
  brazo(51, 46, 1, POSE.der.x);

  ctx.save();
  ctx.translate(0, cabeza);
  const lean = Math.max(-3, Math.min(3, Math.round(VIVO.antena)));
  px(31, 7, 2, 3, PAL.o);
  px(31 + Math.round(lean / 2), 5, 2, 2, PAL.o);
  caja(29 + lean, 1, 6, 5, feliz || R.animo === "pensando" ? ARCOIRIS[tic(8, 5)] : (tic(1.5) ? PAL.p : PAL.y));
  caja(5, 18, 6, 11, PAL.y);
  caja(53, 18, 6, 11, PAL.y);
  caja(9, 9, 46, 30, PAL.h, PAL.hl);
  caja(14, 14, 36, 21, PAL.f);
  ojo(px, 24 + VIVO.mirada.x, 23 + VIVO.mirada.y, OJOS.izq, -1);
  ojo(px, 40 + VIVO.mirada.x, 23 + VIVO.mirada.y, OJOS.der, 1);
  const ropa = DISFRACES[new Date().getMonth()];
  if (ropa) {
    SOMBRERO.forEach((f, j) => [...f].forEach((c, i) => c !== "." && px(9 + i, 2 + j, 1, 1, ropa[c])));
    if (ropa.pompon) px(14, 0, 3, 3, PAL.b);
  }
  if (R.hablando) px(29, 31, 6, [1, 2, 1, 3, 2][tic(10, 5)], PAL.e);
  if (feliz) { px(16, 30, 3, 1, PAL.c); px(45, 30, 3, 1, PAL.c); }
  ctx.restore();

  px(27, 38, 10, 3, PAL.o);
  caja(16, 40, 32, 21, PAL.h, PAL.hl);
  caja(23, 44, 18, 12, PAL.f);
  dibujo(tic(2) || feliz ? CORAZON_GRANDE : CORAZON_CHICO, 28, 47, PAL.p);
  px(20, 61, 8, 3, PAL.o);
  px(36, 61, 8, 3, PAL.o);
  if (feliz) [[3, 4], [56, 9], [1, 47], [58, 50]].forEach(([x, y], i) => {
    if ((tic(4) + i) % 2) { px(x + 1, y, 1, 3, PAL.y); px(x, y + 1, 3, 1, PAL.y); }
  });
}

function moverOjos(t, dt) {
  const m = { izq: { w: 10, h: 12 }, der: { w: 10, h: 12 }, feliz: 0, sueno: 0, ceja: 0 };
  const emo = R.emoteHasta > t ? R.emote : null;
  if (R.feliz || emo === "feliz") m.feliz = 1;
  else if (emo === "sorpresa") [m.izq, m.der].forEach((o) => { o.w = 6; o.h = 6; });
  else if (emo === "triste") m.ceja = -0.6;
  else if (R.animo === "pensando") m.sueno = 0.35;
  if (t < VIVO.parpadeoHasta && !R.feliz && !emo) [m.izq, m.der].forEach((o) => { o.h = 1; });
  const k = 1 - Math.exp(-dt * 22);
  for (const lado of ["izq", "der"]) for (const p of ["w", "h"]) OJOS[lado][p] += (m[lado][p] - OJOS[lado][p]) * k;
  for (const p of ["feliz", "sueno", "ceja"]) OJOS[p] += (m[p] - OJOS[p]) * k;
}

let ultimoT = 0;
function vivir(t) {
  const dt = Math.min(0.05, (t - ultimoT) / 1000 || 0);
  ultimoT = t;
  if (t > VIVO.proxParpadeo) { VIVO.parpadeoHasta = t + 120; VIVO.proxParpadeo = t + 2500 + Math.random() * 3500; }
  if (t > VIVO.proxMirada) { VIVO.mirarA = OJEADAS[Math.floor(Math.random() * OJEADAS.length)]; VIVO.proxMirada = t + 1500 + Math.random() * 3000; }
  const k = 1 - Math.exp(-dt * 10);
  VIVO.mirada.x += (VIVO.mirarA.x - VIVO.mirada.x) * k;
  VIVO.mirada.y += (VIVO.mirarA.y - VIVO.mirada.y) * k;
  VIVO.antenaVel += (-VIVO.antena * 60 - VIVO.antenaVel * 4) * dt;
  VIVO.antena += VIVO.antenaVel * dt;
  for (const b of [POSE.izq, POSE.der]) b.x += (b.meta - b.x) * (1 - Math.exp(-dt * 12));
  moverOjos(t, dt);
  pintarRobi(CTX, t);
  requestAnimationFrame(vivir);
}
const CTX = $("robiCanvas").getContext("2d");

function emote(nombre, ms = 1500) { const t = performance.now(); Object.assign(R, { emote: nombre, emoteDesde: t, emoteHasta: t + ms }); }
function saltar() {
  const r = $("robi");
  r.classList.remove("salta"); void r.offsetWidth; r.classList.add("salta");
  VIVO.antenaVel += 50;
}
function saludar() {
  let i = 0;
  const paso = setInterval(() => { POSE.der.meta = i % 2 ? 120 : 160; if (++i > 6) { clearInterval(paso); POSE.der.meta = GLOBO.fin ? 150 : 8; } }, 280);
}
function feliz(ms = 2500) { R.feliz = true; saltar(); setTimeout(() => { R.feliz = false; }, ms); }
function lugarRobi(cual) { $("robi").className = cual || ""; }

$("robi").addEventListener("pointerdown", () => {   // un golpecito: rebota y hace bip, sin hablar (no distrae)
  saltar(); emote("feliz", 900); sonido([880, 1320], "sine", 0.07, 0.05);
});

// ---------- sonidos y confeti ----------
let AC = null;
function audioCtx() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); return AC; }
function sonido(notas, tipo = "square", dur = 0.09, vol = 0.07) {
  try {
    const ac = audioCtx(), t0 = ac.currentTime;
    notas.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = tipo; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t0 + i * dur); g.gain.exponentialRampToValueAtTime(0.001, t0 + (i + 1) * dur);
      o.connect(g).connect(ac.destination); o.start(t0 + i * dur); o.stop(t0 + (i + 1) * dur);
    });
  } catch {}
}
function pum() {   // el globo explota: un golpe de ruido que se apaga rápido
  try {
    const ac = audioCtx(), n = ac.sampleRate * 0.5, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.08));
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf; g.gain.value = 0.9; s.connect(g).connect(ac.destination); s.start();
  } catch {}
}

function confeti(mucho = false, origen = null) {
  const cv = $("confeti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const piezas = Array.from({ length: mucho ? 260 : 120 }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * (mucho ? 14 : 8);
    return origen ? { x: origen.x, y: origen.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, c: ARCOIRIS[Math.floor(Math.random() * 5)], r: Math.random() * 6, s: 6 + Math.random() * 6 }
      : { x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, vx: Math.random() * 2 - 1, vy: 2 + Math.random() * 4, c: ARCOIRIS[Math.floor(Math.random() * 5)], r: Math.random() * 6, s: 6 + Math.random() * 6 };
  });
  const fin = performance.now() + 4500;
  (function cuadro(t) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of piezas) {
      p.vy += 0.15; p.x += p.vx; p.y += p.vy; p.r += 0.1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t < fin) requestAnimationFrame(cuadro); else ctx.clearRect(0, 0, cv.width, cv.height);
  })(performance.now());
}

// ---------- la voz de Robi: Piper dentro del navegador (se descarga una vez y queda en la tablet) ----------
const VOCES = { es: "es_MX-claude-high", en: "en_US-ryan-medium" };
const TONO = 1.25;   // como en el PC: más agudo, voz de niño
const PRONUNCIAR = {
  Agustin: "Agustín", Ailin: "Ailín", Anahi: "Anahí", Andres: "Andrés", Angel: "Ángel", Angelica: "Angélica", Belen: "Belén",
  Benjamin: "Benjamín", Chavez: "Chávez", Cristobal: "Cristóbal", Geronimo: "Gerónimo", Gomez: "Gómez", Jeronimo: "Jerónimo",
  Jesus: "Jesús", Joaquin: "Joaquín", Jose: "José", Josue: "Josué", Lucia: "Lucía", Maria: "María", Mariangel: "Mariángel",
  Martin: "Martín", Mathias: "Matías", Matias: "Matías", Mia: "Mía", Moises: "Moisés", Nicolas: "Nicolás", Rios: "Ríos",
  Salome: "Salomé", Salomon: "Salomón", Sebastian: "Sebastián", Simon: "Simón", Sofia: "Sofía", Thomas: "Tomás", Tomas: "Tomás", Valentin: "Valentín",
};
const RE_PRON = new RegExp(`\\b(${Object.keys(PRONUNCIAR).join("|")})\\b`, "g");
const VOZ = { tts: null, listo: { es: false, en: false }, cola: Promise.resolve(), gen: 0, audio: new Audio(), cache: new Map() };

async function cargarVoz() {
  const aviso = $("vozEstado");
  try {
    VOZ.tts = await import("https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/+esm");
    const guardadas = await VOZ.tts.stored();
    for (const [idioma, id] of Object.entries(VOCES)) {
      if (!guardadas.includes(id)) {
        aviso.classList.remove("oculto");
        await VOZ.tts.download(id, (p) => {
          aviso.textContent = `🔊 Robi está descargando su voz${idioma === "en" ? " en inglés" : ""}… ${Math.round(100 * p.loaded / (p.total || 1))} % (solo la primera vez)`;
        });
      }
      VOZ.listo[idioma] = true;
    }
    aviso.classList.add("oculto");
  } catch (e) {
    aviso.classList.remove("oculto");
    aviso.textContent = "🔇 Robi no pudo cargar su voz (¿sin internet?). Por ahora habla con textos.";
    console.warn(e);
  }
}

// iPad: el audio solo suena si el primer play() viene de un toque
addEventListener("pointerdown", () => {
  audioCtx();
  if (!VOZ.audio.dataset.listo) {
    VOZ.audio.dataset.listo = "1";
    VOZ.audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    VOZ.audio.play().catch(() => {});
  }
}, { once: false });

async function sintetizar(texto, idioma) {
  const clave = idioma + texto;
  if (!VOZ.cache.has(clave)) {
    VOZ.cache.set(clave, VOZ.tts.predict({ text: texto, voiceId: VOCES[idioma] }).catch((e) => { VOZ.cache.delete(clave); throw e; }));
    if (VOZ.cache.size > 120) VOZ.cache.delete(VOZ.cache.keys().next().value);
  }
  return VOZ.cache.get(clave);
}

function reproducir(blob, gen) {
  return new Promise((listo) => {
    if (gen !== VOZ.gen) return listo();
    const a = VOZ.audio;
    a.src = URL.createObjectURL(blob);
    a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = false;
    a.defaultPlaybackRate = a.playbackRate = TONO;
    const fin = () => { R.hablando = false; URL.revokeObjectURL(a.src); listo(); };
    a.onended = a.onerror = fin;
    R.hablando = true;
    a.play().catch(fin);
  });
}

// En inglés, los nombres (entre « ») los dice la voz en español para que suenen bien
async function hablar(texto, idioma, gen) {
  if (gen !== VOZ.gen) return;
  if (!VOZ.listo.es) {   // sin voz: la burbuja se queda lo que tardaría en decirlo
    R.hablando = true; await espera(900 + texto.length * 55); R.hablando = false; return;
  }
  const ingles = idioma === "en" && VOZ.listo.en;
  const trozos = ingles ? texto.split(/«([^»]*)»/) : [texto.replace(/[«»]/g, "")];
  for (let i = 0; i < trozos.length; i++) {
    let t = trozos[i];
    if (!t.trim().replace(/[ ,.!?¡¿]/g, "")) continue;
    const enEspanol = !ingles || i % 2;
    if (enEspanol) t = t.replace(RE_PRON, (m) => PRONUNCIAR[m]);
    try { await reproducir(await sintetizar(t, enEspanol ? "es" : "en"), gen); } catch (e) { console.warn(e); }
    if (gen !== VOZ.gen) return;
  }
}

let burbujaTimer = null;
function burbuja(texto) {
  const b = $("burbuja");
  b.textContent = texto.replace(/[«»]/g, "");
  b.classList.remove("oculto");
  clearTimeout(burbujaTimer);
}
function esconderBurbuja(ms = 2500) { clearTimeout(burbujaTimer); burbujaTimer = setTimeout(() => $("burbuja").classList.add("oculto"), ms); }

// cortar: lo nuevo reemplaza lo que estaba diciendo (p. ej. al tocar varios niños seguidos)
function decir(texto, { idioma = "es", eco = null, cortar = false } = {}) {
  if (cortar) { VOZ.gen++; VOZ.audio.pause(); R.hablando = false; }
  const gen = VOZ.gen;
  VOZ.cola = VOZ.cola.then(async () => {
    if (gen !== VOZ.gen) return;
    burbuja(texto);
    await hablar(texto, idioma, gen);
    if (eco && gen === VOZ.gen) { burbuja(eco); await hablar(eco, "en", gen); }
    if (gen === VOZ.gen) esconderBurbuja();
  }).catch((e) => console.warn(e));   // un error no puede dejar a Robi mudo para siempre
  return VOZ.cola;
}

// ---------- lo que dice Robi: español e inglés (1° y 2°: español con un eco corto en inglés) ----------
const par = (es, en) => ({ es, en });
const FRASES = {
  hola: [par("¡Hola, {g}! ¡Qué alegría verlos!", "Hello, {gEn}! I'm so happy to see you!"),
    par("¡Buenos días, {g}! Robi listo para la clase.", "Good morning, {gEn}! Robi is ready for class."),
    par("¡Llegó {g}! ¡Bip bip, bienvenidos!", "{gEn} is here! Beep beep, welcome!"),
    par("¡Hola, hola, {g}! Hoy vamos a aprender mucho.", "Hi, {gEn}! Today we are going to learn a lot.")],
  faltaron: [par("¿Quién faltó hoy? Ayúdenme a encontrarlos.", "Who is missing today? Help me find them."),
    par("Mis sensores buscan... ¿quién no vino hoy?", "My sensors are scanning... who didn't come today?"),
    par("Vamos a contarnos. ¿A quién le falta su compañero?", "Let's count. Who is not here today?")],
  falto: [par("¿{n} no vino? ¡Te vamos a extrañar, {n}!", "«{n}» is not here? We miss you, «{n}»!"),
    par("Anotado: {n} faltó hoy.", "Got it: «{n}» is absent today."),
    par("¡Oh no! {n} no está.", "Oh no! «{n}» is not here."),
    par("{n} se quedó en casa hoy.", "«{n}» stayed home today.")],
  esta: [par("¡Ah, {n} sí está! ¡Hola, {n}!", "Oh, «{n}» is here! Hi, «{n}»!"),
    par("¡Me equivoqué! {n} vino.", "My mistake! «{n}» is here.")],
  todos: [par("¡Vinieron todos! ¡Clase completa!", "Everybody is here! Full class!"),
    par("¡Nadie faltó! ¡Bip bip, qué alegría!", "Nobody is missing! Beep beep, hooray!")],
  conteo: [par("Hoy somos {p} y faltaron {a}. ¡A trabajar con todo!", "Today we are {p}, and {a} are missing. Let's do our best!"),
    par("Cuento {p} robotistas hoy. ¡Empezamos!", "I count {p} robot builders today. Let's start!")],
  volvio: [par("¡Qué bueno que volviste, {n}!", "Welcome back, «{n}»!"),
    par("¡{n}, te extrañamos la clase pasada!", "«{n}», we missed you last class!")],
  globo: [par("¡Quedan diez minutos! Cuando el globo explote, se acaba la clase.", "Ten minutes left! When the balloon pops, class is over."),
    par("¡Miren el globo! Cuando explote, terminamos. ¡Aprovechen el tiempo!", "Look at the balloon! When it pops, we finish. Use your time well!")],
  globoDesayuno: [par("¡Diez minutos! A desayunar. Los que van a la cafetería pueden salir. Cuando el globo explote, ¡salimos al descanso!",
    "Ten minutes! Breakfast time. When the balloon pops, it's break time!")],
  recoger: [par("¡A recoger y guardar todo antes de que explote el globo!", "Clean up before the balloon pops!"),
    par("¡Tres minutos! Cada cosa en su lugar.", "Three minutes! Everything in its place.")],
  ultimo: [par("¡El globo está a punto de explotar!", "The balloon is about to pop!"),
    par("¡Un minuto! ¡El globo ya no aguanta más!", "One minute! The balloon can't hold any more!")],
  adios: [par("¡Pum! ¡Hasta la próxima, {g}!", "Pop! See you next time, {gEn}!"),
    par("¡Pum! Se acabó la clase. ¡Chao, {g}!", "Pop! Class is over. Bye, {gEn}!")],
  adiosDescanso: [par("¡Pum! ¡A disfrutar el descanso!", "Pop! Enjoy your break!")],
};
const ECO = { hola: "Hello!", faltaron: "Who is missing?", falto: null, esta: null, todos: "Everybody is here!", conteo: "Let's start!",
  volvio: "Welcome back!", globo: "Ten minutes!", globoDesayuno: "Breakfast time!", recoger: "Clean up time!", ultimo: "One minute!",
  adios: "Bye bye!", adiosDescanso: "Break time!" };

const BOLSAS = new Map();
function sacar(lista) {   // sin repetir hasta que salgan todas
  let b = BOLSAS.get(lista);
  if (!b || !b.length) { b = [...lista].sort(() => Math.random() - 0.5); BOLSAS.set(lista, b); }
  return b.pop();
}
const IDIOMA = { toca: "en" };
function frase(tipo, vars = {}, opciones = {}) {
  const g = S.grupo, rellenar = (t) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  Object.assign(vars, { g: g && nombreGrupo(g), gEn: g && nombreGrupoEn(g) });
  const p = sacar(FRASES[tipo]);
  if (!g || pequenos(g)) return decir(rellenar(p.es), { eco: ECO[tipo], ...opciones });
  IDIOMA.toca = IDIOMA.toca === "es" ? "en" : "es";
  const idioma = VOZ.listo.en || !VOZ.listo.es ? IDIOMA.toca : "es";
  return decir(rellenar(p[idioma]), { idioma, ...opciones });
}

// ---------- pantallas ----------
const S = { grupo: null, ausentes: new Set() };
function mostrar(id) {
  document.querySelectorAll(".pantalla").forEach((p) => p.classList.toggle("activa", p.id === id));
  if (id !== "clase") pararGlobo(false);
}

// ---------- inicio: las clases de hoy ----------
function pintarInicio() {
  const hoy = hoyISO(), ahora = ahoraHHMM();
  $("hoyFecha").textContent = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  pintarEstadoNube();
  $("eventosHoy").innerHTML = agendaDel(hoy).filter((e) => e.tipo !== "tema")
    .map((e) => `<span class="chip">${ICONOS[e.tipo] || "📌"} ${esc(paraTexto(e.para))}${e.hora_desde ? ` ${e.hora_desde}` : ""} ${esc(e.texto)}</span>`).join("");
  const { clases, perdidas } = clasesDel(hoy);
  const todas = [...clases.map((c) => ({ ...c })), ...perdidas.map((c) => ({ ...c, perdida: true }))].sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (!D.alumnos.length) {
    $("clasesHoy").innerHTML = `<p class="aviso">Aún no hay alumnos en la nube. Abre Robi en el PC una vez: él sube la lista de la planilla de Master2000 y el horario.</p>`;
  } else if (!todas.length) {
    $("clasesHoy").innerHTML = `<p class="sub">Hoy no hay clases en el horario. Puedes abrir un grupo abajo.</p>`;
  } else {
    $("clasesHoy").innerHTML = todas.map((c) => {
      const aus = asistenciaDe(hoy, c.grupo), tema = temaDe(hoy, c.grupo);
      const estado = c.perdida ? "perdida" : ahora >= c.fin ? "pasada" : minutos(ahora) >= minutos(c.inicio) - 10 ? "ahora" : "";
      return `<button class="clase ${estado}" data-grupo="${c.grupo}" ${c.perdida ? "disabled" : ""}>
        <small>${c.inicio} – ${c.fin}${estado === "ahora" ? " · ¡ahora!" : ""}</small>
        <b>${nombreGrupo(c.grupo)}</b>
        ${tema ? `<small>📘 ${esc(tema.texto)}</small>` : ""}
        <small>${aus ? (aus.length ? `🙋 faltaron ${aus.length}` : "✅ vinieron todos") : c.perdida ? "🚫 sin clase" : "Asistencia pendiente"}</small>
      </button>`;
    }).join("");
  }
  $("listaGrupos").innerHTML = gruposConAlumnos().map((g) => `<button class="chico" data-grupo="${g}">${corto(g)}</button>`).join("");
}
$("inicio").addEventListener("click", (e) => { const b = e.target.closest("[data-grupo]"); if (b) entrarClase(b.dataset.grupo); });

// ya es hora de una clase y el profe está en el inicio: Robi la abre solo (manos libres)
function abrirClaseSiEsHora() {
  if (!$("inicio").classList.contains("activa") || $("dia").classList.contains("oculto") === false) return;
  const hoy = hoyISO(), m = minutos(ahoraHHMM()), abiertas = leer("robi_abiertas", {});
  const c = clasesDel(hoy).clases.find((c) => m >= minutos(c.inicio) - 5 && m < minutos(c.fin) - 10);
  if (c && abiertas[hoy] !== c.grupo + c.inicio) {
    guardar("robi_abiertas", { [hoy]: c.grupo + c.inicio });
    entrarClase(c.grupo);
  }
}

// ---------- la clase ----------
function entrarClase(g) {
  Object.assign(S, { grupo: g, ausentes: new Set(asistenciaDe(hoyISO(), g) || []) });
  $("tituloGrupo").textContent = `🤖 ${nombreGrupo(g)}`;
  mostrar("clase");
  lugarRobi("");
  $("asistencia").classList.add("oculto");
  $("globoMensaje").classList.add("oculto");
  pintarReloj();
  const c = claseDeHoy(g), m = minutos(ahoraHHMM());
  const esSuHora = c && m >= minutos(c.inicio) - 15 && m < minutos(c.fin);
  const saludados = leer("robi_saludados", {}), clave = `${hoyISO()}|${g}`;
  // retoma el globo si ya estaba inflándose (p. ej. el profe salió un momento al inicio)
  const g0 = leer("robi_globo", {});
  if (g0.clave === clave && g0.fin > Date.now()) empezarGlobo(g0.fin, g0.desayuno, false);
  else if (esSuHora && !saludados[clave]) {
    saludados[clave] = 1;
    guardar("robi_saludados", saludados);
    saludar(); feliz();
    frase("hola");
    if (asistenciaDe(hoyISO(), g) === null) setTimeout(() => abrirAsistencia(true), 600);
  }
}
$("btnVolver").onclick = () => { mostrar("inicio"); pintarInicio(); };

function pintarReloj() {
  const c = S.grupo && claseDeHoy(S.grupo);
  $("reloj").textContent = c ? `${ahoraHHMM()} · termina ${c.fin}` : ahoraHHMM();
  const aus = S.grupo && asistenciaDe(hoyISO(), S.grupo);
  $("btnFaltaron").textContent = aus ? (aus.length ? `🙋 Faltaron ${aus.length}` : "🙋 Todos") : "🙋 ¿Quién faltó?";
}

// ---------- ¿quién faltó? ----------
const CARAS = ["🦊", "🐼", "🐯", "🐸", "🐙", "🦄", "🐵", "🐨", "🐰", "🐶", "🐱", "🦁", "🐷", "🐮", "🐧", "🐢", "🦖", "🐝", "🦉", "🐳", "🦋", "🐞", "🦒", "🐹"];
const COLORES = ["#ff5d8f", "#ffbe0b", "#06d6a0", "#3a86ff", "#8338ec", "#fb8500", "#2ec4b6"];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function abrirAsistencia(auto = false) {
  const g = S.grupo, alumnos = alumnosDe(g);
  if (!alumnos.length) return decir("No tengo la lista de este grupo. Abre Robi en el PC para subirla.");
  $("asisTitulo").textContent = `¿Quién faltó hoy en ${nombreGrupo(g)}?`;
  $("tarjetas").innerHTML = alumnos.map((a) => {
    const h = hash(a.matricula);
    return `<button class="nino ${S.ausentes.has(a.matricula) ? "falto" : ""}" data-id="${a.matricula}" style="--c:${COLORES[h % COLORES.length]}">
      <span class="cara">${CARAS[h % CARAS.length]}</span><span class="nombre">${esc(a.pila)}</span></button>`;
  }).join("");
  $("asistencia").classList.remove("oculto");
  lugarRobi("lado");
  if (auto) frase("faltaron");
}
$("btnFaltaron").onclick = () => abrirAsistencia(false);

$("tarjetas").addEventListener("click", (e) => {
  const b = e.target.closest(".nino");
  if (!b) return;
  const id = b.dataset.id, a = D.alumnos.find((x) => x.matricula === id), n = a.pila.split(" ")[0];
  if (S.ausentes.has(id)) {
    S.ausentes.delete(id); b.classList.remove("falto");
    sonido([660, 990], "sine", 0.08, 0.06); emote("feliz", 1200);
    frase("esta", { n }, { cortar: true });
  } else {
    S.ausentes.add(id); b.classList.add("falto");
    sonido([520, 390], "triangle", 0.12, 0.06); emote("triste", 1500);
    frase("falto", { n }, { cortar: true });
  }
});

$("btnTodos").onclick = () => {
  S.ausentes.clear();
  document.querySelectorAll(".nino.falto").forEach((b) => b.classList.remove("falto"));
  terminarAsistencia(true);
};
$("btnListo").onclick = () => terminarAsistencia(false);

function terminarAsistencia(todos) {
  const g = S.grupo, hoy = hoyISO(), alumnos = alumnosDe(g);
  const ausentes = alumnos.filter((a) => S.ausentes.has(a.matricula));
  TOMADAS[`${hoy}|${g}`] = { ausentes: ausentes.map((a) => a.matricula) };
  guardar("robi_tomadas", TOMADAS);
  encolar({ accion: "ausentes", fecha: hoy, grupo: g, hora: ahoraHHMM(), presentes: alumnos.length - ausentes.length,
    ausentes: ausentes.map((a) => ({ matricula: a.matricula, nombre: a.nombre })), sello: new Date().toISOString() });
  $("asistencia").classList.add("oculto");
  lugarRobi(GLOBO.fin ? "conGlobo" : "");
  pintarReloj();
  feliz(3000);
  confeti();
  sonido([523, 659, 784, 1047], "square", 0.1, 0.05);
  if (todos || !ausentes.length) frase("todos", {}, { cortar: true });
  else frase("conteo", { p: alumnos.length - ausentes.length, a: ausentes.length }, { cortar: true });
  // bienvenida a los que faltaron la clase pasada y hoy sí vinieron
  const volvieron = faltaronAntes(g, hoy).filter((id) => !S.ausentes.has(id))
    .map((id) => alumnos.find((a) => a.matricula === id)).filter(Boolean);
  if (volvieron.length) {
    const nombres = volvieron.map((a) => a.pila.split(" ")[0]);
    const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0];
    frase("volvio", { n: lista });
  }
}

// ---------- el globo de los últimos 10 minutos ----------
// Se infla poco a poco; los niños ven cuánto falta sin preguntar. Al terminar la clase, ¡pum!
const GLOBO = { fin: 0, total: 0, desayuno: false, timer: null, dichos: new Set() };
const DIEZ_MIN = 10 * 60000;

function empezarGlobo(fin, desayuno, anunciar = true) {
  pararGlobo(false);
  Object.assign(GLOBO, { fin, total: DIEZ_MIN, desayuno, dichos: new Set() });
  const restante = fin - Date.now();
  if (restante <= 3 * 60000) GLOBO.dichos.add("recoger");
  if (restante <= 60000) GLOBO.dichos.add("ultimo");
  guardar("robi_globo", { clave: `${hoyISO()}|${S.grupo}`, fin, desayuno });
  $("globo").classList.remove("oculto");
  $("globoMensaje").classList.add("oculto");
  lugarRobi("conGlobo");
  POSE.der.meta = 150;   // Robi sostiene el hilo
  if (anunciar) { emote("sorpresa", 1200); frase(desayuno ? "globoDesayuno" : "globo"); }
  GLOBO.timer = setInterval(tickGlobo, 500);
  tickGlobo();
}

function tickGlobo() {
  const restante = GLOBO.fin - Date.now();
  if (restante <= 0) return explotar();
  const p = 1 - restante / GLOBO.total;   // 0 → recién empieza, 1 → a punto de explotar
  const globo = $("globo");
  globo.style.setProperty("--tam", (0.3 + 0.7 * lim(p, 0, 1)).toFixed(3));
  globo.style.setProperty("--color", `hsl(${Math.round(150 - 150 * lim(p, 0, 1))} 85% 52%)`);
  globo.classList.toggle("tenso", restante <= 60000);
  $("globoTiempo").textContent = restante > 60000 ? Math.ceil(restante / 60000) : Math.ceil(restante / 1000);
  if (restante <= 3 * 60000 && !GLOBO.dichos.has("recoger")) { GLOBO.dichos.add("recoger"); frase("recoger"); }
  if (restante <= 60000 && !GLOBO.dichos.has("ultimo")) { GLOBO.dichos.add("ultimo"); emote("sorpresa", 1500); frase("ultimo"); }
  if (restante <= 10000) sonido([1200 + (10000 - restante) / 10], "square", 0.03, 0.03);   // tic-tic final
}

function explotar() {
  const desayuno = GLOBO.desayuno, r = $("globoCuerpo").getBoundingClientRect();
  pararGlobo(true);
  pum();
  confeti(true, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  $("globoMensaje").textContent = "¡PUM! 💥";
  $("globoMensaje").classList.remove("oculto");
  lugarRobi("");
  feliz(4000);
  emote("sorpresa", 600);
  frase(desayuno ? "adiosDescanso" : "adios", {}, { cortar: true });
  setTimeout(() => { if (!$("globoMensaje").classList.contains("oculto")) $("globoMensaje").textContent = "¡Hasta la próxima! 👋"; }, 3500);
}

function pararGlobo(termino) {
  clearInterval(GLOBO.timer);
  GLOBO.fin = 0;
  $("globo").classList.add("oculto");
  POSE.der.meta = 8;
  if (termino) guardar("robi_globo", { clave: `${hoyISO()}|${S.grupo}`, fin: 0, explotado: true });
}

$("btnGlobo").onclick = () => {
  if (GLOBO.fin) {
    if (confirm("¿Quitar el globo?")) { pararGlobo(false); guardar("robi_globo", { clave: `${hoyISO()}|${S.grupo}`, quitado: true }); lugarRobi(""); }
    return;
  }
  const c = claseDeHoy(S.grupo);
  empezarGlobo(Date.now() + DIEZ_MIN, !!c && antesDeDescanso(c));
};

// cada 10 s en clase: el reloj y, a 10 min del final, el globo solo
function vigilarClase() {
  if (!$("clase").classList.contains("activa") || !S.grupo) return;
  pintarReloj();
  const c = claseDeHoy(S.grupo), g0 = leer("robi_globo", {}), clave = `${hoyISO()}|${S.grupo}`;
  if (!c || GLOBO.fin || (g0.clave === clave && (g0.explotado || g0.quitado || g0.fin))) return;
  const fin = new Date(`${hoyISO()}T${c.fin}:00`).getTime(), falta = fin - Date.now();
  if (falta > 0 && falta <= DIEZ_MIN) empezarGlobo(fin, antesDeDescanso(c));
}

// ---------- libreta del profe ----------
const ICONOS = { tema: "📘", cambio: "⚡", evento: "📅", sin_clase: "🚫", nota: "📌" };
function paraTexto(p) { return !p || p === "todos" ? "Todos" : p.length === 1 ? `${p}°` : corto(p); }
function temaDe(fecha, g) { return agendaDel(fecha, g).find((e) => e.tipo === "tema"); }
function ultimoTema(g, antesDe) {
  return D.agenda.filter((e) => e.tipo === "tema" && e.fecha < antesDe && paraGrupo(e, g) && e.para !== "todos").sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
}

$("btnLibreta").onclick = () => {
  const g = S.grupo, hoy = hoyISO(), items = agendaDel(hoy, g), antes = ultimoTema(g, hoy);
  const faltaron = faltaronAntes(g, hoy).map((id) => D.alumnos.find((a) => a.matricula === id)?.pila).filter(Boolean);
  $("libretaGrupo").textContent = nombreGrupo(g);
  $("libretaContenido").innerHTML = [
    ...items.map((e) => `<div class="item"><span>${ICONOS[e.tipo] || "📌"} ${e.hora_desde ? `<small>${e.hora_desde}${e.hora_hasta ? "–" + e.hora_hasta : ""}</small> ` : ""}${esc(e.texto)}</span></div>`),
    antes ? `<div class="item"><span><small>La clase pasada (${fechaCorta(antes.fecha)}):</small> ${esc(antes.texto)}</span></div>` : "",
    faltaron.length ? `<div class="item"><span>👀 Faltaron la clase pasada: ${esc(faltaron.join(", "))}</span></div>` : "",
  ].join("") || `<p class="sub">Nada anotado para hoy. Escríbelo en 📅 Agenda.</p>`;
  $("libreta").classList.remove("oculto");
};
$("btnCerrarLibreta").onclick = () => $("libreta").classList.add("oculto");

// ---------- agenda: calendario del año + temas y cambios del día ----------
const MES = { y: new Date().getFullYear(), m: new Date().getMonth() };
const fechaCorta = (iso) => new Date(iso + "T12:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });

function pintarMes() {
  const primero = new Date(MES.y, MES.m, 1), hoy = hoyISO();
  $("mesTitulo").textContent = primero.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
  const celdas = ["Lun", "Mar", "Mié", "Jue", "Vie"].map((d) => `<div class="diaSem">${d}</div>`);
  const d = new Date(primero);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // desde el lunes de la primera semana
  while (d.getMonth() === MES.m || d < primero) {
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      const f = d.toLocaleDateString("en-CA"), eventos = agendaDel(f);
      const festivo = (D.horario._festivos || []).includes(f), libre = festivo || eventos.some((e) => e.tipo === "sin_clase" && !e.hora_desde && (e.para || "todos") === "todos");
      celdas.push(`<button class="diaMes ${f === hoy ? "hoy" : ""} ${d.getMonth() !== MES.m ? "fuera" : ""} ${libre ? "libre" : ""}" data-fecha="${f}">
        <span class="num">${d.getDate()}</span>
        ${festivo ? `<span class="ev">🚫 Festivo</span>` : ""}
        ${eventos.slice(0, 4).map((e) => `<span class="ev">${ICONOS[e.tipo] || "📌"} ${esc(e.texto)}</span>`).join("")}
        ${eventos.length > 4 ? `<span class="ev">+${eventos.length - 4} más</span>` : ""}
        <span class="marcas">${[...new Set(eventos.map((e) => ICONOS[e.tipo]))].join("")}</span>
      </button>`);
    }
    d.setDate(d.getDate() + 1);
  }
  $("mes").innerHTML = celdas.join("");
}
$("mes").addEventListener("click", (e) => { const b = e.target.closest("[data-fecha]"); if (b) abrirDia(b.dataset.fecha); });
$("mesAntes").onclick = () => { MES.m--; if (MES.m < 0) { MES.m = 11; MES.y--; } pintarMes(); };
$("mesDespues").onclick = () => { MES.m++; if (MES.m > 11) { MES.m = 0; MES.y++; } pintarMes(); };
$("mesHoy").onclick = () => { Object.assign(MES, { y: new Date().getFullYear(), m: new Date().getMonth() }); pintarMes(); };
$("btnAgenda").onclick = () => { mostrar("agenda"); pintarMes(); };
$("btnAgendaVolver").onclick = () => { mostrar("inicio"); pintarInicio(); };

function opcionesPara() {
  const grupos = [...new Set([...gruposConAlumnos(), ...DIAS.flatMap((d) => (D.horario[d] || []).map((c) => c.grupo))])].sort();
  return [`<option value="todos">Todos los grupos</option>`,
    ...["1", "2", "3", "4", "5"].map((g) => `<option value="${g}">Todo ${g}°</option>`),
    ...grupos.map((g) => `<option value="${g}">${corto(g)}</option>`)].join("");
}

function abrirDia(fecha) {
  const f = $("formAgenda");
  f.reset();
  f.fecha.value = fecha; f.eid.value = "";
  f.para.innerHTML = opcionesPara();
  $("diaMensaje").textContent = "";
  pintarDia(fecha);
  $("dia").classList.remove("oculto");
}

function pintarDia(fecha) {
  $("diaTitulo").textContent = new Date(fecha + "T12:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const eventos = agendaDel(fecha), { clases, perdidas } = clasesDel(fecha);
  const festivo = (D.horario._festivos || []).includes(fecha);
  const filasClases = [...clases, ...perdidas.map((c) => ({ ...c, perdida: true }))].sort((a, b) => a.inicio.localeCompare(b.inicio)).map((c) => {
    const tema = temaDe(fecha, c.grupo), aus = asistenciaDe(fecha, c.grupo);
    const nombres = (aus || []).map((id) => D.alumnos.find((a) => a.matricula === id)?.pila.split(" ")[0]).filter(Boolean);
    return `<div class="item"><span><b>${c.inicio} ${corto(c.grupo)}</b> ${c.perdida ? "🚫" : ""} ${tema ? `📘 ${esc(tema.texto)}` : `<small>sin tema</small>`}
      ${aus ? `<br><small>${nombres.length ? "Faltaron: " + esc(nombres.join(", ")) : "Vinieron todos"}</small>` : ""}</span></div>`;
  });
  $("diaContenido").innerHTML = (festivo ? `<p>🚫 Festivo (del horario)</p>` : "") +
    eventos.map((e) => `<div class="item" data-id="${e.id}"><span>${ICONOS[e.tipo] || "📌"} <small>${esc(paraTexto(e.para))}${e.hora_desde ? ` · ${e.hora_desde}${e.hora_hasta ? "–" + e.hora_hasta : ""}` : ""}${e.hasta && e.hasta !== e.fecha ? ` · hasta ${fechaCorta(e.hasta)}` : ""}</small><br>${esc(e.texto)}</span>
      <button data-editar="${e.id}" title="Editar">✏️</button><button data-borrar="${e.id}" title="Borrar">✕</button></div>`).join("") +
    (filasClases.length ? `<h3>Clases</h3>${filasClases.join("")}` : "");
}

$("diaContenido").addEventListener("click", (e) => {
  const borrar = e.target.dataset.borrar, editar = e.target.dataset.editar, f = $("formAgenda");
  if (borrar && confirm("¿Borrar esto de la agenda?")) {
    D.agenda = D.agenda.filter((x) => x.id !== borrar);
    guardar("robi_datos", D);
    encolar({ accion: "agenda_borrar", id: borrar });
    pintarDia(f.fecha.value); pintarMes();
  }
  if (editar) {
    const ev = D.agenda.find((x) => x.id === editar);
    for (const k of ["tipo", "para", "texto", "hora_desde", "hora_hasta", "hasta"]) f[k].value = ev[k] || (k === "para" ? "todos" : "");
    f.eid.value = ev.id;
    f.fecha.value = ev.fecha;
    f.texto.focus();
  }
});

$("formAgenda").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  const ev = { id: f.eid.value || Math.random().toString(36).slice(2, 10), fecha: f.fecha.value, hasta: f.hasta.value > f.fecha.value ? f.hasta.value : "",
    para: f.para.value, tipo: f.tipo.value, texto: f.texto.value.trim(), hora_desde: f.hora_desde.value, hora_hasta: f.hora_hasta.value };
  if (!ev.texto) return;
  D.agenda = D.agenda.filter((x) => x.id !== ev.id).concat(ev);
  guardar("robi_datos", D);
  encolar({ accion: "agenda_guardar", evento: ev });
  const fecha = f.fecha.value;
  f.reset(); f.fecha.value = fecha; f.eid.value = "";
  pintarDia(fecha); pintarMes();
};
$("btnCerrarDia").onclick = () => $("dia").classList.add("oculto");

// ---------- configurar la nube ----------
$("formNube").onsubmit = async (e) => {
  e.preventDefault();
  const url = e.target.url.value.trim(), clave = e.target.clave.value.trim();
  $("nubeMensaje").textContent = "Conectando…";
  try {
    const j = await (await fetch(`${url}?${new URLSearchParams({ accion: "todo", clave })}`)).json();
    if (!j.ok) throw new Error(j.error === "clave" ? "La clave no es correcta." : j.error);
  } catch (err) {
    $("nubeMensaje").textContent = err.message.includes("clave") ? err.message : "No pude conectar. Revisa la dirección (debe terminar en /exec).";
    return;
  }
  guardar("robi_nube", { url, clave });
  location.reload();
};
$("btnNube").onclick = () => {
  if (!confirm("¿Cambiar la dirección o la clave de la nube en este aparato?")) return;
  const f = $("formNube");
  f.url.value = NUBE?.url || ""; f.clave.value = NUBE?.clave || "";
  mostrar("configurar");
};
$("btnActualizar").onclick = async () => {
  $("estadoNube").textContent = "🔄 …";
  await enviarPendientes();
  await traerTodo();
  pintarInicio();
};

// ---------- arranque ----------
async function iniciar() {
  requestAnimationFrame(vivir);
  if (!NUBE) return mostrar("configurar");
  mostrar("inicio");
  pintarInicio();
  cargarVoz();
  enviarPendientes();
  if (await traerTodo()) pintarInicio();
  setInterval(() => {
    vigilarClase();
    abrirClaseSiEsHora();
    if ($("inicio").classList.contains("activa")) pintarInicio();
  }, 10000);
  setInterval(enviarPendientes, 60000);
  setInterval(async () => { if (!PENDIENTES.length && await traerTodo() && $("inicio").classList.contains("activa")) pintarInicio(); }, 10 * 60000);
  addEventListener("online", enviarPendientes);
  abrirClaseSiEsHora();
}
iniciar();
