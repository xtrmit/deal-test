/* Deal — réglages : financement global, benchmarks, critères de recherche (garde-fou budget Apify),
   appareils (ajouter un téléphone par QR, révoquer), mot de passe, affichage, version. */
'use strict';
const COUT_ANNONCE = 0.00079, COUT_RUN = 0.005;
const projection = limit => Math.round((limit * COUT_ANNONCE + COUT_RUN) * 31 * 100) / 100;

function ouvrirReglages() {
  const S = Deal.S;
  const R = Sync.reglagesPour('golfe-juan');
  const fin = R.fin;
  const commune = (Sync.state.communes || [])[0];
  const cr = (commune && commune.criteres) || {};
  const pc = Sync.state.auth && Sync.state.auth.type === 'pc';
  const seg = (name, items, cur) => `<div class="seg">${items.map(([v, l, st]) => `<button data-${name}="${v}" class="${String(cur) === String(v) ? 'sel' : ''}"${st ? ` style="${st}"` : ''}>${l}</button>`).join('')}</div>`;
  const rg = (k, l, min, max, step, v, f) => `<div class="slider"><div class="row"><label class="label" for="g_${k}">${l}</label><output id="go_${k}">${f(v)}</output></div><input type="range" id="g_${k}" data-g="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
  const B = R.benchmarks;
  const bench = ['studio', 't2', 't3', 't4'].map(t => `<tr><th>${DealListe.TYPES[t]}</th>${['adr', 'occ', 'charges', 'copro'].map(k => `<td><input class="input" style="height:38px;padding:0 6px" type="number" inputmode="decimal" data-b="${t}.${k}" value="${B[t] ? B[t][k] : ''}"></td>`).join('')}</tr>`).join('');
  Deal.openSheet('Réglages', `
    <div class="card row"><span class="grow"><b>${pc ? 'Ordinateur' : 'Téléphone'}</b><br><span class="note" id="syncInfo">${esc(Deal.syncLabel())}</span></span><button class="small" data-act="sync">Synchroniser</button></div>

    <h3 class="h3">Financement (tous les biens)</h3>
    <div class="card field">
      ${rg('apport_pct', 'Apport', 0, 100, 5, fin.apport_pct, v => v + ' %')}
      ${rg('taux_pct', 'Taux', 2, 6, 0.05, fin.taux_pct, v => (+v).toFixed(2).replace('.', ',') + ' %')}
      ${rg('duree_ans', 'Durée', 5, 25, 1, fin.duree_ans, v => v + ' ans')}
      ${rg('assurance_emprunteur_pct', 'Assurance emprunteur (% du capital initial / an)', 0, 1.5, 0.05, fin.assurance_emprunteur_pct, v => (+v).toFixed(2) + ' %')}
      <p class="note">Référence : 20 % du prix / 4 % / 15 ans. Le financement change le cash-flow, pas les étoiles. Les réglages propres au bien restent prioritaires.</p>
      <label class="label" for="g_is_autre">IS que ta société paie déjà par an (hors ce bien)</label>
      <input class="input" type="number" inputmode="numeric" min="0" step="500" id="g_is_autre" value="${fin.is_autre_eur || 0}">
      <p class="note">0 = le bien est seul dans sa société. Sinon, sa perte fiscale (intérêts, amortissements, charges) réduit cet IS chaque année, et le cash-flow en tient compte. Ex. 20 000 € d'IS ≈ 97 000 € de bénéfice.</p>
    </div>

    <h3 class="h3">Benchmarks Golfe-Juan</h3>
    <div class="card field" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.85em"><thead><tr><th></th><th>ADR €</th><th>Occ. %</th><th>Charges hors copro €/mois</th><th>Copro défaut €/mois</th></tr></thead><tbody>${bench}</tbody></table>
      <button class="small acc" data-act="bench">Enregistrer les benchmarks</button>
      <p class="note">Hypothèses de simulation à valider avec des comparables locaux et des devis. Occupation sur les nuits ouvertes, hors fermetures. Les budgets déjà enregistrés restent actifs.</p>
      <button class="small" data-act="defaults-v2">Remplacer les réglages globaux par les valeurs v2</button>
      <p class="note">Ce bouton remplace financement, budgets, benchmarks Golfe-Juan et barème. Il conserve les corrections propres à chaque bien.</p>
    </div>

    <h3 class="h3">Critères de recherche</h3>
    <div class="card field">
      <div class="row"><label class="grow"><span class="label">Prix min €</span><input class="input" type="number" id="crPmin" value="${cr.prix_min || ''}"></label><label class="grow"><span class="label">Prix max €</span><input class="input" type="number" id="crPmax" value="${cr.prix_max || ''}"></label></div>
      <div class="row"><label class="grow"><span class="label">Surface min m²</span><input class="input" type="number" id="crSmin" value="${cr.surface_min || ''}"></label><label class="grow"><span class="label">Surface max m²</span><input class="input" type="number" id="crSmax" value="${cr.surface_max || ''}"></label></div>
      <label><span class="label">Annonces maximum par collecte</span><input class="input" type="number" id="crLim" value="${cr.limit || 100}"></label>
      <p class="note" id="crProj"></p>
      <button class="small acc" data-act="criteres">Enregistrer les critères</button>
      <p class="note">Zone LeBonCoin fixe (identifiant interne, jamais modifié). Le serveur refuse tout réglage qui dépasserait le budget Apify de ${commune ? commune.budget_mensuel_usd : 3} $/mois. Pris en compte à la prochaine collecte, après la bascule.</p>
    </div>

    <h3 class="h3">Appareils</h3>
    <div class="card field" id="appareils"><p class="note">Chargement…</p></div>
    ${pc ? '<button class="primary" data-act="inviter">Ajouter un téléphone (QR code)</button>' : ''}

    ${pc ? `<h3 class="h3">Mot de passe</h3>
    <div class="card field">
      <input class="input" type="password" id="mdpA" placeholder="Mot de passe actuel" autocomplete="current-password">
      <input class="input" type="password" id="mdpN" placeholder="Nouveau (10 caractères minimum)" autocomplete="new-password">
      <button class="small" data-act="mdp">Changer le mot de passe</button>
    </div>` : ''}

    <h3 class="h3">Affichage</h3>
    <div class="field"><span class="label">Thème</span>${seg('theme', [['auto', 'Auto'], ['clair', 'Clair'], ['sombre', 'Sombre']], S.theme)}</div>
    <div class="field"><span class="label">Taille du texte</span>${seg('fs', [[0, 'A', 'font-size:14px'], [1, 'A', 'font-size:17px'], [2, 'A', 'font-size:21px']], S.fs)}</div>

    <div class="card row"><span class="grow"><b>Deal v${esc(Deal.VERSION)}</b> <span class="note">${esc(Deal.ENV.toUpperCase())}</span><br><span class="note" id="majInfo"></span></span><button class="small" data-act="maj">Vérifier</button></div>
    <button class="ghost danger" data-act="quitter">Déconnecter cet appareil</button>
  `, clicReglages);
  majProjection();
  ['crLim'].forEach(id => $(id).addEventListener('input', majProjection));
  let tg = null;
  let ti = null;
  $('sheetBody').oninput = e => {
    if (e.target.id === 'g_is_autre') {
      clearTimeout(ti);
      ti = setTimeout(() => {
        const f = Object.assign({}, Sync.reglagesPour('golfe-juan').fin, { is_autre_eur: Math.max(0, +e.target.value || 0) });
        Sync.reglage('fin', 'global', f); Deal.toast('IS de ta société pris en compte');
      }, 700);
      return;
    }
    const s = e.target.closest('[data-g]'); if (!s) return;
    const fmt = { apport_pct: v => v + ' %', taux_pct: v => (+v).toFixed(2).replace('.', ',') + ' %', duree_ans: v => v + ' ans', assurance_emprunteur_pct: v => (+v).toFixed(2) + ' %' }[s.dataset.g];
    $('go_' + s.dataset.g).textContent = fmt(s.value);
    clearTimeout(tg);
    tg = setTimeout(() => {
      const f = Object.assign({}, Sync.reglagesPour('golfe-juan').fin);
      ['apport_pct', 'taux_pct', 'duree_ans', 'assurance_emprunteur_pct'].forEach(k => { f[k] = +$('g_' + k).value; });
      Sync.reglage('fin', 'global', f); Deal.toast('Financement mis à jour : cash-flow recalculé');
    }, 500);
  };
  chargerAppareils();
}
function majProjection() {
  const lim = +$('crLim').value || 0, p = projection(lim);
  const c = (Sync.state.communes || [])[0], budget = c ? c.budget_mensuel_usd : 3;
  $('crProj').innerHTML = `Coût estimé : <b class="${p > budget ? 'neg' : 'pos'}">${p.toFixed(2).replace('.', ',')} $/mois</b> pour ${budget} $ de budget` + (p > budget ? ' — sera refusé' : '');
}
async function chargerAppareils() {
  const el = $('appareils'); if (!el) return;
  try {
    const j = await Sync.appel('appareils');
    const l = j.appareils.filter(a => a.actif);
    el.innerHTML = l.map(a => `<div class="row"><span class="grow"><b>${esc(a.nom)}</b>${a.appareil === j.moi ? ' <span class="bdg new">cet appareil</span>' : ''}<br><span class="note">${a.type === 'pc' ? 'Ordinateur' : 'Téléphone'} · ajouté le ${Deal.dateFr(a.cree)} · vu ${Deal.ago(a.derniere_visite)}</span></span>${a.appareil !== j.moi ? `<button class="small danger" data-rev="${esc(a.appareil)}">Révoquer</button>` : ''}</div>`).join('') || '<p class="note">Aucun appareil actif.</p>';
  } catch (e) { el.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
async function inviter() {
  let j;
  try { j = await Sync.appel('inviter'); } catch (e) { Deal.toast(e.message); return; }
  const lien = Deal.appUrl() + '#appairer=' + j.code;
  Deal.openSheet('Ajouter un téléphone', `
    <div class="qr">${DealQR.svg(lien, { ink: '#16292C', bg: '#FFFFFF' })}</div>
    <p class="note center">Scanne ce QR code avec l'appareil photo du téléphone, puis installe Deal sur l'écran d'accueil.</p>
    <div class="code">${esc(j.code)}</div>
    <p class="note center" id="invExp"></p>
    <div class="row"><button class="small grow" data-act="copier">Copier le lien</button><button class="small grow" data-act="retour">Retour aux réglages</button></div>
  `, e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'copier') Deal.copier(lien, 'Lien copié');
    if (b.dataset.act === 'retour') ouvrirReglages();
  });
  const t = setInterval(() => {
    const el = $('invExp'); if (!el) { clearInterval(t); return; }
    const s = Math.max(0, Math.round((j.expire - Date.now()) / 1000));
    el.textContent = s ? `Valable encore ${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s, une seule fois.` : 'Expiré : génère un nouveau QR code.';
    if (!s) clearInterval(t);
  }, 1000);
}
async function clicReglages(e) {
  const t = e.target;
  const th = t.closest('button[data-theme]'), fs = t.closest('button[data-fs]');
  if (th) { Deal.S.theme = th.dataset.theme; Deal.save(); Deal.applyLook(); th.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === th)); return; }
  if (fs) { Deal.S.fs = +fs.dataset.fs; Deal.save(); Deal.applyLook(); fs.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === fs)); return; }
  const rev = t.closest('[data-rev]');
  if (rev) {
    if (!confirm('Révoquer cet appareil ? Il devra être appairé de nouveau.')) return;
    try { await Sync.appel('revoquer', { appareil: rev.dataset.rev }); Deal.toast('Appareil révoqué'); chargerAppareils(); } catch (err) { Deal.toast(err.message); }
    return;
  }
  const b = t.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'sync') { Sync.sync(); Deal.toast('Synchronisation…'); }
  else if (act === 'maj') Deal.checkUpdate($('majInfo'));
  else if (act === 'inviter') inviter();
  else if (act === 'defaults-v2') {
    b.disabled = true;
    try {
      const D = JSON.parse(JSON.stringify(window.DealScoring.DEFAUTS));
      for (const k of ['benchmarks', 'defauts_commune', 'ajustements', 'travaux_m2', 'fin', 'paliers']) {
        await Sync.reglage(k, k === 'benchmarks' || k === 'defauts_commune' ? 'golfe-juan' : 'global', D[k]);
      }
      Deal.toast('Valeurs v2 enregistrées ; corrections par bien conservées'); ouvrirReglages();
    } catch (err) { b.disabled = false; Deal.toast(err.message); }
  }
  else if (act === 'bench') {
    const B = JSON.parse(JSON.stringify(Sync.reglagesPour('golfe-juan').benchmarks));
    let ok = true;
    document.querySelectorAll('[data-b]').forEach(i => { const [ty, k] = i.dataset.b.split('.'); const v = Number(i.value); if (!isFinite(v) || i.value === '' || v < 0) ok = false; else B[ty][k] = v; });
    if (!ok) { Deal.toast('Valeurs invalides : nombres positifs uniquement'); return; }
    Sync.reglage('benchmarks', 'golfe-juan', B); Deal.toast('Benchmarks enregistrés');
  }
  else if (act === 'criteres') {
    const c = (Sync.state.communes || [])[0]; if (!c) return;
    const cr = { prix_min: +$('crPmin').value, prix_max: +$('crPmax').value, surface_min: +$('crSmin').value, surface_max: +$('crSmax').value, limit: +$('crLim').value };
    b.disabled = true;
    try {
      const j = await Sync.appel('criteres', { commune: c.commune, criteres: cr });
      c.criteres = j.criteres; Sync.store.set('communes', Sync.state.communes);
      Deal.toast(`Critères enregistrés (${String(j.projection_usd).replace('.', ',')} $/mois estimés)`);
    } catch (err) {
      const d = err.detail || {};
      Deal.toast(d.erreur === 'budget' ? `Refusé : ${String(d.projection_usd).replace('.', ',')} $/mois > budget ${d.budget_usd} $. Maximum ${d.limit_max} annonces par collecte.` : 'Refusé : ' + err.message);
    } finally { b.disabled = false; }
  }
  else if (act === 'mdp') {
    try { await Sync.appel('mot_de_passe', { actuel: $('mdpA').value, nouveau: $('mdpN').value }); Deal.toast('Mot de passe changé'); $('mdpA').value = $('mdpN').value = ''; }
    catch (err) { Deal.toast(err.message === 'mot de passe actuel' ? 'Mot de passe actuel incorrect' : err.message); }
  }
  else if (act === 'quitter') {
    if (!confirm('Déconnecter cet appareil ? Les données locales seront effacées (elles restent sur le serveur).')) return;
    try { await Sync.appel('revoquer', { appareil: Sync.state.auth.appareil }); } catch (e) {}
    await Sync.quitter(); Deal.closeSheet();
  }
}
window.ouvrirReglages = ouvrirReglages;
