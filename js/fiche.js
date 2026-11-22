/* Deal — fiche d'un bien : photos, verdict, simulateur à curseurs (recalcul instantané), caractéristiques corrigeables,
   annotations (favori, statut, notes), indice de fatigue et historique des prix. */
'use strict';
const CURSEURS = [   // ordre d'affichage : ce qui dépend du bien d'abord, le financement ensuite
  { k: 'nego_pct', l: 'Négociation', min: 0, max: 25, step: 1, f: (v, r) => +v ? '−' + v + ' % · ' + Deal.eur(r.hypotheses.prix_achat) : 'aucune' },
  { k: 'travaux_eur', l: 'Travaux (aléas compris)', min: 0, max: 210000, step: 1000, f: v => Deal.eur(v) },
  { k: 'meubles_eur', l: 'Budget meubles', min: 0, max: 20000, step: 500, f: v => Deal.eur(v) },
  { k: 'adr', l: 'Prix moyen par nuit', min: 40, max: 300, step: 1, f: v => (+v).toFixed(2).replace('.', ',') + ' €' },
  { k: 'occ_pct', l: 'Occupation des nuits ouvertes', min: 0, max: 100, step: 1, f: v => Math.round(v) + ' %' },
  { k: 'charges_mois', l: 'Charges fixes (copro incluse)', min: 100, max: 1500, step: 10, f: v => Deal.eur(v) + '/mois' },
  { k: 'frais_gestion_pct', l: 'Conciergerie + plateforme', min: 0, max: 60, step: 0.1, f: v => (+v).toFixed(1).replace('.', ',') + ' % des loyers' },
  { k: 'duree_ans', l: 'Durée du crédit', min: 5, max: 25, step: 1, f: v => v + ' ans' },
  { k: 'taux_pct', l: 'Taux du crédit', min: 2, max: 6, step: 0.05, f: v => (+v).toFixed(2).replace('.', ',') + ' %' },
  { k: 'apport_pct', l: 'Apport (% du prix seul)', min: 0, max: 100, step: 5, f: v => v + ' %' }
];
const DIST = [['', 'Inconnue'], ['0-3', '0-3 min'], ['3-7', '3-7 min'], ['7-12', '7-12 min'], ['12+', '> 12 min']];
const TRAV = [['', 'Inconnu'], ['aucun', 'Aucun'], ['leger', 'Léger'], ['moyen', 'Moyen'], ['lourd', 'Lourd'], ['structurel', 'Structurel']];
let F = null;   // fiche ouverte : { id, enCours }

function valeurDe(r, k) {
  const h = r.hypotheses;
  return { apport_pct: h.apport_pct, taux_pct: h.taux_pct, duree_ans: h.duree_ans, travaux_eur: h.travaux_eur, adr: h.adr,
           occ_pct: h.occ_pct, charges_mois: h.charges_mois, meubles_eur: h.meubles_eur, nego_pct: h.nego_pct,
           frais_gestion_pct: h.frais_gestion_pct }[k];
}
// ---------- Aides : cliquer sur une ligne marquée ⓘ déplie le calcul simplifié avec les chiffres du bien ----------
const E = n => Deal.eur(Math.round(n)), ES = n => Deal.eurS(Math.round(n));
function aideHtml(k, r) {
  const h = r.hypotheses, a1 = r.echeancier_annuel[0], soc = r.is_autre_eur > 0;
  const capMois = r.capital_rembourse_an1 / 12, intMois = r.interets_an1 / 12, assMois = r.assurance_emprunteur_an / 12;
  const isMois = r.is_du_an1 / 12, nacMois = r.net_avant_credit_an / 12;
  const L = (t, v) => `<div class="calc"><span>${t}</span><b>${v}</b></div>`;
  const A = {
    nac: () => `<p>Ce que le bien rapporte en une année normale, <b>avant de penser au crédit et aux impôts</b> : comme si tu l'avais payé comptant.</p>
      ${L('Loyers encaissés', E(r.revenus_bruts_an))}${L('− conciergerie + plateforme', '−' + E(r.frais_gestion_an))}
      ${L('− charges fixes (copro, taxe foncière, CFE, assurance, énergie, compta…)', '−' + E(r.charges_fixes_an))}
      ${L('− entretien, réserve de remplacement, CRL', '−' + E(r.entretien_courant_an + r.reserve_renouvellement_an + r.crl_an))}
      ${L('= solde d\'exploitation', ES(r.net_avant_credit_an))}
      <p>S'il est négatif, le bien perd de l'argent même sans crédit : c'est un « rejet ».</p>`,
    rend: () => `<p>Le rendement compare ce que le bien rapporte à <b>tout ce qu'il coûte pour démarrer</b> (prix, notaire, travaux, meubles), sans tenir compte du crédit. C'est lui qui donne les étoiles : un bien cher au m² peut avoir un bon rendement s'il loue bien, et inversement.</p>
      ${L('Solde d\'exploitation / an', E(r.net_avant_credit_an))}${L('÷ coût du projet hors frais bancaires', E(r.cout_hors_financement))}
      ${L('= rendement', String(r.rendement_net_pct).replace('.', ',') + ' %')}
      <p>Barème : 0 % → 1★ · 2 % → 2★ · 4 % → 3★ · 6 % → 4★ · 8 % et plus → 5★. Repère : à 4 % le bien rapporte à peu près ce que coûte un crédit à 4 % ; en dessous, c'est l'apport et le temps qui font l'enrichissement, pas les loyers.</p>`,
    cash: () => `<p>Ce qui sort (ou rentre) <b>réellement</b> sur le compte de la société chaque mois, la première année.</p>
      ${L('Solde d\'exploitation / mois', ES(nacMois))}${L('− mensualité du crédit', '−' + E(r.mensualite))}${L('− assurance emprunteur', '−' + E(assMois))}
      ${L(isMois < 0 ? '+ IS économisé par ta société' : '− IS du bien', isMois < 0 ? '+' + E(-isMois) : '−' + E(isMois))}
      ${L('= cash-flow après IS', ES(r.effort_treso_mois))}
      <p>${r.effort_treso_mois < 0 ? `Il faut donc remettre environ ${E(-r.effort_treso_mois)} chaque mois (${E(-r.effort_treso_mois * 12)} par an). La banque prélève ce montant, qu'il soit « récupérable » ou non.` : 'Le bien paie son crédit et ses impôts tout seul.'}</p>`,
    hc: () => `<p>Ta mensualité de ${E(r.mensualite)} contient deux choses très différentes :</p>
      ${L('des intérêts : argent perdu, le prix du crédit', E(intMois) + '/mois')}${L('du capital : ta dette baisse d\'autant', E(capMois) + '/mois')}
      <p>Le capital n'est pas perdu : c'est de l'épargne forcée, que tu retrouves à la revente (si le bien se revend au moins à son prix). Ce solde enlève donc le capital du calcul :</p>
      ${L('Cash-flow après IS', ES(r.effort_treso_mois))}${L('+ capital remboursé', '+' + E(capMois))}${L('= ce que l\'opération te coûte vraiment', ES(r.effort_hors_capital_mois) + '/mois')}
      <p>Exemple : avec −${E(Math.abs(r.effort_treso_mois))} sur le compte mais +${E(capMois)} d'épargne dans le bien, l'appauvrissement réel est de ${E(Math.abs(Math.min(0, r.effort_hors_capital_mois)))} par mois${r.effort_hors_capital_mois >= 0 ? ' : ici aucun, tu t\'enrichis' : ''}. Attention : les ${E(r.notaire_eur)} de frais de notaire, eux, sont perdus dès l'achat.</p>`,
    is1: () => `<p>L'IS se calcule sur le <b>résultat fiscal</b>, pas sur la trésorerie. On peut y déduire les intérêts, l'assurance, les frais bancaires et surtout les <b>amortissements</b> : chaque année, une part du prix du bien est considérée comme « usée » et déduite, sans que de l'argent sorte.</p>
      ${L('Solde d\'exploitation (réserve non déductible réintégrée)', ES(r.net_avant_credit_an + r.reserve_renouvellement_an))}
      ${L('− intérêts et assurance', '−' + E(a1.interets + a1.assurance))}${L('− frais bancaires (année 1)', '−' + E(r.frais_financement_eur))}
      ${L('− amortissements', '−' + E(r.amortissements_an1))}${L('= résultat fiscal du bien', ES(r.resultat_fiscal_an1))}
      <p>${r.resultat_fiscal_an1 >= 0 ? `Bénéfice : ${E(r.is_du_an1)} d'IS.` : soc
        ? `Perte fiscale : elle s'impute sur le bénéfice de ta société (environ ${E(r.benefice_autre_eur)}, d'après les ${E(r.is_autre_eur)} d'IS indiqués dans Réglages). Son IS passe de ${E(r.is_autre_eur)} à ${E(r.is_societe_an1)} : <b>${E(r.economie_is_societe_an1)} économisés</b> cette année.`
        : 'Perte fiscale : pas d\'IS, et la perte est reportée sur les années suivantes. Si le bien est dans une société qui paie déjà de l\'IS, indique ce montant dans Réglages : la perte viendra le réduire dès cette année.'}</p>`,
    amort: () => `<p>L'amortissement étale le coût du bien sur sa durée de vie et se déduit du résultat chaque année, sans sortie d'argent :</p>
      ${L('Bâti : 70 % de (prix + notaire) ÷ 30 ans', E(r.amortissement_bien_an) + '/an')}
      ${L('Travaux ÷ 10 ans', E((h.travaux_eur + (h.travaux_copro_eur || 0)) / 10) + '/an')}${L('Meubles ÷ 7 ans', E(h.meubles_eur / 7) + '/an')}
      ${L('= amortissements année 1', E(r.amortissements_an1))}
      <p>Le terrain (30 %) ne s'amortit pas. Contrepartie : à la revente, la plus-value est calculée sur la valeur diminuée des amortissements. L'impôt est donc en grande partie <b>reporté</b>, pas supprimé.</p>`,
    ish: () => `<p>Total sur ${r.horizon_is_ans} ans, pas par an.</p>
      ${L(soc ? `IS économisé par ta société sur ${r.horizon_is_ans} ans` : `IS payé par le bien sur ${r.horizon_is_ans} ans`, soc ? E(r.economie_is_societe_horizon) : E(r.is_du_horizon))}
      ${L('Années sans IS dû par le bien', r.annees_sans_is + ' / ' + r.horizon_is_ans)}
      <p>${soc ? 'Chaque année, la perte fiscale du bien réduit l\'IS de ta société.' : 'Tant que les intérêts et amortissements dépassent les loyers nets, pas d\'IS, et les pertes s\'accumulent pour plus tard.'} La revente et la distribution de dividendes ne sont pas simulées.</p>`
  };
  return A[k] ? A[k]() : '';
}
function metricsHtml(r) {
  const h = r.hypotheses, ouv = (F && F.aides) || new Set();
  const ln = (t, v, cls, aide) => `<dt class="${cls || ''}${aide ? ' a-aide' : ''}"${aide ? ` data-aide="${aide}"` : ''}>${t}${aide ? ' <span class="i">ⓘ</span>' : ''}</dt><dd class="${cls || ''}${aide ? ' a-aide' : ''}"${aide ? ` data-aide="${aide}"` : ''}>${v}</dd>` +
    (aide && ouv.has(aide) ? `<div class="aide">${aideHtml(aide, r)}</div>` : '');
  const sg = n => `<span class="${n >= 0 ? 'pos' : 'neg'}">${Deal.eurS(n)}</span>`;
  const soc = r.is_autre_eur > 0;
  return `<dl class="metrics">
    ${ln('<b>Cash-flow après IS / mois</b>', sg(r.effort_treso_mois), 'key', 'cash')}
    ${ln('Coût réel hors capital remboursé / mois', sg(r.effort_hors_capital_mois), '', 'hc')}
    ${ln('Rendement (étoiles)', String(r.rendement_net_pct).replace('.', ',') + ' %', '', 'rend')}
    <hr>
    ${ln('Loyers encaissés / an', Deal.eur(r.revenus_bruts_an))}
    ${ln(`Conciergerie + plateforme <span class="note">(${h.frais_gestion_pct.toFixed(1)} %)</span>`, '−' + Deal.eur(r.frais_gestion_an))}
    ${r.marge_menage_an ? ln('Solde ménage / an', sg(r.marge_menage_an)) : ''}
    ${ln(`Charges fixes / an <span class="note">(copro ${Deal.eur(h.copro_mois)}/mois · ${h.copro_source === 'annonce' ? 'annonce' : h.copro_source === 'curseur' ? 'saisie' : 'défaut'})</span>`, '−' + Deal.eur(h.charges_mois * 12))}
    ${ln('Entretien + réserve + CRL / an' + (h.crl_applicable === null ? ' <span class="note">(CRL à confirmer)</span>' : ''), '−' + Deal.eur(r.entretien_courant_an + r.reserve_renouvellement_an + r.crl_an))}
    ${ln('<b>Solde d\'exploitation / an</b>', sg(r.net_avant_credit_an), 'key', 'nac')}
    <hr>
    ${h.nego_pct ? ln(`Prix d'achat <span class="note">(négocié −${h.nego_pct} %)</span>`, Deal.eur(h.prix_achat)) : ''}
    ${ln('Notaire', Deal.eur(r.notaire_eur))}
    ${ln('Travaux (aléas compris) + meubles', Deal.eur(h.travaux_eur + h.meubles_eur))}
    ${ln('Frais bancaires et garantie', Deal.eur(r.frais_financement_eur))}
    ${ln('<b>Coût total du projet</b>', Deal.eur(r.cout_total))}
    ${ln('Apport', Deal.eur(r.apport))}
    ${ln('Emprunt', Deal.eur(r.emprunt))}
    ${ln('Mensualité assurance comprise', Deal.eur(r.mensualite_assurance_comprise))}
    ${ln('Réserve de trésorerie conseillée', Deal.eur(r.tresorerie_initiale))}
    <hr>
    ${ln('Amortissements année 1', Deal.eur(r.amortissements_an1), '', 'amort')}
    ${ln('Résultat fiscal année 1', sg(r.resultat_fiscal_an1))}
    ${soc ? ln('<b>IS économisé par ta société, année 1</b>', `<span class="pos">${Deal.eur(r.economie_is_societe_an1)}</span>`, 'key', 'is1')
          : ln('IS dû année 1', Deal.eur(r.is_du_an1), '', 'is1')}
    ${ln(soc ? `IS économisé sur ${r.horizon_is_ans} ans (total)` : `IS payé sur ${r.horizon_is_ans} ans (total)`, Deal.eur(soc ? r.economie_is_societe_horizon : r.is_du_horizon), '', 'ish')}
  </dl>
  <p class="note">ⓘ : touche la ligne pour voir le calcul. Projection en année stabilisée ; revente et dividendes non simulés.</p>`;
}
// Raisons regroupées : les équipements inconnus tiennent sur une ligne.
function raisonsHtml(raisons) {
  const NOMS = { parking: 'parking', terrasse: 'terrasse', clim: 'clim', vue_mer: 'vue mer' };
  const inc = [], autres = [];
  raisons.forEach(x => { const m = x.match(/^(\w+) inconnu : effet neutre$/); if (m) inc.push(NOMS[m[1]] || m[1]); else autres.push(x); });
  if (inc.length) autres.unshift('Inconnus dans l\'annonce (sans effet sur la note) : ' + inc.join(', '));
  return autres.length ? `<ul class="raisons">${autres.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}
function verdictHtml(r, b) {
  const txt = r.statut === 'exclu' ? 'Exclu' : r.statut === 'rejet' ? 'Rejeté : perd de l\'argent même sans crédit' :
    r.effort_treso_mois >= 0 ? 'Cash-flow positif après IS' : 'À financer : ' + Deal.eur(-r.effort_treso_mois) + '/mois après IS';
  return `<div class="verdict card">
    <div class="row">${r.statut === 'ok' ? Deal.etoilesSvg(r.etoiles, true) : ''}<span class="big">${esc(txt)}</span></div>
    <p class="note">Rendement : ${String(r.rendement_net_pct).replace('.', ',')} %. Faisabilité : ${esc(r.statut_juridique === 'confirme' ? 'confirmée' : r.statut_juridique === 'incompatible' ? 'incompatible' : 'à vérifier')}. Les étoiles restent une estimation.</p>
    ${raisonsHtml(r.raisons)}
  </div>`;
}

// Bandeau collant au-dessus des curseurs : le résultat reste visible pendant qu'on règle.
function simbarHtml(r) {
  if (r.statut === 'exclu') return '<span class="big">Exclu</span>';
  if (r.statut !== 'ok') return `<span class="big">Rejeté</span><span class="note">perd ${Deal.eur(-r.net_avant_credit_an)}/an même sans crédit</span>`;
  const e = r.effort_treso_mois;
  return `${Deal.etoilesSvg(r.etoiles)}<span class="${e >= 0 ? 'pos' : 'neg'}" style="font-weight:800">${Deal.eurS(e)}/mois</span><span class="note">après IS · rendement ${String(r.rendement_net_pct).replace('.', ',')} %</span>`;
}

// ---------- Analyse IA : synthèse, écarts avec la fois précédente, points à vérifier ----------
const VAL = v => v === true ? 'oui' : v === false ? 'non' : v == null ? 'inconnu' : ({ '0-3': '0-3 min', '3-7': '3-7 min', '7-12': '7-12 min', '12+': '+12 min',
  a_rafraichir: 'à rafraîchir', refait_neuf: 'refait à neuf', bon: 'bon', aucun: 'aucun', leger: 'légers', moyen: 'moyens', lourd: 'lourds', structurel: 'structurels',
  studio: 'studio', t2: 'T2', t3: 'T3', t4: 'T4', incompatible: 'impossible', a_verifier: 'à vérifier', confirme: 'confirmée' }[v] || String(v));
function iaHtml(b) {
  const an = (Sync.data.analyses || new Map()).get(b.lbc_id), en = F && F.iaEnCours;
  const desc = ((b.physique || {}).description || '').trim();
  const texte = desc ? `<details class="desc"><summary>Texte complet de l'annonce</summary><p>${esc(desc).replace(/\n/g, '<br>')}</p></details>` : '';
  if (!an) return `<div class="card field ia">
      <span class="label">Analyse IA</span>
      <p class="note">L'IA lit le texte et les photos pour confirmer la distance à la mer, l'état, les équipements et la capacité réelle, puis liste les risques et les questions à poser. Ses conclusions remplacent la lecture automatique dans le calcul (tes corrections restent prioritaires).</p>
      <button class="small acc" data-ia ${en ? 'disabled' : ''}>${en ? 'Analyse en cours… (30 s environ)' : 'Analyser cette annonce'}</button>${texte}</div>`;
  const r = an.resultat || {}, li = (t, l) => l && l.length ? `<b class="ia-t">${t}</b><ul>${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const delta = (r.delta || []).map(x => `<li><b>${esc(x.nom)}</b> : ${esc(x.champ === 'prix' ? Deal.eur(x.avant) : VAL(x.avant))} → ${esc(x.champ === 'prix' ? Deal.eur(x.apres) : VAL(x.apres))}</li>`).join('');
  return `<div class="card field ia">
    <div class="row"><span class="label grow">Analyse IA <span class="note">· ${Deal.dateFr(an.cree)} · confiance ${esc(r.confiance || '?')}</span></span>
      <button class="small" data-ia="forcer" ${en ? 'disabled' : ''}>${en ? 'En cours…' : 'Réanalyser'}</button></div>
    ${r.synthese ? `<p class="ia-syn">${esc(r.synthese)}</p>` : ''}
    ${delta ? `<div class="ia-delta"><b class="ia-t">Ce qui change par rapport à la ${esc(r.reference_delta || 'lecture précédente')}</b><ul>${delta}</ul></div>` : `<p class="note">Rien ne change par rapport à la ${esc(r.reference_delta || 'lecture précédente')}.</p>`}
    ${r.travaux_detail ? `<p class="note"><b>Travaux :</b> ${esc(r.travaux_detail)}</p>` : ''}
    ${r.chambres != null || r.couchages != null ? `<p class="note"><b>Capacité :</b> ${r.chambres != null ? (r.chambres ? r.chambres + ' chambre' + (r.chambres > 1 ? 's' : '') : 'pas de chambre séparée') : ''}${r.couchages != null ? ' · ' + r.couchages + ' couchages' : ''}</p>` : ''}
    <details ${F && F.iaOuvert ? 'open' : ''} data-ia-det><summary>Points forts, risques et questions pour la visite</summary>
      ${li('Points forts', r.points_forts)}${li('Points faibles', r.points_faibles)}${li('Risques', r.risques)}${li('À demander / vérifier', r.questions_visite)}
      ${r.preuves ? `<b class="ia-t">Sur quoi l'IA s'appuie</b><ul class="preuves">${Object.entries(r.preuves).filter(([, v]) => v).map(([k, v]) => `<li><b>${esc(({ distance_mer: 'mer', vue_mer: 'vue mer', vendu_meuble: 'meublé' }[k]) || k)}</b> : ${esc(v)}</li>`).join('')}</ul>` : ''}
    </details>${texte}</div>`;
}

// ---------- Partage d'une fiche figée : instantané de ce qui est affiché, page publique servie par le serveur ----------
function instantane(b, avecNotes) {
  const r = Deal.calculer(b, F.enCours), h = r.hypotheses, e = Deal.bienEffectif(b), a = Sync.data.annotations.get(b.lbc_id) || {};
  const an = (Sync.data.analyses || new Map()).get(b.lbc_id), ar = (an && an.resultat) || null;
  const fat = Deal.fatigue(b), ref = Deal.prixM2Ref(b), pc = x => String(x).replace('.', ',') + ' %', o = v => VAL(v);
  return {
    titre: b.titre, prix_txt: Deal.eur(b.prix),
    sous_titre: [DealListe.TYPES[h.type] || h.type, b.surface + ' m²', b.surface ? Math.round(b.prix / b.surface).toLocaleString('fr-FR') + ' €/m²' : '',
      ref ? (ref.ecart > 0 ? '+' : '') + ref.ecart + ' % vs annonces ' + ref.libelle : '', 'DPE ' + (b.dpe || '?'), 'Golfe-Juan'].filter(Boolean).join(' · '),
    statut: r.statut, etoiles: r.etoiles, verdict: r.statut === 'exclu' ? 'Exclu' : r.statut === 'rejet' ? 'Perd de l\'argent même sans crédit' : '',
    rendement_txt: pc(r.rendement_net_pct), cash_flow_mois: r.effort_treso_mois, hors_capital_mois: r.effort_hors_capital_mois, cout_total_txt: Deal.eur(r.cout_total),
    chiffres: [
      ['Loyers encaissés / an', Deal.eur(r.revenus_bruts_an)], ['Conciergerie + plateforme', '−' + Deal.eur(r.frais_gestion_an)],
      ['Charges fixes / an', '−' + Deal.eur(h.charges_mois * 12)], ['Entretien, réserve, CRL / an', '−' + Deal.eur(r.entretien_courant_an + r.reserve_renouvellement_an + r.crl_an)],
      ['Solde d\'exploitation / an', Deal.eurS(r.net_avant_credit_an)], ['Prix d\'achat', Deal.eur(h.prix_achat) + (h.nego_pct ? ' (négocié −' + h.nego_pct + ' %)' : '')],
      ['Notaire', Deal.eur(r.notaire_eur)], ['Travaux + meubles', Deal.eur(h.travaux_eur + h.meubles_eur)], ['Frais bancaires', Deal.eur(r.frais_financement_eur)],
      ['Coût total du projet', Deal.eur(r.cout_total)], ['Apport', Deal.eur(r.apport)], ['Emprunt', Deal.eur(r.emprunt)],
      ['Mensualité (assurance comprise)', Deal.eur(r.mensualite_assurance_comprise)], ['Cash-flow après IS / mois', Deal.eurS(r.effort_treso_mois)],
      ['Capital remboursé / mois', Deal.eur(r.capital_rembourse_an1 / 12)], ['Coût réel hors capital / mois', Deal.eurS(r.effort_hors_capital_mois)],
      ['Résultat fiscal année 1', Deal.eurS(r.resultat_fiscal_an1)],
      r.is_autre_eur > 0 ? ['IS économisé par la société (an 1)', Deal.eur(r.economie_is_societe_an1)] : ['IS année 1', Deal.eur(r.is_du_an1)]],
    hypotheses: [
      ['Prix moyen par nuit', Deal.eur(h.adr)], ['Occupation', Math.round(h.occ_pct) + ' % de ' + h.jours_ouverts_an + ' nuits'],
      ['Conciergerie + plateforme', pc(Math.round(h.frais_gestion_pct * 10) / 10)], ['Charges fixes (copro incluse)', Deal.eur(h.charges_mois) + '/mois'],
      ['Travaux (aléas compris)', Deal.eur(h.travaux_eur)], ['Meubles', Deal.eur(h.meubles_eur)],
      ['Apport', h.apport_pct + ' % du prix'], ['Crédit', pc(h.taux_pct) + ' sur ' + h.duree_ans + ' ans']],
    caracteristiques: [
      ['Type de location', DealListe.TYPES[h.type] || h.type], ['Surface', b.surface + ' m²'], ['DPE', b.dpe || '?'], ['Étage', e.etage || '?'],
      ['Distance à la mer à pied', o(e.distance_mer)], ['Terrasse / jardin', o(e.terrasse)], ['Parking', o(e.parking)], ['Climatisation', o(e.clim)],
      ['Vue mer', o(e.vue_mer)], ['État', o(e.etat)], ['Travaux', o(e.niveau_travaux)],
      ['Copropriété', e.charges_copro_an ? Deal.eur(e.charges_copro_an) + '/an' : '?'], ['Annonce', fat.texte]],
    ia: ar ? { synthese: ar.synthese, points_forts: ar.points_forts, points_faibles: ar.points_faibles, risques: ar.risques, questions: ar.questions_visite } : null,
    notes: avecNotes ? (a.notes || '').slice(0, 3000) : ''
  };
}
function partageHtml(b) {
  const liens = (Sync.state.partages || []).filter(p => p.lbc_id === b.lbc_id && p.expire > Date.now());
  const P = F.partage || { jours: 30, notes: false };
  if (!F.partageOuvert && !liens.length) return '';
  return `<div class="card field partage">
    <span class="label">Partager une fiche figée</span>
    <p class="note">Crée une page web avec les photos, les chiffres et les hypothèses <b>tels qu'ils sont affichés maintenant</b> (curseurs en cours compris). Elle ne changera plus. Toute personne qui a le lien peut la voir, sans compte.</p>
    <div class="seg">${[7, 30, 90].map(j => `<button data-pj="${j}" class="${P.jours === j ? 'sel' : ''}">${j} jours</button>`).join('')}</div>
    <label class="row" style="gap:8px;font-weight:700"><input type="checkbox" data-pn ${P.notes ? 'checked' : ''}> Inclure mes notes</label>
    <button class="small acc" data-pcree ${F.partageEnCours ? 'disabled' : ''}>${F.partageEnCours ? 'Création…' : 'Créer le lien'}</button>
    ${liens.map(p => `<div class="lienp"><span class="note">Lien valable jusqu'au ${Deal.dateFr(p.expire)}</span>
      <div class="row wrap"><button class="small grow" data-pcopie="${esc(p.url)}">Copier</button>${navigator.share ? `<button class="small grow" data-ppart="${esc(p.url)}">Envoyer…</button>` : ''}
      <a class="small btnlien grow" href="${esc(p.url)}" target="_blank" rel="noopener">Ouvrir</a><button class="small grow danger" data-pret="${esc(p.slug)}">Retirer</button></div></div>`).join('')}
  </div>`;
}

function ficheHtml(b) {
  const a = Sync.data.annotations.get(b.lbc_id) || {};
  const r = Deal.calculer(b, F.enCours);
  const e = Deal.bienEffectif(b);
  const fat = Deal.fatigue(b);
  const negoSug = fat.niveau === 'forte' ? 8 : fat.niveau === 'moyenne' ? 5 : 0;   // piste de départ, à ajuster au curseur
  const sauves = Object.assign({}, a.curseurs || {}); delete sauves.physique;
  const corr = (a.curseurs && a.curseurs.physique) || {};
  const photos = (b.photos || []).map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1}" data-photo="${i}" loading="${i < 3 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer">`).join('');
  const ref = Deal.prixM2Ref(b);
  const hist = (Sync.data.prix.get(b.lbc_id) || []).slice().reverse();
  const orig = b.doublon_de && Sync.data.biens.get(b.doublon_de);
  const sl = CURSEURS.map(c => {
    const v = valeurDe(r, c.k); const mod = c.k in F.enCours || c.k in sauves;
    return `<div class="slider"><div class="row"><label class="label" for="c_${c.k}">${c.l}</label><output id="o_${c.k}" class="${mod ? 'mod' : ''}">${c.f(v, r)}</output></div>
      <input type="range" id="c_${c.k}" data-c="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"></div>`;
  }).join('');
  const seg = (k, items, cur) => `<div class="seg">${items.map(([v, l]) => `<button data-p="${k}" data-v="${v}" class="${String(cur == null ? '' : cur) === v ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
  const src = k => k in corr ? ' <span class="note">(corrigé)</span>' : (e._ia || []).includes(k) ? ' <span class="note ia-src">(IA)</span>' : '';
  const tg = (k, l) => `<div><span class="label">${l}${src(k)}</span>${seg(k, [['', '?'], ['true', 'Oui'], ['false', 'Non']], e[k])}</div>`;
  const inconnus = (e.inconnus || []).filter(k => !(k in corr) && !(k === 'etat' && corr.niveau_travaux));
  return `
    <div class="fiche"><div class="col-g">
    <div class="galerie">
      <div class="photos" id="photos">${photos || '<p class="vide">Pas de photo</p>'}</div>
      ${(b.photos || []).length > 1 ? `<button class="gal-nav g" data-gal="-1" aria-label="Photo précédente">‹</button><button class="gal-nav d" data-gal="1" aria-label="Photo suivante">›</button><span class="gal-nb">${b.photos.length} photos · clic pour agrandir</span>` : ''}
    </div>
    <div class="entete">
      <div><div class="px">${Deal.eur(b.prix)}</div>
        <div class="sub">${esc(DealListe.TYPES[b.type] || '')} · ${b.surface} m² · ${b.surface ? Math.round(b.prix / b.surface).toLocaleString('fr-FR') + ' €/m²' : ''}${ref ? ` <span class="${ref.ecart <= -10 ? 'pos' : ref.ecart >= 10 ? 'neg' : ''}">(${ref.ecart > 0 ? '+' : ''}${ref.ecart} % vs ${ref.n} annonces ${esc(ref.libelle)})</span>` : ''} · DPE ${esc(b.dpe || '?')}${e.etage ? ' · ' + esc(e.etage) : ''}</div></div>
      <button class="round" data-fav aria-label="${a.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}" style="font-size:1.4em;color:var(--star)">${a.favori ? '★' : '☆'}</button>
    </div>
    <p class="note">${esc(b.titre)}</p>
    <div class="row wrap"><a class="lien grow" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">Voir l'annonce sur LeBonCoin ↗</a>
      <button class="lien grow" data-pouvrir>Partager une fiche figée</button></div>
    <div id="partage">${partageHtml(b)}</div>
    <div id="verdict">${verdictHtml(r, b)}</div>
    <div id="ia">${iaHtml(b)}</div>
    <div class="card field"><span class="label">Vendeur qui fatigue</span>
      <span class="${fat.niveau === 'forte' ? 'pos' : ''}" style="font-weight:800">${esc(fat.texte)}</span>
      ${orig ? `<span class="note">Republication de l'annonce ${esc(orig.lbc_id)} (ancienneté cumulée).</span>` : fat.republie ? '<span class="note">Republication d\'une annonce retirée (ancienneté cumulée).</span>' : ''}
      ${hist.length > 1 ? `<div class="hist">${hist.map(p => `<div class="row"><span>${Deal.dateFr(p.ts)}</span><b>${Deal.eur(p.prix)}</b></div>`).join('')}</div>` : ''}
      ${negoSug ? `<button class="small" data-nego="${negoSug}">Simuler une offre à −${negoSug} %</button>` : ''}
    </div>
    <div class="apres">
    <h3 class="h3">Caractéristiques</h3>
    <div class="card field">
      ${inconnus.length ? `<p class="note">Inconnu dans l'annonce : ${esc(inconnus.map(k => ({ distance_mer: 'distance à la mer', etat: 'état / travaux', dpe: 'DPE' }[k] || k)).join(', '))}. Corrige ci-dessous si tu sais.</p>` : ''}
      <span class="label">Distance à la mer à pied${'distance_mer' in corr ? ' <span class="note">(corrigée)</span>' : (e._ia || []).includes('distance_mer') ? ' <span class="note ia-src">(IA)</span>' : e.distance_mer ? '' : ' <span class="note">(inconnue, effet neutre)</span>'}</span>
      ${seg('distance_mer', DIST, e.distance_mer)}
      <span class="label">Travaux à prévoir${src('niveau_travaux')}</span>
      ${seg('niveau_travaux', TRAV, e.niveau_travaux)}
      <div class="carac">${tg('vue_mer', 'Vue mer')}${tg('terrasse', 'Terrasse / jardin')}${tg('parking', 'Parking')}${tg('clim', 'Climatisation')}</div>
      <p class="note">? = inconnu, sans décote automatique. État inconnu : provision de travaux légers dans le budget.</p>
      <span class="label">Faisabilité juridique (copropriété et autorisations)</span>
      ${seg('statut_juridique', [['a_verifier', 'À vérifier'], ['confirme', 'Confirmée'], ['incompatible', 'Impossible']], e.statut_juridique || 'a_verifier')}
      ${tg('crl_applicable', 'CRL applicable (âge / exonérations)')}
      ${e.charges_copro_an ? `<p class="note">Charges de copropriété annoncées : ${Deal.eur(e.charges_copro_an)}/an.</p>` : ''}
      ${Object.keys(corr).length ? '<button class="small" data-preset>Annuler mes corrections</button>' : ''}
    </div>
    <h3 class="h3">Suivi</h3>
    <div class="card field">
      <div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))">${Object.entries(DealListe.STATUTS).map(([v, l]) => `<button data-st="${v}" class="${(a.statut || '') === v ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <label class="label" for="notes">Notes</label>
      <textarea class="input area" id="notes" maxlength="5000" placeholder="Visite, échanges avec l'agence, points à vérifier…">${esc(a.notes || '')}</textarea>
    </div>
    <p class="note center">Annonce ${esc(b.lbc_id)} · vue pour la première fois le ${Deal.dateFr(b.premiere_vue)} · mise à jour ${Deal.ago(b.derniere_vue)} · scoring v${esc(r.version)}</p>
    </div></div>
    <div class="simu">
      <div class="row wrap"><button class="small acc grow" data-save>Garder ces réglages pour ce bien</button><button class="small grow" data-reset>Revenir aux réglages globaux</button></div>
      <p class="note" style="margin-top:-4px">${Object.keys(sauves).length ? 'Ce bien a ses propres réglages (en couleur). ' : ''}<span class="tactile">Glisse un curseur de gauche à droite pour le modifier ; un geste vertical fait seulement défiler.</span></p>
      <div class="simbar" id="simbar">${simbarHtml(r)}</div>
      <div class="simu-cols">
        <div class="card field sliders" id="sliders">${sl}</div>
        <div class="card" id="metrics">${metricsHtml(r)}</div>
      </div>
    </div></div>`;
}

function majSimulateur(b) {
  const r = Deal.calculer(b, F.enCours);
  const a = Sync.data.annotations.get(b.lbc_id) || {}; const sauves = a.curseurs || {};
  CURSEURS.forEach(c => { const o = $('o_' + c.k); if (o) { o.textContent = c.f(valeurDe(r, c.k), r); o.classList.toggle('mod', c.k in F.enCours || c.k in sauves); } });
  $('verdict').innerHTML = verdictHtml(r, b);
  $('simbar').innerHTML = simbarHtml(r);
  $('metrics').innerHTML = metricsHtml(r);
}

function ouvrirFiche(id) {
  const b = Sync.data.biens.get(String(id));
  if (!b) { Deal.toast('Ce bien n\'est plus en ligne.'); return; }
  F = { id: b.lbc_id, enCours: {}, aides: new Set() };
  Deal.openSheet(b.titre || 'Bien', ficheHtml(b), clicFiche, true);
  history.replaceState(history.state, '', location.pathname + '#bien=' + b.lbc_id);
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
  // ----- partage -----
  if (t.closest('[data-pouvrir]')) { F.partageOuvert = !F.partageOuvert; $('partage').innerHTML = partageHtml(b); if (F.partageOuvert) $('partage').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  const pj = t.closest('[data-pj]');
  if (pj) { F.partage = Object.assign({ jours: 30, notes: false }, F.partage, { jours: +pj.dataset.pj }); $('partage').innerHTML = partageHtml(b); return; }
  if (t.closest('[data-pn]')) { F.partage = Object.assign({ jours: 30, notes: false }, F.partage, { notes: t.closest('[data-pn]').checked }); return; }
  if (t.closest('[data-pcree]') && !F.partageEnCours) {
    const P = F.partage || { jours: 30, notes: false }, id = b.lbc_id;
    F.partageEnCours = true; $('partage').innerHTML = partageHtml(b);
    Sync.partager(id, instantane(b, P.notes), P.jours).then(j => {
      Deal.toast('Lien créé' + (j.photos ? ' avec ' + j.photos + ' photos' : '') + ' : copie-le ou envoie-le ci-dessous');
    }).catch(err => Deal.toast(err.message)).finally(() => { if (F && F.id === id) { F.partageEnCours = false; $('partage').innerHTML = partageHtml(b); } });
    return;
  }
  const pc = t.closest('[data-pcopie]'); if (pc) { Deal.copier(pc.dataset.pcopie, 'Lien copié'); return; }
  const pp = t.closest('[data-ppart]'); if (pp) { navigator.share({ title: b.titre, url: pp.dataset.ppart }).catch(() => {}); return; }
  const pr = t.closest('[data-pret]');
  if (pr) {
    pr.disabled = true;
    Sync.retirerPartage(pr.dataset.pret).then(() => Deal.toast('Lien retiré : la page n\'est plus accessible'))
      .catch(err => { pr.disabled = false; Deal.toast(err.message); }).finally(() => { if (F && F.id === b.lbc_id) $('partage').innerHTML = partageHtml(b); });
    return;
  }
  const bi = t.closest('[data-ia]');
  if (bi && !F.iaEnCours) {
    F.iaEnCours = true; const id = b.lbc_id; $('ia').innerHTML = iaHtml(b);
    Sync.analyser(id, bi.dataset.ia === 'forcer').then(j => {
      Deal.toast(j.cache ? 'Annonce inchangée : analyse précédente conservée' : 'Analyse terminée : calcul mis à jour');
    }).catch(err => Deal.toast(err.message)).finally(() => { if (F && F.id === id) { F.iaEnCours = false; rerendre(); } });
    return;
  }
  const dt = t.closest('[data-ia-det] > summary');
  if (dt) F.iaOuvert = !dt.parentElement.open;
  const ai = t.closest('[data-aide]');
  if (ai) { const k = ai.dataset.aide; F.aides.has(k) ? F.aides.delete(k) : F.aides.add(k); majSimulateur(b); return; }
  const ph = t.closest('[data-photo]');
  if (ph) { Deal.galerie(b.photos || [], +ph.dataset.photo); return; }
  const gn = t.closest('[data-gal]');
  if (gn) { const el = $('photos'); el.scrollBy({ left: +gn.dataset.gal * el.clientWidth * 0.8, behavior: 'smooth' }); return; }
  const ng = t.closest('[data-nego]');
  if (ng) {
    F.enCours.nego_pct = +ng.dataset.nego;
    const s = $('c_nego_pct'); if (s) s.value = F.enCours.nego_pct;
    majSimulateur(b); $('simbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
  }
  if (t.closest('[data-reset]')) {
    const phys = cur.physique; F.enCours = {};
    Sync.annoter(b.lbc_id, { curseurs: phys ? { physique: phys } : {} }); Deal.toast('Réglages globaux rétablis'); setTimeout(rerendre, 0); return;
  }
  const p = t.closest('[data-p]'), pt = t.closest('[data-pt]');
  if (p || pt) {
    const phys = Object.assign({}, cur.physique || {});
    if (p) phys[p.dataset.p] = p.dataset.v === '' ? null : p.dataset.v === 'true' ? true : p.dataset.v === 'false' ? false : p.dataset.v;
    else { const v = Deal.bienEffectif(b)[pt.dataset.pt]; phys[pt.dataset.pt] = v == null ? true : v === true ? false : null; }
    if (p && p.dataset.p === 'niveau_travaux') {
      delete F.enCours.travaux_eur; delete cur.travaux_eur; delete phys.etat_apres_travaux;
      if (!p.dataset.v) phys.etat = null;
      else delete phys.etat;
    }
    cur.physique = phys; Sync.annoter(b.lbc_id, { curseurs: cur }); setTimeout(rerendre, 0); return;
  }
  if (t.closest('[data-preset]')) { delete cur.physique; Sync.annoter(b.lbc_id, { curseurs: cur }); setTimeout(rerendre, 0); }
}
// Données mises à jour pendant que la fiche est ouverte (synchro) : on rafraîchit sans perdre les curseurs en cours.
window.rafraichirFiche = () => { if (F && !document.body.dataset.glisse) rerendre(); };
window.ouvrirFiche = ouvrirFiche;
