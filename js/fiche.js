/* Deal — fiche d'un bien : photos, verdict, simulateur à curseurs (recalcul instantané), caractéristiques corrigeables,
   annotations (favori, statut, notes), indice de fatigue et historique des prix. */
'use strict';
const CURSEURS = [
  { k: 'apport_pct', l: 'Apport', min: 0, max: 100, step: 5, f: v => v + ' %' },
  { k: 'taux_pct', l: 'Taux du crédit', min: 2, max: 6, step: 0.05, f: v => (+v).toFixed(2).replace('.', ',') + ' %' },
  { k: 'duree_ans', l: 'Durée du crédit', min: 5, max: 25, step: 1, f: v => v + ' ans' },
  { k: 'travaux_eur', l: 'Travaux', min: 0, max: 80000, step: 1000, f: v => Deal.eur(v) },
  { k: 'adr', l: 'Prix moyen par nuit (ADR)', min: 40, max: 300, step: 1, f: v => v + ' €' },
  { k: 'occ_pct', l: 'Occupation', min: 20, max: 85, step: 1, f: v => Math.round(v) + ' %' },
  { k: 'charges_mois', l: 'Charges fixes (copro incluse)', min: 100, max: 1500, step: 10, f: v => Deal.eur(v) + '/mois' },
  { k: 'meubles_eur', l: 'Budget meubles', min: 0, max: 20000, step: 500, f: v => Deal.eur(v) }
];
const DIST = [['0-3', '0-3 min'], ['3-7', '3-7 min'], ['7-12', '7-12 min'], ['12+', '> 12 min']];
const TRAV = [['aucun', 'Aucun'], ['leger', 'Léger'], ['moyen', 'Moyen'], ['lourd', 'Lourd']];
let F = null;   // fiche ouverte : { id, enCours }

function valeurDe(r, k) {
  const h = r.hypotheses;
  return { apport_pct: h.apport_pct, taux_pct: h.taux_pct, duree_ans: h.duree_ans, travaux_eur: h.travaux_eur, adr: h.adr,
           occ_pct: h.occ_pct, charges_mois: h.charges_mois, meubles_eur: h.meubles_eur }[k];
}
function metricsHtml(r) {
  const h = r.hypotheses;
  const ln = (t, v, cls) => `<dt${cls ? ` class="${cls}"` : ''}>${t}</dt><dd class="${cls || ''}">${v}</dd>`;
  const sg = n => `<span class="${n >= 0 ? 'pos' : 'neg'}">${Deal.eurS(n)}</span>`;
  return `<dl class="metrics">
    ${ln('Revenus bruts / an', Deal.eur(r.revenus_bruts_an))}
    ${ln('Revenus nets d\'exploitation / an', Deal.eur(r.revenus_nets_an))}
    ${ln(`Charges fixes / an <span class="note">(copro ${Deal.eur(h.copro_mois)}/mois · ${h.copro_source === 'annonce' ? 'annonce' : h.copro_source === 'curseur' ? 'saisie' : 'défaut'})</span>`, Deal.eur(h.charges_mois * 12))}
    ${ln('<b>Bénéfice année 1 hors crédit</b>', sg(r.net_avant_credit_an), 'key')}
    <hr>
    ${ln('Coût total du projet', Deal.eur(r.cout_total))}
    ${ln('Apport', Deal.eur(r.apport))}
    ${ln('Emprunt', Deal.eur(r.emprunt))}
    ${ln('Mensualité', Deal.eur(r.mensualite))}
    ${ln('Intérêts année 1', Deal.eur(r.interets_an1))}
    <hr>
    ${ln('Effort de trésorerie / mois', sg(r.effort_treso_mois))}
    ${ln('<b>Effort réel hors capital / mois</b>', sg(r.effort_hors_capital_mois), 'key')}
    ${ln('Rendement net', String(r.rendement_net_pct).replace('.', ',') + ' %')}
    <hr>
    ${ln('IS dû année 1', Deal.eur(r.is_du_an1))}
    ${ln(`IS économisé sur ${r.horizon_is_ans} ans (amortissements)`, r.gain_is_horizon > 0 ? Deal.eur(r.gain_is_horizon) : 'pas d\'IS à économiser')}
  </dl>
  <p class="note">L'effort hors capital ne compte que les intérêts : le capital remboursé entre dans ton patrimoine. ${r.gain_is_horizon > 0 ? '' : 'Pas de bénéfice imposable sur ' + r.horizon_is_ans + ' ans avec ces hypothèses.'}</p>`;
}
function verdictHtml(r, b) {
  const txt = r.statut === 'exclu' ? 'Exclu' : r.statut === 'rejet' ? 'Rejeté : ne couvre pas ses charges' :
    r.effort_hors_capital_mois >= 0 ? 'Autofinancé hors capital' : 'Effort de ' + Deal.eur(-r.effort_hors_capital_mois) + '/mois hors capital';
  return `<div class="verdict card">
    <div class="row">${r.statut === 'ok' ? Deal.etoilesSvg(r.etoiles, true) : ''}<span class="big">${esc(txt)}</span></div>
    ${r.raisons.length ? `<ul class="raisons">${r.raisons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function ficheHtml(b) {
  const a = Sync.data.annotations.get(b.lbc_id) || {};
  const r = Deal.calculer(b, F.enCours);
  const e = Deal.bienEffectif(b);
  const fat = Deal.fatigue(b);
  const sauves = Object.assign({}, a.curseurs || {}); delete sauves.physique;
  const corr = (a.curseurs && a.curseurs.physique) || {};
  const photos = (b.photos || []).map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1}" loading="${i < 2 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer">`).join('');
  const hist = (Sync.data.prix.get(b.lbc_id) || []).slice().reverse();
  const orig = b.doublon_de && Sync.data.biens.get(b.doublon_de);
  const sl = CURSEURS.map(c => {
    const v = valeurDe(r, c.k); const mod = c.k in F.enCours || c.k in sauves;
    return `<div class="slider"><div class="row"><label class="label" for="c_${c.k}">${c.l}</label><output id="o_${c.k}" class="${mod ? 'mod' : ''}">${c.f(v)}</output></div>
      <input type="range" id="c_${c.k}" data-c="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"></div>`;
  }).join('');
  const seg = (k, items, cur) => `<div class="seg four">${items.map(([v, l]) => `<button data-p="${k}" data-v="${v}" class="${cur === v ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
  const tg = (k, l) => `<button class="toggle" data-pt="${k}"><span>${l}${k in corr ? ' <span class="note">(corrigé)</span>' : ''}</span><span class="sw${e[k] ? ' on' : ''}"><i></i></span></button>`;
  const inconnus = (e.inconnus || []).filter(k => !(k in corr) && !(k === 'etat' && corr.niveau_travaux));
  return `
    <div class="photos">${photos || '<p class="vide">Pas de photo</p>'}</div>
    <div class="entete">
      <div><div class="px">${Deal.eur(b.prix)}</div>
        <div class="sub">${esc(DealListe.TYPES[b.type] || '')} · ${b.surface} m² · ${b.surface ? Math.round(b.prix / b.surface).toLocaleString('fr-FR') + ' €/m²' : ''} · DPE ${esc(b.dpe || '?')}${e.etage ? ' · ' + esc(e.etage) : ''}</div></div>
      <button class="round" data-fav aria-label="${a.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}" style="font-size:1.4em;color:var(--star)">${a.favori ? '★' : '☆'}</button>
    </div>
    <p class="note">${esc(b.titre)}</p>
    <a class="lien" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">Voir l'annonce sur LeBonCoin ↗</a>
    <div id="verdict">${verdictHtml(r, b)}</div>
    <div class="card field"><span class="label">Vendeur qui fatigue</span>
      <span class="${fat.niveau === 'forte' ? 'pos' : ''}" style="font-weight:800">${esc(fat.texte)}</span>
      ${orig ? `<span class="note">Republication de l'annonce ${esc(orig.lbc_id)} (ancienneté cumulée).</span>` : fat.republie ? '<span class="note">Republication d\'une annonce retirée (ancienneté cumulée).</span>' : ''}
      ${hist.length > 1 ? `<div class="hist">${hist.map(p => `<div class="row"><span>${Deal.dateFr(p.ts)}</span><b>${Deal.eur(p.prix)}</b></div>`).join('')}</div>` : ''}
    </div>
    <h3 class="h3">Simulateur</h3>
    <div class="card field" id="sliders">${sl}
      <div class="row wrap"><button class="small acc grow" data-save>Garder ces réglages pour ce bien</button><button class="small grow" data-reset>Revenir aux réglages globaux</button></div>
      <p class="note">${Object.keys(sauves).length ? 'Ce bien a ses propres réglages (en couleur). ' : ''}Les réglages globaux se changent dans Réglages → Financement.</p>
    </div>
    <div class="card" id="metrics">${metricsHtml(r)}</div>
    <h3 class="h3">Caractéristiques</h3>
    <div class="card field">
      ${inconnus.length ? `<p class="note">Inconnu dans l'annonce : ${esc(inconnus.map(k => ({ distance_mer: 'distance à la mer', etat: 'état / travaux', dpe: 'DPE' }[k] || k)).join(', '))}. Corrige ci-dessous si tu sais.</p>` : ''}
      <span class="label">Distance à la mer${'distance_mer' in corr ? ' <span class="note">(corrigée)</span>' : e.distance_mer ? '' : ' <span class="note">(défaut de la commune)</span>'}</span>
      ${seg('distance_mer', DIST, e.distance_mer || Sync.reglagesPour(b.commune).defauts_commune.distance_mer)}
      <span class="label">Travaux à prévoir${'niveau_travaux' in corr ? ' <span class="note">(corrigé)</span>' : ''}</span>
      ${seg('niveau_travaux', TRAV, e.niveau_travaux || 'leger')}
      <div class="carac">${tg('vue_mer', 'Vue mer')}${tg('terrasse', 'Terrasse / jardin')}${tg('parking', 'Parking')}${tg('clim', 'Climatisation')}</div>
      ${e.charges_copro_an ? `<p class="note">Charges de copropriété annoncées : ${Deal.eur(e.charges_copro_an)}/an.</p>` : ''}
      ${Object.keys(corr).length ? '<button class="small" data-preset>Annuler mes corrections</button>' : ''}
    </div>
    <h3 class="h3">Suivi</h3>
    <div class="card field">
      <div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))">${Object.entries(DealListe.STATUTS).map(([v, l]) => `<button data-st="${v}" class="${(a.statut || '') === v ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <label class="label" for="notes">Notes</label>
      <textarea class="input area" id="notes" maxlength="5000" placeholder="Visite, échanges avec l'agence, points à vérifier…">${esc(a.notes || '')}</textarea>
    </div>
    <p class="note center">Annonce ${esc(b.lbc_id)} · vue pour la première fois le ${Deal.dateFr(b.premiere_vue)} · mise à jour ${Deal.ago(b.derniere_vue)} · scoring v${esc(r.version)}</p>`;
}

function majSimulateur(b) {
  const r = Deal.calculer(b, F.enCours);
  CURSEURS.forEach(c => { const o = $('o_' + c.k); if (o) { o.textContent = c.f(valeurDe(r, c.k)); o.classList.toggle('mod', c.k in F.enCours || c.k in (Deal.curseursBien(b) || {})); } });
  $('verdict').innerHTML = verdictHtml(r, b);
  $('metrics').innerHTML = metricsHtml(r);
}

function ouvrirFiche(id) {
  const b = Sync.data.biens.get(String(id));
  if (!b) { Deal.toast('Ce bien n\'est plus en ligne.'); return; }
  F = { id: b.lbc_id, enCours: {} };
  Deal.openSheet(b.titre || 'Bien', ficheHtml(b), clicFiche, true);
  history.replaceState(null, '', location.pathname + '#bien=' + b.lbc_id);
  Deal.setOnSheetClose(() => { F = null; });
  $('sheetBody').oninput = e => {
    const s = e.target.closest('[data-c]'); if (!s) return;
    F.enCours[s.dataset.c] = +s.value; majSimulateur(b);
  };
  const n = $('notes'); let tn = null;
  n.addEventListener('input', () => { clearTimeout(tn); tn = setTimeout(() => Sync.annoter(b.lbc_id, { notes: n.value }), 800); });
  n.addEventListener('blur', () => { clearTimeout(tn); const a = Sync.data.annotations.get(b.lbc_id) || {}; if ((a.notes || '') !== n.value) Sync.annoter(b.lbc_id, { notes: n.value }); });
}
function rerendre() {
  if (!F) return; const b = Sync.data.biens.get(F.id); if (!b) return;
  const sc = $('sheet').scrollTop, foc = document.activeElement && document.activeElement.id;
  if (foc === 'notes') return;   // ne pas interrompre la saisie
  $('sheetBody').innerHTML = ficheHtml(b); $('sheet').scrollTop = sc;
  const n = $('notes'); let tn = null;
  n.addEventListener('input', () => { clearTimeout(tn); tn = setTimeout(() => Sync.annoter(b.lbc_id, { notes: n.value }), 800); });
  n.addEventListener('blur', () => { clearTimeout(tn); const a = Sync.data.annotations.get(b.lbc_id) || {}; if ((a.notes || '') !== n.value) Sync.annoter(b.lbc_id, { notes: n.value }); });
}
function clicFiche(e) {
  const b = Sync.data.biens.get(F && F.id); if (!b) return;
  const a = Sync.data.annotations.get(b.lbc_id) || {};
  const cur = Object.assign({}, a.curseurs || {});
  const t = e.target;
  if (t.closest('[data-fav]')) { Sync.annoter(b.lbc_id, { favori: !a.favori }); Deal.vib(8); setTimeout(rerendre, 0); return; }
  const st = t.closest('[data-st]');
  if (st) { Sync.annoter(b.lbc_id, { statut: st.dataset.st }); setTimeout(rerendre, 0); return; }
  if (t.closest('[data-save]')) {
    const garde = Object.assign(cur, F.enCours); F.enCours = {};
    Sync.annoter(b.lbc_id, { curseurs: garde }); Deal.toast('Réglages enregistrés pour ce bien'); setTimeout(rerendre, 0); return;
  }
  if (t.closest('[data-reset]')) {
    const phys = cur.physique; F.enCours = {};
    Sync.annoter(b.lbc_id, { curseurs: phys ? { physique: phys } : {} }); Deal.toast('Réglages globaux rétablis'); setTimeout(rerendre, 0); return;
  }
  const p = t.closest('[data-p]'), pt = t.closest('[data-pt]');
  if (p || pt) {
    const phys = Object.assign({}, cur.physique || {});
    if (p) phys[p.dataset.p] = p.dataset.v;
    else phys[pt.dataset.pt] = !Deal.bienEffectif(b)[pt.dataset.pt];
    if (p && p.dataset.p === 'niveau_travaux') delete F.enCours.travaux_eur;   // le niveau recalcule les travaux
    cur.physique = phys; Sync.annoter(b.lbc_id, { curseurs: cur }); setTimeout(rerendre, 0); return;
  }
  if (t.closest('[data-preset]')) { delete cur.physique; Sync.annoter(b.lbc_id, { curseurs: cur }); setTimeout(rerendre, 0); }
}
// Données mises à jour pendant que la fiche est ouverte (synchro) : on rafraîchit sans perdre les curseurs en cours.
window.rafraichirFiche = () => { if (F && !document.querySelector('#sliders input:active')) rerendre(); };
window.ouvrirFiche = ouvrirFiche;
