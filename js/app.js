/* Deal — socle de l'app : environnement, connexion (PC / téléphone), feuilles, toast, mises à jour,
   et les fonctions communes (calcul d'un bien avec ses surcharges, indice de fatigue, étoiles). */
'use strict';
const VERSION = self.DEAL_VERSION || '?';
const ENV = window.DEAL_ENV || 'local';
const Sync = window.DealSync;
const Scoring = window.DealScoring;
const KEY = 'deal.' + ENV + '.reglages';
const J = 86400000;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const eur = (n, d) => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + (d === false ? '' : ' €');
const eurS = n => n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : '') + Math.round(n).toLocaleString('fr-FR') + ' €';

/* ================== Réglages locaux (affichage) ================== */
let S = { theme: 'auto', fs: 1, filtres: {} };
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function applyLook() {
  const r = document.documentElement;
  if (S.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = S.theme;
  r.dataset.fs = String(S.fs);
  const dark = S.theme === 'sombre' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.content = dark ? '#0F1A1C' : '#F3F8F8');
}
function vib(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
function ago(t) {
  if (!t) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'à l\'instant';
  const m = Math.round(s / 60); if (m < 60) return 'il y a ' + m + ' min';
  const h = Math.round(m / 60); if (h < 48) return 'il y a ' + h + ' h';
  return 'il y a ' + Math.round(h / 24) + ' j';
}
const dateFr = t => t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* ================== Calcul d'un bien (UNE formule : scoring.js) ================== */
// Caractéristiques physiques effectives = extraction serveur + corrections manuelles de la fiche.
function bienEffectif(b) {
  const a = Sync.data.annotations.get(b.lbc_id);
  const corr = (a && a.curseurs && a.curseurs.physique) || {};
  const base = b.physique || { exclusions: [], inconnus: ['distance_mer', 'etat'], distance_mer: null, niveau_travaux: null, etat: null,
                               vue_mer: false, terrasse: false, parking: false, clim: false, charges_copro_an: null };
  const e = Object.assign({}, base, corr, { prix: b.prix, surface: b.surface, pieces: b.pieces, type: b.type || base.type, dpe: b.dpe || base.dpe });
  if (corr.niveau_travaux && !corr.etat) e.etat = corr.niveau_travaux === 'aucun' ? (base.etat === 'refait_neuf' ? 'refait_neuf' : 'bon') : 'a_rafraichir';
  return e;
}
// Curseurs : réglages globaux (fin) <- surcharges enregistrées du bien <- curseurs en cours (fiche)
function curseursBien(b, enCours) {
  const a = Sync.data.annotations.get(b.lbc_id);
  const c = Object.assign({}, (a && a.curseurs) || {}, enCours || {});
  delete c.physique;
  return c;
}
function calculer(b, enCours) {
  return Scoring.calculer(bienEffectif(b), Sync.reglagesPour(b.commune), curseursBien(b, enCours));
}

/* ================== Indice « vendeur qui fatigue » ================== */
function fatigue(b) {
  const orig = b.doublon_de ? Sync.data.biens.get(b.doublon_de) : null;
  const dates = [b.publie_le, b.premiere_vue, orig && orig.publie_le, orig && orig.premiere_vue].filter(x => x && x > 0);
  const debut = dates.length ? Math.min.apply(null, dates) : null;
  const jours = debut ? Math.floor((Date.now() - debut) / J) : null;
  const hist = (Sync.data.prix.get(b.lbc_id) || []).map(p => p.prix);
  const anc = b.physique && b.physique.ancien_prix;
  const haut = Math.max.apply(null, hist.concat(anc ? [anc] : [], [b.prix]));
  let baisses = 0; for (let i = 1; i < hist.length; i++) if (hist[i] < hist[i - 1]) baisses++;
  if (anc && anc > b.prix && !baisses) baisses = 1;
  const baissePct = haut > b.prix ? (Math.round((haut - b.prix) / haut * 1000) / 10).toLocaleString('fr-FR') : 0;
  let niveau = 'faible', texte;
  if (jours == null) texte = 'Ancienneté inconnue';
  else if (jours >= 90 && !baisses) { niveau = 'forte'; texte = `En ligne depuis ${jours} j sans aucune baisse : marge de négociation large`; }
  else if (jours >= 90) { niveau = 'forte'; texte = `En ligne depuis ${jours} j, déjà baissé de ${baissePct} % : vendeur sous pression`; }
  else if (jours >= 45) { niveau = 'moyenne'; texte = `En ligne depuis ${jours} j` + (baisses ? `, baisse de ${baissePct} %` : ', aucune baisse') + ' : négociation possible'; }
  else texte = `En ligne depuis ${jours} j` + (baisses ? `, déjà baissé de ${baissePct} %` : '');
  return { jours, baisses, baissePct, niveau, texte, republie: !!b.doublon_de };
}

/* ================== Étoiles ================== */
function etoilesSvg(n, big) {
  const plein = '<path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"/>';
  let h = '';
  for (let i = 1; i <= 5; i++) {
    const f = n >= i ? 1 : n >= i - 0.5 ? 0.5 : 0;
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    h += `<svg viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id="${id}"><stop offset="${f * 100}%" stop-color="var(--star)"/><stop offset="${f * 100}%" stop-color="var(--line)"/></linearGradient></defs><g fill="url(#${id})">${plein}</g></svg>`;
  }
  return `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} étoile${n > 1 ? 's' : ''} sur 5">${h}</span>`;
}

/* ================== Feuilles ================== */
const sheet = $('sheet'), scrim = $('scrim');
let onSheetClose = null, reloadPending = false;
function openSheet(title, html, onClick, full) {
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = html;
  $('sheetBody').onclick = onClick || null;
  sheet.classList.toggle('full', !!full);
  sheet.hidden = false; scrim.hidden = false; sheet.scrollTop = 0;
}
function closeSheet() {
  sheet.hidden = true; scrim.hidden = true; $('sheetBody').onclick = null; $('sheetBody').oninput = null;
  if (onSheetClose) { const f = onSheetClose; onSheetClose = null; f(); }
  if (location.hash.startsWith('#bien=')) history.replaceState(null, '', location.pathname);
  if (reloadPending) location.reload();
}
$('sheetClose').addEventListener('click', closeSheet);
scrim.addEventListener('click', closeSheet);
addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

/* ================== Toast ================== */
let tTimer = null, tUndo = null;
function toast(msg, undo) {
  clearTimeout(tTimer); tUndo = undo || null;
  $('toastMsg').textContent = msg; $('toastUndo').hidden = !undo;
  $('toast').classList.add('on');
  tTimer = setTimeout(() => { $('toast').classList.remove('on'); tUndo = null; }, 5000);
}
$('toastUndo').addEventListener('click', () => { if (tUndo) { tUndo(); tUndo = null; } clearTimeout(tTimer); $('toast').classList.remove('on'); });
function copier(text, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => toast('Copie impossible : sélectionne le texte à la main'));
}

/* ================== Connexion ================== */
function nomAppareil() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone'; if (/iPad/.test(ua)) return 'iPad'; if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC Windows'; if (/Mac/.test(ua)) return 'Mac'; return 'Appareil';
}
function extraireCode(v) {
  v = String(v || '').trim();
  const m = v.match(/appairer=([A-Za-z0-9]{6,12})/);
  if (m) return m[1].toUpperCase();
  return /^[A-Za-z0-9]{6,12}$/.test(v) ? v.toUpperCase() : '';
}
function modeJoin(m) {
  document.querySelectorAll('#joinMode button').forEach(b => b.classList.toggle('sel', b.dataset.mode === m));
  $('joinTel').hidden = m !== 'tel'; $('joinPc').hidden = m !== 'pc'; $('joinErr').textContent = '';
}
function showJoin(msg) {
  $('join').hidden = false; $('joinErr').textContent = msg || '';
  $('scanBtn').hidden = !('BarcodeDetector' in window && navigator.mediaDevices);
  modeJoin(/Windows|Macintosh|Linux x86/.test(navigator.userAgent) && !('ontouchstart' in window) ? 'pc' : 'tel');
}
$('joinMode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) modeJoin(b.dataset.mode); });
async function rejoindre(fn, btn, libelle) {
  $('joinErr').textContent = ''; btn.disabled = true; btn.textContent = 'Connexion…';
  try { await fn(); $('join').hidden = true; toast('Connecté. Chargement des biens…'); window.renderListe && renderListe(); }
  catch (e) { $('joinErr').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = libelle; }
}
function doAppairer(code) {
  if (!code) { $('joinErr').textContent = 'Ce n\'est pas un code d\'appairage valable.'; return; }
  rejoindre(() => Sync.appairer(code, nomAppareil()), $('joinBtn'), 'Appairer ce téléphone');
}
$('joinBtn').addEventListener('click', () => doAppairer(extraireCode($('joinCode').value)));
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') doAppairer(extraireCode($('joinCode').value)); });
function doLogin() {
  const id = $('loginId').value.trim(), mdp = $('loginMdp').value;
  if (!id || !mdp) { $('joinErr').textContent = 'Saisis l\'identifiant et le mot de passe.'; return; }
  rejoindre(() => Sync.login(id, mdp, nomAppareil()), $('loginBtn'), 'Se connecter');
}
$('loginBtn').addEventListener('click', doLogin);
$('loginMdp').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

let scanStream = null;
$('scanBtn').addEventListener('click', async () => {
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch (e) { $('joinErr').textContent = 'Accès à l\'appareil photo refusé.'; return; }
  $('join').hidden = true;
  openSheet('Scanner le QR code', '<video class="scan" id="scanVideo" playsinline muted></video><p class="note center">Vise le QR code affiché sur l\'ordinateur.</p>');
  const v = $('scanVideo'); v.srcObject = scanStream; await v.play().catch(() => {});
  const det = new window.BarcodeDetector({ formats: ['qr_code'] });
  let stop = false;
  onSheetClose = () => { stop = true; if (scanStream) scanStream.getTracks().forEach(t => t.stop()); scanStream = null; if (!Sync.state.auth) showJoin(); };
  (async function boucle() {
    if (stop) return;
    try { const c = await det.detect(v); const code = c.length && extraireCode(c[0].rawValue); if (code) { vib(20); closeSheet(); $('join').hidden = false; doAppairer(code); return; } } catch (e) {}
    setTimeout(boucle, 250);
  })();
});

/* ================== Synchro → écran ================== */
Sync.on(kinds => {
  if (kinds.indexOf('auth') >= 0) {
    if (Sync.state.revoked) showJoin('Cet appareil n\'a plus accès (révoqué ou session expirée). Reconnecte-toi.');
    else if (!Sync.state.auth) showJoin();
  }
  kinds.filter(k => k.startsWith('refus:')).forEach(k => toast('Modification refusée par le serveur : ' + k.slice(6)));
  if (kinds.indexOf('donnees') >= 0 || kinds.indexOf('sync') >= 0) { window.renderListe && renderListe(); window.rafraichirFiche && rafraichirFiche(); }
  if (kinds.indexOf('ouverture') >= 0) window.renderNouveautes && renderNouveautes();
  renderAlerte();
  const si = $('syncInfo'); if (si) si.textContent = syncLabel();
});
function syncLabel() {
  const st = Sync.state;
  if (!st.auth) return 'Non connecté';
  if (st.revoked) return 'Accès retiré : reconnecte-toi';
  let t = st.lastOk ? 'Synchronisé ' + ago(st.lastOk) : 'Jamais synchronisé';
  if (st.error) t = 'Hors ligne · dernière synchro ' + ago(st.lastOk);
  if (st.pending) t += ' · ' + st.pending + ' envoi' + (st.pending > 1 ? 's' : '') + ' en attente';
  return t;
}
// Une panne ne doit jamais ressembler à un marché calme : âge de la dernière collecte toujours visible si anormal.
function renderAlerte() {
  const el = $('alerte'); const runs = Sync.state.runs || [];
  if (!Sync.state.auth || !Sync.data.biens.size) { el.hidden = true; return; }
  const msgs = [];
  (Sync.state.communes || []).filter(c => c.actif).forEach(c => {
    const r = runs.find(x => x.commune === c.commune);
    if (!r) msgs.push(`${c.libelle} : aucune collecte enregistrée`);
    else if (Date.now() - r.debut > 30 * 3600000) msgs.push(`${c.libelle} : dernière collecte ${ago(r.debut)} — le scraper semble arrêté`);
  });
  const R = Sync.reglagesPour('golfe-juan');
  if (R._manquants.length) msgs.push('Réglages incomplets sur le serveur (' + R._manquants.join(', ') + ') : valeurs par défaut utilisées');
  if (Sync.state.error && Date.now() - Sync.state.lastOk > 3600000) msgs.push('Pas de connexion au serveur depuis ' + ago(Sync.state.lastOk).replace('il y a ', ''));
  el.hidden = !msgs.length; el.innerHTML = msgs.map(esc).join('<br>');
}

/* ================== Mises à jour ================== */
let swReg = null;
function applyUpdate() { if (!sheet.hidden) { reloadPending = true; return; } location.reload(); }
async function checkUpdate(out) {
  if (!swReg) { if (out) out.textContent = 'Mises à jour indisponibles ici.'; return; }
  if (out) out.textContent = 'Recherche…';
  try { await swReg.update(); } catch (e) { if (out) out.textContent = 'Pas de réseau. Deal v' + VERSION; return; }
  setTimeout(() => { if (out && !swReg.installing && !swReg.waiting) out.textContent = 'Deal v' + VERSION + ' est à jour.'; }, 1500);
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { swReg = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) applyUpdate(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
$('meBtn').addEventListener('click', () => window.ouvrirReglages && ouvrirReglages());

window.Deal = { $, esc, eur, eurS, ago, dateFr, J, S, save, applyLook, vib, openSheet, closeSheet, toast, copier, calculer, bienEffectif,
  curseursBien, fatigue, etoilesSvg, syncLabel, checkUpdate, appUrl, renderAlerte, VERSION, ENV, setOnSheetClose: f => { onSheetClose = f; } };

/* ================== Démarrage ================== */
(async function demarrer() {
  if (ENV !== 'prod') { const t = $('envTag'); t.textContent = ENV.toUpperCase(); t.hidden = false; t.classList.add('env-' + ENV); }
  applyLook();
  try { await Sync.charger(); } catch (e) { console.error(e); }
  const code = extraireCode((location.hash.match(/appairer=[A-Za-z0-9]+/) || [''])[0]);
  const bienHash = (location.hash.match(/bien=(\d+)/) || [])[1];
  if (code) history.replaceState(null, '', location.pathname);   // le code ne reste pas dans l'adresse
  window.renderListe && renderListe();
  renderAlerte();
  if (code && !Sync.state.auth) { showJoin(); modeJoin('tel'); $('joinCode').value = code; doAppairer(code); }
  else if (!Sync.state.auth) showJoin();
  else { Sync.sync(); if (bienHash && window.ouvrirFiche) ouvrirFiche(bienHash); }
  if (S.lastV && S.lastV !== VERSION) S.updNote = VERSION;
  S.lastV = VERSION; save();
  if (S.updNote === VERSION) setTimeout(() => { toast('Deal mis à jour (v' + VERSION + ')'); setTimeout(() => { delete S.updNote; save(); }, 4000); }, 500);
})();
