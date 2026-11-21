'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Scoring = require('../js/scoring.js');
const lire = f => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8');
const copy = v => JSON.parse(JSON.stringify(v));

function contexte() {
  const nodes = new Map(), writes = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', hidden: false, dataset: {},
      addEventListener() {}, setAttribute() {}, scrollIntoView() {}, classList: { toggle() {}, add() {} } });
    return nodes.get(id);
  };
  const Sync = { data: { annotations: new Map(), biens: new Map(), prix: new Map() },
    state: { auth: true, visitePrecedente: 0, communes: [] }, reglagesPour: () => Scoring.normaliserReglages(),
    annoter: (id, v) => { Sync.data.annotations.set(id, Object.assign({}, Sync.data.annotations.get(id), v)); writes.push(copy(v)); } };
  const Deal = { S: {}, eur: n => Math.round(n) + ' €', eurS: n => (n > 0 ? '+' : '') + Math.round(n) + ' €',
    etoilesSvg: n => n + '★', fatigue: () => ({ niveau: 'faible', texte: 'RAS' }), dateFr: () => '', ago: () => '',
    save() {}, toast() {}, vib() {}, prixM2Ref: () => null, galerie() {}, openSheet: (_, html) => { node('sheetBody').innerHTML = html; }, setOnSheetClose() {} };
  const ctx = vm.createContext({ Sync, Scoring, Deal, DealScoring: Scoring, $: node, esc: s => String(s == null ? '' : s),
    document: { activeElement: null, body: { dataset: {} }, querySelectorAll: () => [] },
    history: { replaceState() {}, state: {} }, location: { pathname: '/' }, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, writes });
  ctx.window = ctx;
  const app = lire('app.js');
  vm.runInContext(app.slice(app.indexOf('function bienEffectif('), app.indexOf('/* ================== Indice')), ctx);
  Deal.bienEffectif = ctx.bienEffectif; Deal.calculer = ctx.calculer;
  vm.runInContext(lire('liste.js'), ctx); vm.runInContext(lire('fiche.js'), ctx);
  return { ctx, Sync, Deal, node, writes };
}
const b = () => ({ lbc_id: 'A', prix: 223000, surface: 56, pieces: 3, type: 't3', dpe: 'B', titre: 'Bien A',
  physique: { parking: false, terrasse: false, clim: true, vue_mer: null, niveau_travaux: null, etat: null, distance_mer: null } });

test('PWA : liste et fiche affichent le cash-flow après IS et conservent la disposition existante', () => {
  const { ctx, Sync, node } = contexte(); Sync.data.biens.set('A', b());
  ctx.ouvrirFiche('A'); const html = node('sheetBody').innerHTML;
  assert.match(html, /Cash-flow après IS/); assert.match(html, /-1368 €/);
  assert.match(html, /col-g/); assert.match(html, /class="apres"/); assert.match(html, /class="simu"/);
  assert.match(html, /data-p="vue_mer" data-v="" class="sel"/);
  assert.match(html, /data-p="parking" data-v="false" class="sel"/);
  ctx.renderListe(); assert.match(node('resume').textContent, /cash-flow mensuel après IS/);
  assert.match(node('biens').innerHTML, /-1368 €\/mois/);
});
test('PWA : correction tri-état conservée en JSON, sans convertir false en inconnu', () => {
  const { ctx, Sync, writes } = contexte(); Sync.data.biens.set('A', b()); ctx.ouvrirFiche('A');
  for (const [v, expected] of [['true', true], ['false', false], ['', null]]) {
    const el = { dataset: { p: 'parking', v } };
    ctx.clicFiche({ target: { closest: s => s === '[data-p]' ? el : null } });
    assert.equal(writes.at(-1).curseurs.physique.parking, expected);
    assert.equal(ctx.bienEffectif(b()).parking, expected);
  }
});
test('PWA : changer le niveau de travaux retire les anciens budgets surchargés', () => {
  const { ctx, Sync, writes } = contexte(); Sync.data.biens.set('A', b());
  Sync.data.annotations.set('A', { curseurs: { travaux_eur: 123, physique: {} } }); ctx.ouvrirFiche('A');
  const el = { dataset: { p: 'niveau_travaux', v: 'moyen' } };
  ctx.clicFiche({ target: { closest: s => s === '[data-p]' ? el : null } });
  assert.equal('travaux_eur' in writes.at(-1).curseurs, false);
  assert.equal(Math.round(ctx.calculer(b()).hypotheses.travaux_eur), 51520);
});
test('PWA : données physiques absentes restent inconnues ; données anciennes non réécrites', () => {
  const { ctx } = contexte(), absent = b(); delete absent.physique;
  assert.equal(ctx.bienEffectif(absent).parking, null);
  assert.equal(ctx.bienEffectif(b()).parking, false);
  assert.ok(ctx.calculer(b()).raisons.some(r => r.includes('Extraction ancienne')));
});
test('PWA : réglages n8n partiels normalisés, sans écriture automatique', () => {
  const ctx = vm.createContext({ window: { DealScoring: Scoring }, localStorage: { getItem: () => null },
    document: { addEventListener() {} }, setInterval() {}, addEventListener() {} });
  vm.runInContext(lire('sync.js'), ctx);
  const sync = ctx.window.DealSync;
  sync.data.reglages.set('fin|global', { valeur: { taux_pct: 3.7 } });
  sync.data.reglages.set('paliers|global', { valeur: [[-700, 1], [50, 5]] });
  const r = sync.reglagesPour('golfe-juan');
  assert.equal(r.fin.taux_pct, 3.7); assert.equal(r.fin.assurance_emprunteur_pct, .3);
  assert.deepEqual(copy(r.paliers), Scoring.DEFAUTS.paliers); assert.equal(r._paliers_migres, true);
  assert.equal(sync.data.reglages.get('paliers|global').valeur[0][0], -700);
});
test('PWA : bannière des nouveautés pour un bien 5 étoiles, pas pour un bien exclu', () => {
  const { ctx, Sync, node } = contexte();
  Sync.state.visitePrecedente = 1;
  Sync.data.biens.set('A', Object.assign(b(), { premiere_vue: 2, prix: 50000, statut_annonce: 'en_ligne' }));
  ctx.renderNouveautes(); assert.match(node('nouveautes').innerHTML, /5 étoiles|4 étoiles|nouveau/);
  Sync.data.biens.set('A', Object.assign(b(), { premiere_vue: 2, prix: 50000, statut_annonce: 'en_ligne', physique: Object.assign(b().physique, { exclusions: ['viager'] }) }));
  node('nouveautes').innerHTML = ''; ctx.renderNouveautes();
  assert.ok(node('nouveautes').hidden || !/5 étoiles|4 étoiles/.test(node('nouveautes').innerHTML));
});
test('tous les scripts modifiés se compilent sans dépendance supplémentaire', () => {
  for (const f of ['scoring.js', 'app.js', 'sync.js', 'liste.js', 'fiche.js', 'reglages.js']) assert.doesNotThrow(() => new vm.Script(lire(f), { filename: f }));
});
