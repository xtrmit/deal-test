'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const S = require('../js/scoring.js');
const source = fs.readFileSync(path.join(__dirname, '../js/scoring.js'), 'utf8');
const copy = v => JSON.parse(JSON.stringify(v));
const approx = (actual, expected, epsilon = 0.01) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const A = { prix: 223000, surface: 56, pieces: 3, type: 't3', dpe: 'B', parking: false, terrasse: false,
  clim: true, vue_mer: null, distance_mer: null, etat: null, niveau_travaux: null };
// B : les équipements et la distance ne sont pas documentés dans le cas fourni.
const B = { prix: 175000, surface: 40.5, pieces: 2, type: 't2', dpe: 'F', parking: null, terrasse: null,
  clim: null, vue_mer: null, distance_mer: null, etat: 'a_rafraichir', niveau_travaux: 'moyen', charges_copro_an: 1236 };
const bien = overrides => Object.assign({ prix: 100000, surface: 30, pieces: 2, type: 't2', dpe: 'D',
  parking: true, terrasse: true, clim: true, vue_mer: false, etat: 'bon', niveau_travaux: 'aucun',
  distance_mer: '3-7', crl_applicable: false, statut_juridique: 'confirme', extraction_version: S.VERSION }, overrides);
const raw = (description, attributes = {}) => ({ adId: '42', price: '175 000 €', title: 'Appartement T2', description,
  attributes: Object.assign({ square: '40,5', rooms: '2', energy_rate: 'F', real_estate_type: 'Appartement' }, attributes) });

test('A : budget, rendement et cash-flow recalculés indépendamment', () => {
  const r = S.calculer(A), brut = 130 * .95 * .95 * 350 * .48;
  const nac = brut * (1 - .155 - .845 * .20 - .02 - .03 - .025) - (4880 + 140 * 12);
  const horsFin = 223000 * 1.08 + 56 * 400 * 1.15 + 10000;
  const emprunt = (horsFin - 223000 * .2 + 1000) / .985;
  const mensualite = emprunt * (.04 / 12) / (1 - (1 + .04 / 12) ** -180);
  approx(r.hypotheses.adr, 117.325); approx(r.hypotheses.nuits_louees, 168);
  assert.equal(r.revenus_bruts_an, Math.round(brut)); assert.equal(r.net_avant_credit_an, Math.round(nac));
  approx(r.hypotheses.travaux_eur, 25760); assert.equal(r.hypotheses.meubles_eur, 10000);
  assert.equal(r.cout_hors_financement, 276600); assert.equal(r.cout_total, 281148);
  assert.equal(r.emprunt, Math.round(emprunt)); assert.equal(r.mensualite, Math.round(mensualite));
  assert.equal(r.is_du_an1, 0); assert.equal(r.effort_treso_mois, Math.round((nac - emprunt * .003) / 12 - mensualite));
  assert.equal(r.effort_treso_mois, -1368); assert.equal(r.rendement_net_pct, 1.91);
  assert.equal(r.rendement_net_cout_total_pct, 1.88); assert.equal(r.etoiles, 2);
  assert.equal(r.eligible_alerte, false); assert.equal(r.gain_is_horizon, 0);
});
test('B : rendement 2,32 %, 2 étoiles financières, DPE F à vérifier', () => {
  const r = S.calculer(B);
  assert.equal(r.revenus_bruts_an, 18200); assert.equal(r.net_avant_credit_an, 5412);
  assert.equal(r.hypotheses.travaux_eur, 37260); assert.equal(r.cout_hors_financement, 233260);
  assert.equal(r.cout_total, 237294); assert.equal(r.emprunt, 202294); assert.equal(r.mensualite, 1496);
  assert.equal(r.is_du_an1, 0); assert.equal(r.effort_treso_mois, -1096);
  assert.equal(r.rendement_net_pct, 2.32); assert.equal(r.rendement_net_cout_total_pct, 2.28);
  assert.equal(r.etoiles, 2); assert.equal(r.statut_juridique, 'a_verifier'); assert.equal(r.eligible_alerte, false);
});
test('trois états : non mentionné reste null, zéro explicite reste false', () => {
  const r = S.extraire(raw('Appartement lumineux.'));
  for (const k of ['parking', 'terrasse', 'clim', 'vue_mer', 'ascenseur', 'vendu_meuble']) assert.equal(r[k], null, k);
  assert.equal(S.extraire(raw('', { nb_parkings: '0', elevator: 'Non' })).parking, false);
  assert.equal(S.extraire(raw('', { elevator: 'Non' })).ascenseur, false);
  assert.equal(S.extraire(raw('', { nb_parkings: '1', elevator: 'Oui' })).parking, true);
  assert.equal(r.prix, 175000); assert.equal(r.surface, 40.5);
});
test('négations coordonnées et absence explicite', () => {
  const r = S.extraire(raw('Sans parking ni terrasse, pas de climatisation et sans vue mer.'));
  for (const k of ['parking', 'terrasse', 'clim', 'vue_mer']) assert.equal(r[k], false, k);
  assert.equal(S.extraire(raw('Parking : non.')).parking, false);
  assert.equal(S.extraire(raw('Sans place de parking.')).parking, false);
  assert.equal(S.extraire(raw('Appartement avec terrasse et climatisation.')).clim, true);
});
test('parking public, en supplément, possibilité : aucune possession inférée', () => {
  for (const t of ['Parking public à 100 m.', 'Garage en supplément.', 'Possibilité de parking.', 'Possibilité d’acquérir un garage.', 'Parking à louer.']) {
    assert.equal(S.extraire(raw(t)).parking, null, t);
  }
});
test('contradictions conservées dans les preuves', () => {
  const r = S.extraire(raw('Sans parking. Un parking privé est inclus.'));
  assert.equal(r.parking, null); assert.ok(r.conflits.includes('parking')); assert.ok(r.preuves.parking.length >= 2);
  assert.equal(S.extraire(raw('Sans parking.', { nb_parkings: 1 })).parking, null);
});
test('distance : trajet voiture et port ne deviennent pas une plage accessible à pied', () => {
  for (const t of ['À 3 min en voiture de la plage.', 'À 200 m du port.', 'Proche mer.']) assert.equal(S.extraire(raw(t)).distance_mer, null);
  assert.equal(S.extraire(raw('À 300 m de la plage.')).distance_mer, '3-7');
  assert.equal(S.extraire(raw('À 10 min à pied de la mer.')).distance_mer, '7-12');
});
test('type : nombre de pièces explicite prioritaire, surface en repli', () => {
  assert.equal(S.typeDepuis(29, 2), 't2'); assert.equal(S.typeDepuis(70, 1), 'studio');
  assert.equal(S.typeDepuis(56, null), 't3'); assert.equal(S.typeDepuis(null, null), 't2');
});
test('inconnus neutres ; pas de coefficients sur occupation ; cumul ADR borné', () => {
  const r = S.calculer(bien({ parking: null, terrasse: null, clim: null, vue_mer: null, distance_mer: null }));
  assert.equal(r.hypotheses.adr, 100); assert.equal(r.hypotheses.occ_pct, 52);
  const mauvais = S.calculer(bien({ parking: false, terrasse: false, clim: false, distance_mer: '12+', etat: 'a_rafraichir' }));
  assert.equal(mauvais.hypotheses.adr, 80); assert.equal(mauvais.hypotheses.occ_pct, 52);
});
test('travaux : état amélioré uniquement si le programme est financé ; budget total sans double aléa', () => {
  const b = bien({ etat: 'a_rafraichir', niveau_travaux: 'moyen' });
  assert.equal(S.calculer(b).hypotheses.etat_apres_travaux, 'bon');
  for (const budget of [0, 1, 1000]) assert.equal(S.calculer(b, null, { travaux_eur: budget }).hypotheses.etat_apres_travaux, 'a_rafraichir');
  assert.equal(S.calculer(b, null, { travaux_eur: 30000 }).hypotheses.travaux_eur, 30000);
  assert.equal(S.calculer(b, null, { etat_apres_travaux: 'refait_neuf' }).hypotheses.etat_apres_travaux, 'refait_neuf');
});
test('le financement ne change jamais le score économique', () => {
  const r = S.calculer(A);
  for (const c of [{ apport_eur: 1e6 }, { apport_pct: 0, taux_pct: 7, duree_ans: 25 }, { taux_pct: 0, duree_ans: 5 }]) {
    const autre = S.calculer(A, null, c);
    assert.equal(autre.etoiles_non_arrondies, r.etoiles_non_arrondies); assert.equal(autre.rendement_net_pct, r.rendement_net_pct);
    assert.notEqual(autre.effort_treso_mois, r.effort_treso_mois);
  }
});
test('achat comptant : ni crédit, ni frais bancaires, ni assurance emprunteur', () => {
  const r = S.calculer(A, null, { apport_eur: 1e6 });
  for (const k of ['emprunt', 'mensualite', 'frais_financement_eur', 'assurance_emprunteur_an', 'interets_an1']) assert.equal(r[k], 0, k);
  assert.equal(r.apport, r.cout_total);
});
test('crédit sans intérêts : dette éteinte, assurance et échéances arrêtées à maturité', () => {
  const r = S.calculer(bien(), null, { taux_pct: 0, duree_ans: 2, horizon_is_ans: 10 });
  const lignes = r.echeancier_annuel;
  approx(lignes.reduce((s, y) => s + y.capital_rembourse, 0), r.emprunt, .51);
  assert.equal(lignes[2].echeances, 0); assert.equal(lignes[2].assurance, 0); assert.equal(lignes[2].interets, 0);
  approx(lignes[1].capital_restant, 0, 1e-7);
});
test('échéancier crédit : capital remboursé et restant réconcilient la dette initiale', () => {
  const r = S.calculer(A), ys = r.echeancier_annuel;
  approx(ys.reduce((s, y) => s + y.capital_rembourse, 0) + ys.at(-1).capital_restant, r.emprunt, .51);
  approx(ys[0].capital_rembourse + ys[0].interets, ys[0].echeances, 1e-7);
});
test('IS : réserve non dépensée non déductible, puis cash-flow après IS', () => {
  const c = { apport_eur: 1e6, adr: 200, occ_pct: 60, charges_mois: 100, meubles_eur: 0, frais_gestion_pct: 0,
    entretien_courant_pct: 0, reserve_renouvellement_pct: 3, part_bati_pct: 0, travaux_eur: 0 };
  const r = S.calculer(bien(), null, c);
  const brut = 200 * 350 * .6, fiscal = brut - 1200;
  approx(r.echeancier_annuel[0].resultat_fiscal, fiscal); assert.equal(r.is_du_an1, fiscal * .15);
  assert.equal(r.cash_flow_apres_is_an, brut * .97 - 1200 - fiscal * .15);
  const sansReserve = S.calculer(bien(), null, Object.assign({}, c, { reserve_renouvellement_pct: 0 }));
  assert.equal(sansReserve.is_du_an1, r.is_du_an1);
});
test('IS taux réduit conditionnel et seuil progressif', () => {
  const c = { apport_eur: 1e6, adr: 500, occ_pct: 100, charges_mois: 0, meubles_eur: 0, travaux_eur: 0,
    part_bati_pct: 0, frais_gestion_pct: 0, entretien_courant_pct: 0, reserve_renouvellement_pct: 0 };
  const r = S.calculer(bien(), null, c);
  assert.equal(r.is_du_an1, 42500 * .15 + (175000 - 42500) * .25);
  assert.equal(S.calculer(bien(), null, Object.assign({}, c, { is_taux_reduit_eligible: false })).is_du_an1, 175000 * .25);
});
test('déficits reportés : pas de crédit IS fictif', () => {
  const r = S.calculer(A);
  assert.ok(r.echeancier_annuel[0].deficit_reportable > 0);
  for (const y of r.echeancier_annuel) assert.ok(y.is >= 0 && y.deficit_reportable >= 0);
  assert.ok(r.gain_is_horizon >= 0);
});
test('commissions séparées, ménage explicite et anciens forfaits', () => {
  const r = S.calculer(bien(), null, { menage_cout_sejour: 70 });
  approx(r.hypotheses.frais_gestion_pct, 32.4); approx(r.marge_menage_an, 0);
  assert.equal(S.calculer(bien(), null, { assiette_conciergerie: 'brut' }).hypotheses.frais_gestion_pct, 35.5);
  assert.equal(S.calculer(bien(), null, { menage_cout_sejour: 70, menage_facture_sejour: 0 }).marge_menage_an, -2548);
  assert.equal(S.calculer(bien(), { benchmarks: { t2: { net: 62 } } }).hypotheses.frais_gestion_pct, 38);
  assert.equal(S.calculer(bien(), null, { frais_gestion_pct: 0 }).frais_gestion_an, 0);
});
test('copro zéro explicitement annoncé conservé ; CRL tri-état', () => {
  assert.equal(S.calculer(bien({ charges_copro_an: 0 })).hypotheses.copro_mois, 0);
  assert.equal(S.calculer(bien({ crl_applicable: false })).crl_an, 0);
  assert.ok(S.calculer(bien({ crl_applicable: true })).crl_an > 0);
  const r = S.calculer(bien({ crl_applicable: null }));
  assert.ok(r.crl_an > 0); assert.equal(r.eligible_alerte, false);
});
test('DPE séparé de la note, incompatibilité avérée exclue', () => {
  const r = S.calculer(bien());
  for (const dpe of ['E', 'F', 'G']) assert.equal(S.calculer(bien({ dpe })).etoiles, r.etoiles);
  assert.equal(S.calculer(bien({ dpe: 'F' })).eligible_alerte, false);
  assert.equal(S.calculer(bien()).eligible_alerte, true);
  const exclu = S.calculer(bien({ statut_juridique: 'incompatible' }));
  assert.equal(exclu.statut, 'exclu'); assert.equal(exclu.etoiles, 0);
});
test('ancien barème négatif migré ; réglages personnalisés préservés et complétés', () => {
  const anciens = { paliers: [[-700, 1], [-450, 2], [-250, 3], [-100, 4], [50, 5]], fin: { taux_pct: 3.2 },
    benchmarks: { t2: { adr: 115, net: 62 } } };
  const R = S.normaliserReglages(anciens);
  assert.deepEqual(R.paliers, S.DEFAUTS.paliers); assert.equal(R._paliers_migres, true);
  assert.equal(R.fin.taux_pct, 3.2); assert.equal(R.fin.assurance_emprunteur_pct, .3);
  assert.equal(R.benchmarks.t2.adr, 115); assert.equal(R.benchmarks.t2.meubles, 7000);
  assert.equal(S.calculer(bien(), R).hypotheses.frais_gestion_pct, 38);
});
test('entrées non mutées, chiffres finis, champs anciens maintenus', () => {
  const b = copy(A), r = copy(S.DEFAUTS), c = { taux_pct: 'incorrect', occ_pct: 150, travaux_eur: -2 };
  const avant = JSON.stringify([b, r, c]), res = S.calculer(b, r, c);
  assert.equal(JSON.stringify([b, r, c]), avant);
  function finis(v) { if (typeof v === 'number') assert.ok(Number.isFinite(v)); else if (v && typeof v === 'object') Object.values(v).forEach(finis); }
  finis(res);
  for (const k of ['statut','etoiles','raisons','hypotheses','revenus_bruts_an','revenus_nets_an','frais_gestion_an','charges_fixes_an',
    'net_avant_credit_an','cout_total','apport','emprunt','mensualite','interets_an1','effort_treso_mois','effort_hors_capital_mois',
    'rendement_net_pct','benefice_an1_hors_credit','amortissements_an1','is_du_an1','gain_is_horizon','is_du_horizon','annees_sans_is',
    'horizon_is_ans','benefice_net_an1_hors_capital']) assert.ok(k in res, k);
  assert.throws(() => S.calculer({ prix: 0 }), RangeError);
  assert.throws(() => S.calculer({ prix: 'à négocier' }), RangeError);
});
test('PWA global, CommonJS et Code node n8n produisent les mêmes résultats JSON', () => {
  const browser = vm.createContext({}); vm.runInContext(source, browser);
  assert.equal(JSON.stringify(browser.DealScoring.calculer(A)), JSON.stringify(S.calculer(A)));
  // Simule le corps d’un Code node : items JSON en entrée / sortie ; aucun Node API nécessaire au moteur.
  const contexte = vm.createContext({ $input: { all: () => [{ json: raw('Sans parking ni terrasse. Climatisation.', { square: 56, rooms: 3 }) }] } });
  const out = vm.runInContext('(function(){' + source + '\nreturn $input.all().map(item => { const b = DealScoring.extraire(item.json); return {json: {physique:b, calcul:DealScoring.calculer(b)}}; }); })()', contexte);
  const attendu = S.extraire(raw('Sans parking ni terrasse. Climatisation.', { square: 56, rooms: 3 }));
  assert.deepEqual(copy(out[0].json), { physique: attendu, calcul: S.calculer(attendu) });
});

module.exports = { A, B };
