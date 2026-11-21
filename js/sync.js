/* Deal — synchronisation avec n8n (même principe que Tribu).
   - Copie locale dans IndexedDB (une base par environnement) : l'app s'ouvre instantanément et marche hors ligne.
   - Appels en POST "text/plain" avec le jeton dans le corps : pas de requête préalable CORS.
   - Lecture : action "etat" avec "since" (seuls les changements). Écritures (annotations, réglages) : file d'attente hors ligne.
   - Rythme : à l'ouverture, au retour sur l'app, et toutes les 60 s quand elle est visible (les données changent 1 fois/jour). */
(function () {
  'use strict';
  const ENV = window.DEAL_ENV || 'local';
  const BASE = 'https://monn8n06.duckdns.org/webhook/' + (ENV === 'prod' ? 'deal' : 'deal-test') + '/api';
  const P = 'deal.' + ENV + '.';
  const POLL_MS = 60000;

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(P + k); } catch (e) {} }
  };

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('deal-' + ENV, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('biens', { keyPath: 'lbc_id' });
        d.createObjectStore('prix', { keyPath: 'k' });
        d.createObjectStore('annotations', { keyPath: 'lbc_id' });
        d.createObjectStore('reglages', { keyPath: 'k' });
        d.createObjectStore('file', { keyPath: 'n', autoIncrement: true });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode); let out;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      out = fn(t);
    });
  }
  const getAll = (store) => tx([store], 'readonly', t => req2p(t.objectStore(store).getAll())).then(p => p);

  /* ---------- Données en mémoire ---------- */
  const M = { biens: new Map(), prix: new Map(), annotations: new Map(), reglages: new Map(), pret: false };
  async function charger() {
    const [b, p, a, r] = await Promise.all(['biens', 'prix', 'annotations', 'reglages'].map(getAll));
    M.biens = new Map((await b).map(x => [x.lbc_id, x]));
    M.prix = new Map();
    (await p).forEach(x => { if (!M.prix.has(x.lbc_id)) M.prix.set(x.lbc_id, []); M.prix.get(x.lbc_id).push(x); });
    M.prix.forEach(l => l.sort((x, y) => x.ts - y.ts));
    M.annotations = new Map((await a).map(x => [x.lbc_id, x]));
    M.reglages = new Map((await r).map(x => [x.k, x]));
    M.pret = true;
  }

  /* ---------- État ---------- */
  const S = {
    auth: ls.get('auth', null),            // { jeton, appareil, type }
    since: ls.get('since', 0),
    lastOk: ls.get('lastOk', 0),
    visitePrecedente: ls.get('visitePrec', 0),
    communes: ls.get('communes', []),
    runs: ls.get('runs', []),
    pending: 0, busy: false, again: false, revoked: false, error: '', ouvert: false
  };
  const listeners = [];
  function emit(kinds) { listeners.forEach(f => { try { f(kinds || []); } catch (e) { console.error(e); } }); }

  async function post(body) {
    const r = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, json: j };
  }
  async function countPending() { S.pending = await tx(['file'], 'readonly', t => req2p(t.objectStore('file').count())).then(p => p); return S.pending; }

  /* ---------- Envoi de la file d'attente ---------- */
  async function vider() {
    const ops = await getAll('file');
    for (const o of ops) {
      const res = await post(Object.assign({ jeton: S.auth.jeton }, o.op));
      if (res.status === 401) { S.revoked = true; throw new Error('jeton'); }
      if (res.json && res.json.ok) { await tx(['file'], 'readwrite', t => { t.objectStore('file').delete(o.n); }); continue; }
      if (res.status === 400) {   // refusé par le serveur : on l'abandonne et on le signale
        await tx(['file'], 'readwrite', t => { t.objectStore('file').delete(o.n); });
        emit(['refus:' + ((res.json && res.json.erreur) || 'requête')]);
        continue;
      }
      throw new Error('Réponse inattendue (' + res.status + ')');
    }
  }

  /* ---------- Synchronisation ---------- */
  async function sync() {
    if (!S.auth || S.revoked) return;
    if (S.busy) { S.again = true; return; }
    S.busy = true;
    try {
      await vider();
      const ouverture = !S.ouvert;
      const res = await post({ jeton: S.auth.jeton, action: 'etat', since: S.since, ouverture });
      if (res.status === 401) { S.revoked = true; S.error = 'jeton'; emit(['auth']); return; }
      if (!res.json || !res.json.ok) throw new Error('Réponse inattendue (' + res.status + ')');
      const j = res.json;
      const enAttente = new Set((await getAll('file')).filter(o => o.op.action === 'annoter').map(o => o.op.lbc_id));
      await tx(['biens', 'prix', 'annotations', 'reglages'], 'readwrite', t => {
        const sb = t.objectStore('biens'), sp = t.objectStore('prix'), sa = t.objectStore('annotations'), sr = t.objectStore('reglages');
        (j.biens || []).forEach(b => {
          if (b.supprime) { sb.delete(b.lbc_id); M.biens.delete(b.lbc_id); }
          else { sb.put(b); M.biens.set(b.lbc_id, b); }
        });
        (j.prix || []).forEach(p => {
          const x = { k: p.lbc_id + '|' + p.ts, lbc_id: p.lbc_id, ts: p.ts, prix: p.prix };
          sp.put(x);
          const l = M.prix.get(p.lbc_id) || []; if (!l.some(y => y.ts === p.ts)) { l.push(x); l.sort((a, b) => a.ts - b.ts); } M.prix.set(p.lbc_id, l);
        });
        (j.annotations || []).forEach(a => { if (enAttente.has(a.lbc_id)) return; sa.put(a); M.annotations.set(a.lbc_id, a); });
        if (Array.isArray(j.reglages) && j.reglages.length) {
          sr.clear(); M.reglages.clear();
          j.reglages.forEach(r => { const x = Object.assign({ k: r.cle + '|' + r.commune }, r); sr.put(x); M.reglages.set(x.k, x); });
        }
      });
      if (ouverture) { S.ouvert = true; S.visitePrecedente = j.visite_precedente || 0; ls.set('visitePrec', S.visitePrecedente); }
      S.communes = j.communes || S.communes; ls.set('communes', S.communes);
      S.runs = j.derniers_runs || S.runs; ls.set('runs', S.runs);
      S.since = j.now || S.since; ls.set('since', S.since);
      S.lastOk = Date.now(); ls.set('lastOk', S.lastOk);
      S.error = '';
      await countPending();
      emit(['donnees', 'sync'].concat(ouverture ? ['ouverture'] : []));
    } catch (err) {
      S.error = String(err && err.message || err);
      if (S.revoked) emit(['auth']); else emit(['sync']);
    } finally {
      S.busy = false;
      if (S.again) { S.again = false; setTimeout(sync, 300); }
    }
  }

  /* ---------- Écritures (hors ligne possible) ---------- */
  async function enfiler(op) {
    await tx(['file'], 'readwrite', t => {
      const f = t.objectStore('file');
      if (op.action === 'annoter' || op.action === 'reglage') {   // seule la dernière version compte
        const cle = op.action === 'annoter' ? op.lbc_id : op.cle + '|' + op.commune;
        req2p(f.getAll()).then(all => all.forEach(o => {
          const c2 = o.op.action === 'annoter' ? o.op.lbc_id : o.op.cle + '|' + o.op.commune;
          if (o.op.action === op.action && c2 === cle) f.delete(o.n);
        })).then(() => f.add({ op }));
      } else f.add({ op });
    });
    await countPending();
    sync();
  }
  async function annoter(lbc_id, patch) {
    const a = Object.assign({ lbc_id, favori: false, statut: '', notes: '', curseurs: {} }, M.annotations.get(lbc_id) || {}, patch, { maj: Date.now() });
    M.annotations.set(lbc_id, a);
    await tx(['annotations'], 'readwrite', t => { t.objectStore('annotations').put(a); });
    emit(['donnees']);
    const cur = Object.assign({}, a.curseurs || {});
    const physique = cur.physique; delete cur.physique;
    await enfiler({ action: 'annoter', lbc_id, favori: !!a.favori, statut: a.statut || '', notes: a.notes || '', curseurs: cur, physique: physique || {} });
  }
  async function reglage(cle, commune, valeur) {
    const x = { k: cle + '|' + commune, cle, commune, valeur, maj: Date.now() };
    M.reglages.set(x.k, x);
    await tx(['reglages'], 'readwrite', t => { t.objectStore('reglages').put(x); });
    emit(['donnees']);
    await enfiler({ action: 'reglage', cle, commune, valeur });
  }
  /* Actions en ligne uniquement (validées par le serveur) */
  async function appel(action, extra) {
    if (!S.auth) throw new Error('Non connecté');
    let res;
    try { res = await post(Object.assign({ jeton: S.auth.jeton, action }, extra || {})); }
    catch (e) { throw new Error('Pas de réseau : réessaie plus tard.'); }
    if (res.status === 401 && (!res.json || res.json.erreur === 'jeton' || res.json.erreur === 'session expirée')) { S.revoked = true; emit(['auth']); throw new Error('Accès expiré ou retiré.'); }
    if (!res.json) throw new Error('Le serveur ne répond pas (' + res.status + ').');
    if (!res.json.ok) { const e = new Error(res.json.erreur || 'refusé'); e.detail = res.json; throw e; }
    return res.json;
  }

  /* ---------- Réglages de calcul d'une commune ---------- */
  function reglagesPour(commune) {
    const g = (cle, c) => { const r = M.reglages.get(cle + '|' + c); return r ? r.valeur : null; };
    const D = window.DealScoring.DEFAUTS;
    const R = { benchmarks: g('benchmarks', commune), defauts_commune: g('defauts_commune', commune), ajustements: g('ajustements', 'global'),
                travaux_m2: g('travaux_m2', 'global'), fin: g('fin', 'global'), paliers: g('paliers', 'global') };
    const manquants = Object.keys(R).filter(k => !R[k]);
    manquants.forEach(k => { R[k] = D[k]; });
    R._manquants = manquants;
    return window.DealScoring.normaliserReglages(R);
  }

  /* ---------- Connexion ---------- */
  async function connecter(body) {
    let res;
    try { res = await post(body); } catch (e) { throw new Error('Le serveur ne répond pas. Vérifie le réseau et réessaie.'); }
    if (res.status === 401) throw new Error(body.action === 'login' ? 'Identifiant ou mot de passe incorrect.' : 'Ce code n\'est pas (ou plus) valable. Génère un nouveau QR code sur l\'ordinateur.');
    if (!res.json || !res.json.ok) throw new Error('Le serveur ne répond pas (' + res.status + ').');
    S.auth = { jeton: res.json.jeton, appareil: res.json.appareil, type: body.action === 'login' ? 'pc' : 'mobile' }; ls.set('auth', S.auth);
    S.revoked = false; S.since = 0; ls.set('since', 0); S.ouvert = false;
    await sync();
    return S.auth;
  }
  const login = (identifiant, mot_de_passe, nom) => connecter({ action: 'login', identifiant, mot_de_passe, nom });
  const appairer = (code, nom) => connecter({ action: 'appairer', code, nom });
  async function quitter() {
    S.auth = null; ['auth', 'since', 'lastOk', 'visitePrec', 'communes', 'runs'].forEach(ls.del);
    S.since = 0; S.lastOk = 0; S.revoked = false; S.ouvert = false;
    await tx(['biens', 'prix', 'annotations', 'reglages', 'file'], 'readwrite', t => ['biens', 'prix', 'annotations', 'reglages', 'file'].forEach(s => t.objectStore(s).clear()));
    M.biens.clear(); M.prix.clear(); M.annotations.clear(); M.reglages.clear();
    S.pending = 0; emit(['auth', 'donnees']);
  }

  /* ---------- Rythme ---------- */
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  addEventListener('online', () => sync());
  countPending().catch(() => {});

  window.DealSync = {
    state: S, data: M, BASE, ENV, store: ls,
    on(f) { listeners.push(f); },
    charger, sync, annoter, reglage, appel, login, appairer, quitter, reglagesPour
  };
})();
