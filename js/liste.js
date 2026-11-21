/* Deal — liste des biens : calcul de chaque bien avec les réglages en vigueur, filtres, tri, nouveautés. */
'use strict';
const STATUTS = { '': 'Sans statut', a_voir: 'À voir', contacte: 'Contacté', visite: 'Visité', offre: 'Offre', ecarte: 'Écarté', achete: 'Acheté' };
const TYPES = { studio: 'Studio', t2: 'T2', t3: 'T3', t4: 'T4+' };
const F0 = { texte: '', min: 0, type: '', favoris: false, statut: '', masquerEcartes: true, voirExclus: false, tri: 'etoiles', seulsNouveaux: false };
function filtres() { return Object.assign({}, F0, Deal.S.filtres || {}); }
function setFiltre(k, v) { Deal.S.filtres = Object.assign(filtres(), { [k]: v }); Deal.save(); renderListe(); }

// Liste calculée (mise en cache tant que rien ne change)
function biensCalcules() {
  const out = [];
  Sync.data.biens.forEach(b => {
    if (!b || !b.prix) return;
    let r; try { r = Deal.calculer(b); } catch (e) { console.error('calcul', b.lbc_id, e); return; }
    const a = Sync.data.annotations.get(b.lbc_id) || {};
    out.push({ b, r, a, fat: Deal.fatigue(b) });
  });
  return out;
}
const estNouveau = x => Sync.state.visitePrecedente > 0 && (x.b.premiere_vue || 0) > Sync.state.visitePrecedente;

function carteHtml(x) {
  const { b, r, a, fat } = x;
  const photo = (b.photos || [])[0];
  const off = r.statut !== 'ok' || a.statut === 'ecarte';
  const bd = [];
  if (estNouveau(x)) bd.push('<span class="bdg new">Nouveau</span>');
  if (a.statut) bd.push(`<span class="bdg">${esc(STATUTS[a.statut] || a.statut)}</span>`);
  if (r.statut === 'exclu') bd.push(`<span class="bdg bad">Exclu : ${esc((b.physique && b.physique.exclusions || []).join(', '))}</span>`);
  if (r.statut === 'rejet') bd.push('<span class="bdg bad">Ne couvre pas ses charges</span>');
  if (b.dpe === 'F' || b.dpe === 'G') bd.push(`<span class="bdg bad">DPE ${b.dpe}</span>`);
  else if (b.dpe === 'E') bd.push('<span class="bdg warn">DPE E</span>');
  if (fat.baisses) bd.push(`<span class="bdg good">−${fat.baissePct} %</span>`);
  if (fat.niveau === 'forte') bd.push('<span class="bdg warn">Vendeur fatigué</span>');
  if (fat.republie) bd.push('<span class="bdg">Republiée</span>');
  if (a.curseurs && Object.keys(a.curseurs).length) bd.push('<span class="bdg">Ajusté</span>');
  const ppm = b.surface ? Math.round(b.prix / b.surface) : null;
  const eff = r.effort_hors_capital_mois;
  return `<button class="card bien${off ? ' off' : ''}" data-bien="${esc(b.lbc_id)}">
    <span class="ph"${photo ? ` style="background-image:url('${esc(photo)}')"` : ''}>${(b.photos || []).length > 1 ? `<span class="nb">${b.photos.length}</span>` : ''}</span>
    <span class="txt">
      <span class="ti">${esc(TYPES[b.type] || '')} · ${b.surface || '?'} m² · ${esc(b.titre)}</span>
      <span class="px">${Deal.eur(b.prix)}${ppm ? `<small>${ppm.toLocaleString('fr-FR')} €/m²</small>` : ''}</span>
      <span>${r.statut === 'ok' ? Deal.etoilesSvg(r.etoiles) : '<span class="muted">—</span>'} <span class="eff ${eff >= 0 ? 'pos' : 'neg'}">${r.statut === 'ok' ? Deal.eurS(eff) + '/mois' : ''}</span></span>
      <span class="badges">${bd.join('')}</span>
    </span>
    ${a.favori ? '<span class="fav" aria-label="Favori">★</span>' : ''}
  </button>`;
}

function renderFiltresPlus() {
  const f = filtres();
  const seg = (k, items, cls) => `<div class="seg ${cls || ''}">${items.map(([v, l]) => `<button data-f="${k}" data-v="${esc(v)}" class="${String(f[k]) === String(v) ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
  const tg = (k, l) => `<button class="toggle" data-ft="${k}"><span>${l}</span><span class="sw${f[k] ? ' on' : ''}"><i></i></span></button>`;
  $('filtresPlus').innerHTML = `
    <div class="field"><span class="label">Étoiles minimum</span>${seg('min', [[0, 'Toutes'], [2, '2★+'], [3, '3★+'], [4, '4★+'], [5, '5★']], 'five')}</div>
    <div class="field"><span class="label">Type</span>${seg('type', [['', 'Tous'], ['studio', 'Studio'], ['t2', 'T2'], ['t3', 'T3'], ['t4', 'T4+']], 'five')}</div>
    <div class="field"><span class="label">Statut</span>${seg('statut', [['', 'Tous'], ['a_voir', 'À voir'], ['contacte', 'Contacté'], ['visite', 'Visité'], ['offre', 'Offre']], 'five')}</div>
    <div class="field"><span class="label">Trier par</span>${seg('tri', [['etoiles', 'Étoiles'], ['prix', 'Prix'], ['recent', 'Récents'], ['fatigue', 'Fatigue']], 'four')}</div>
    ${tg('favoris', 'Favoris seulement')}
    ${tg('seulsNouveaux', 'Nouveaux depuis ma dernière visite')}
    ${tg('masquerEcartes', 'Masquer les biens écartés')}
    ${tg('voirExclus', 'Afficher les exclus (viager, occupé, sous compromis…)')}
    <button class="ghost" data-reset>Réinitialiser les filtres</button>`;
}
$('fPlus').addEventListener('click', () => {
  const p = $('filtresPlus'); p.hidden = !p.hidden; $('fPlus').setAttribute('aria-expanded', String(!p.hidden));
  if (!p.hidden) renderFiltresPlus();
});
$('filtresPlus').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'), t = e.target.closest('[data-ft]');
  if (b) { const v = b.dataset.v; setFiltre(b.dataset.f, /^\d+$/.test(v) ? +v : v); renderFiltresPlus(); }
  else if (t) { setFiltre(t.dataset.ft, !filtres()[t.dataset.ft]); renderFiltresPlus(); }
  else if (e.target.closest('[data-reset]')) { Deal.S.filtres = {}; Deal.save(); $('fTexte').value = ''; renderListe(); renderFiltresPlus(); }
});
let tTexte = null;
$('fTexte').addEventListener('input', () => { clearTimeout(tTexte); tTexte = setTimeout(() => setFiltre('texte', $('fTexte').value.trim()), 200); });
$('biens').addEventListener('click', e => { const c = e.target.closest('[data-bien]'); if (c) window.ouvrirFiche(c.dataset.bien); });

function renderListe() {
  if (!Sync.state.auth) { $('biens').innerHTML = ''; $('resume').textContent = ''; return; }
  const f = filtres();
  if ($('fTexte').value !== f.texte && document.activeElement !== $('fTexte')) $('fTexte').value = f.texte;
  const tous = biensCalcules();
  const q = f.texte.toLowerCase();
  let l = tous.filter(x => {
    if (!f.voirExclus && x.r.statut === 'exclu') return false;
    if (f.masquerEcartes && x.a.statut === 'ecarte') return false;
    if (f.favoris && !x.a.favori) return false;
    if (f.statut && x.a.statut !== f.statut) return false;
    if (f.type && x.b.type !== f.type) return false;
    if (f.min && !(x.r.statut === 'ok' && x.r.etoiles >= f.min)) return false;
    if (f.seulsNouveaux && !estNouveau(x)) return false;
    if (q && !((x.b.titre || '').toLowerCase().includes(q) || x.b.lbc_id.includes(q) || (x.a.notes || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const rang = x => x.r.statut === 'ok' ? x.r.etoiles : x.r.statut === 'rejet' ? -1 : -2;
  const tri = {
    etoiles: (a, b) => rang(b) - rang(a) || b.r.effort_hors_capital_mois - a.r.effort_hors_capital_mois,
    prix: (a, b) => a.b.prix - b.b.prix,
    recent: (a, b) => (b.b.premiere_vue || 0) - (a.b.premiere_vue || 0),
    fatigue: (a, b) => (b.fat.jours || 0) - (a.fat.jours || 0)
  }[f.tri] || ((a, b) => rang(b) - rang(a));
  l.sort(tri);
  const exclus = tous.filter(x => x.r.statut === 'exclu').length;
  const actifs = (f.min || f.type || f.favoris || f.statut || f.seulsNouveaux || q) ? ' · filtres actifs' : '';
  $('resume').textContent = `${l.length} bien${l.length > 1 ? 's' : ''} affiché${l.length > 1 ? 's' : ''} sur ${tous.length}` +
    (exclus && !f.voirExclus ? ` (${exclus} exclu${exclus > 1 ? 's' : ''} masqué${exclus > 1 ? 's' : ''})` : '') + actifs + ' · montant = effort mensuel hors capital';
  $('fPlus').textContent = actifs ? 'Filtres •' : 'Filtres';
  $('biens').innerHTML = l.length ? l.map(carteHtml).join('')
    : `<p class="vide">${tous.length ? 'Aucun bien ne correspond aux filtres.' : (Sync.state.lastOk ? 'Aucun bien en base pour l\'instant.' : 'Chargement des biens…')}</p>`;
}

// « 3 nouveaux biens 5 étoiles depuis votre dernière visite »
function renderNouveautes() {
  const el = $('nouveautes');
  if (!Sync.state.visitePrecedente) { el.hidden = true; return; }
  const nouv = biensCalcules().filter(x => estNouveau(x) && x.r.statut === 'ok');
  if (!nouv.length) { el.hidden = true; return; }
  const top = nouv.filter(x => x.r.etoiles >= 5).length, bons = nouv.filter(x => x.r.etoiles >= 4).length;
  const txt = top ? `<b>${top} nouveau${top > 1 ? 'x' : ''} bien${top > 1 ? 's' : ''} 5 étoiles</b> depuis votre dernière visite`
    : bons ? `<b>${bons} nouveau${bons > 1 ? 'x' : ''} bien${bons > 1 ? 's' : ''} 4 étoiles ou plus</b> depuis votre dernière visite`
      : `<b>${nouv.length} nouveau${nouv.length > 1 ? 'x' : ''} bien${nouv.length > 1 ? 's' : ''}</b> depuis votre dernière visite`;
  el.innerHTML = `<button class="nouv" id="nouvVoir"><span>${txt} — afficher</span><span class="x" id="nouvX" aria-label="Masquer">✕</span></button>`;
  el.hidden = false;
  $('nouvVoir').onclick = e => {
    if (e.target.id === 'nouvX') { el.hidden = true; return; }
    Deal.S.filtres = Object.assign(filtres(), { seulsNouveaux: true, min: top ? 5 : bons ? 4 : 0, voirExclus: false }); Deal.save();
    el.hidden = true; renderListe(); $('main').scrollTop = 0;
    Deal.toast('Filtre « nouveaux » actif', () => { setFiltre('seulsNouveaux', false); setFiltre('min', 0); });
  };
}
window.renderListe = renderListe;
window.renderNouveautes = renderNouveautes;
window.DealListe = { STATUTS, TYPES };
