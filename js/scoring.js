/* Deal — moteur pur partagé PWA / n8n, sans dépendance ni réseau.
 * API et anciens champs conservés. Budgets indicatifs, année stabilisée.
 * v2 : trois états, rendement hors financement, coût complet, cash-flow après IS.
 */
(function (root) {
  'use strict';
  var VERSION = '2.1.0', RANG = ['studio', 't2', 't3', 't4'];
  var EQUIPEMENTS = ['parking', 'terrasse', 'clim', 'vue_mer', 'ascenseur', 'vendu_meuble'];
  var DEFAUTS = {
    benchmarks: {
      studio: { smin: 0, smax: 29, adr: 85, occ: 50, net: 67.6, charges: 310, copro: 90, meubles: 5000 },
      t2: { smin: 30, smax: 44, adr: 100, occ: 52, net: 67.6, charges: 357.5, copro: 110, meubles: 7000 },
      t3: { smin: 45, smax: 66, adr: 130, occ: 48, net: 67.6, charges: 4880 / 12, copro: 140, meubles: 10000 },
      t4: { smin: 67, smax: 999, adr: 165, occ: 45, net: 67.6, charges: 460, copro: 170, meubles: 13000 }
    },
    ajustements: {
      distance_mer: { '0-3': [1.05, 1], '3-7': [1, 1], '7-12': [0.95, 1], '12+': [0.85, 1] },
      parking: { oui: [1, 1], non: [0.95, 1] }, terrasse: { oui: [1, 1], non: [0.95, 1] },
      clim: { oui: [1, 1], non: [0.90, 1] }, vue_mer: { non: [1, 1], oui: [1.10, 1] },
      etat: { bon: [1, 1], refait_neuf: [1.05, 1], a_rafraichir: [0.90, 1] }
    },
    travaux_m2: { aucun: 0, leger: 400, moyen: 800, lourd: 1300, structurel: 2000 },
    fin: {
      apport_pct: 20, taux_pct: 4, duree_ans: 15, notaire_pct: 8,
      amort_bien_ans: 30, part_bati_pct: 70, amort_travaux_ans: 10, amort_meubles_ans: 7,
      is_bas_pct: 15, is_haut_pct: 25, is_seuil_eur: 42500, is_taux_reduit_eligible: true,
      horizon_is_ans: 10, copro_min_fiable_an: 300, vacance_imprevue_pct: 0, occ_max_pct: 100,
      jours_ouverts_an: 350, aleas_travaux_pct: 15, entretien_courant_pct: 2, reserve_renouvellement_pct: 3,
      plateforme_pct: 15.5, conciergerie_pct: 20, assiette_conciergerie: 'apres_plateforme',
      frais_dossier_eur: 1000, garantie_pct_emprunt: 1.5, assurance_emprunteur_pct: 0.30,
      frais_creation_eur: 0, frais_lancement_eur: 0, travaux_copro_eur: 0,
      crl_pct: 2.5, crl_applicable: null, duree_sejour_moyenne: 5,
      menage_cout_sejour: 0, menage_facture_sejour: null, reserve_tresorerie_mois: 6,
      // IS que la société paie déjà sur ses autres activités (€/an). 0 = le bien est seul dans sa société.
      // Sinon, le déficit fiscal du bien s'impute sur ce bénéfice la même année et réduit l'IS déjà dû.
      is_autre_eur: 0
    },
    // Rendement en %, avant financement et IS, sur investissement hors financement.
    paliers: [[0, 1], [2, 2], [4, 3], [6, 4], [8, 5]], defauts_commune: { distance_mer: null }
  };
  function present(v) { return v !== undefined && v !== null && v !== ''; }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (!present(v) || typeof v === 'boolean' || typeof v === 'object') return null;
    var s = String(v).trim().replace(/[\s\u00a0\u202f€%]/g, '').replace(/(?:eur|euros?|m²|m2|\/an|\/mois)$/i, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else s = s.replace(',', '.');
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) && isFinite(+s) ? +s : null;
  }
  function tri(v) {
    if (v === true || v === false) return v;
    if (/^(oui|true|1)$/i.test(String(v))) return true;
    if (/^(non|false|0)$/i.test(String(v))) return false;
    return null;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function fusion(base, sur) {
    var out = clone(base), k;
    for (k in (sur || {})) if (Object.prototype.hasOwnProperty.call(sur, k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      if (sur[k] && typeof sur[k] === 'object' && !Array.isArray(sur[k]) && out[k] && typeof out[k] === 'object') out[k] = fusion(out[k], sur[k]);
      else if (sur[k] !== undefined) out[k] = clone(sur[k]);
    }
    return out;
  }
  function paliersValides(p) {
    return Array.isArray(p) && p.length >= 2 && p.every(function (x, i) {
      return Array.isArray(x) && x.length === 2 && num(x[0]) !== null && x[0] >= 0 && x[0] <= 100 && num(x[1]) !== null &&
        x[1] >= 1 && x[1] <= 5 && (!i || (x[0] > p[i - 1][0] && x[1] >= p[i - 1][1]));
    });
  }
  // Ne modifie pas les réglages enregistrés. Complète les nouveaux champs et migre
  // uniquement le barème en €/mois devenu incompatible. Les budgets personnalisés restent prioritaires.
  function normaliserReglages(r) {
    var out = fusion(DEFAUTS, r || {});
    ['benchmarks', 'ajustements', 'travaux_m2', 'fin', 'defauts_commune'].forEach(function (k) {
      if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = clone(DEFAUTS[k]);
    });
    RANG.forEach(function (t) { out.benchmarks[t] = fusion(DEFAUTS.benchmarks[t], out.benchmarks[t] || {}); });
    out._paliers_migres = !paliersValides(out.paliers) || !!(r && r._paliers_migres);
    if (!paliersValides(out.paliers)) out.paliers = clone(DEFAUTS.paliers);
    out.paliers = out.paliers.map(function (p) { return [Number(p[0]), Number(p[1])]; });
    return out;
  }
  function typeDepuis(surface, pieces) {
    surface = num(surface); pieces = num(pieces);
    if (pieces !== null && pieces >= 1) return RANG[Math.min(4, Math.floor(pieces)) - 1];
    return surface !== null && surface > 0 ? RANG[surface < 30 ? 0 : surface < 45 ? 1 : surface < 67 ? 2 : 3] : 't2';
  }
  function equipement(texte, motif, structure) {
    var re = new RegExp('\\b(?:' + motif + ')\\b', 'g'), m, pos = [], neg = [], doute = [];
    while ((m = re.exec(texte))) {
      var avant = texte.slice(Math.max(0, m.index - 80), m.index), apres = texte.slice(re.lastIndex, re.lastIndex + 70);
      var extrait = texte.slice(Math.max(0, m.index - 35), re.lastIndex + 40).trim();
      var non = /(?:sans|aucune?|absence de|pas de|pas d['’]|ni|depourvu(?:e)? de)\s*(?:(?:un|une|le|la|de|d['’])\s*)?(?:(?:place|systeme|installation) de\s*)?$/.test(avant) ||
        /(?:sans|pas de|aucune?)\s+[^.;,\n]{0,60}\b(?:ni|et)\s*$/.test(avant) || /^\s*(?::\s*)?(?:non|absent[e]?|inexistant[e]?)\b/.test(apres);
      var incertain = /(?:possibilite|option|proximite|proche)\b[^.;,\n]{0,55}$/.test(avant) || /(?:prevoir|installer|installation d['’]une?|vue sur)\s+(?:(?:de|du|d['’]un|un|une|le|la)\s*)?$/.test(avant) ||
        /^\s*(?:(?:prive|ferme|couvert|disponible)\s+)?(?:en sus|en supplement|en option|a louer|public|municipal|collectif|commun|a proximite|a installer|possible|en face)\b/.test(apres);
      (non ? neg : incertain ? doute : pos).push(extrait);
    }
    var st = tri(structure), conflit = (pos.length && neg.length) || (st === true && neg.length) || (st === false && pos.length);
    return { valeur: conflit ? null : neg.length ? false : pos.length ? true : st, preuves: pos.concat(neg, doute).slice(0, 4), conflit: !!conflit };
  }
  function extraire(raw) {
    raw = raw || {};
    var a = raw.attributes || {}, t = norm((raw.title || '') + '\n' + (raw.description || ''));
    var surface = num(a.square), pieces = num(a.rooms), exclusions = [], preuves = {}, inconnus = [], conflits = [];
    var titre = norm(raw.title), rtype = norm(a.real_estate_type);
    if (/\bviager\b/.test(t) && !/\b(?:sans|pas de|hors) viager\b/.test(t)) exclusions.push('viager');
    if (/vente a terme/.test(t)) exclusions.push('vente à terme');
    if (/nue[- ]propriete|vente.*usufruit/.test(t)) exclusions.push('nue-propriété / usufruit');
    if (/sous (offre|compromis)/.test(t) && !/pas sous (offre|compromis)/.test(t)) exclusions.push('sous offre / compromis');
    if (/vendu loue|locataire en place|bail en cours|vendeur occupant|occupe par/.test(t)) exclusions.push('bien occupé');
    if (/^(?:vente |a vendre )?(?:local commercial|fonds de commerce|murs commerciaux|bureaux?\b)/.test(titre) || (rtype && !/appartement|maison/.test(rtype))) exclusions.push('non résidentiel');
    if (/residence (?:services|senior|geree|de tourisme)|bail commercial/.test(t)) exclusions.push('résidence gérée');
    var dist = null, m;
    if (/pieds dans l.eau|front de mer|bord de mer/.test(t) && !/(?:pas|loin|hors|proche|proximite)[^.;,\n]{0,30}(?:front de mer|bord de mer)/.test(t)) dist = '0-3';
    else if ((m = t.match(/(\d{1,4})\s*(?:m|metres?)\s+(?:de la |des |de |du )?(?:mer|plages?)\b/))) {
      var d = +m[1]; dist = d <= 250 ? '0-3' : d <= 550 ? '3-7' : d <= 1000 ? '7-12' : '12+';
    } else if ((m = t.match(/(\d{1,2})\s*(?:min|minutes?|mn)\s+a pied\s+(?:de la |des |de |du )?(?:mer|plages?)\b/))) {
      var mn = +m[1]; dist = mn <= 3 ? '0-3' : mn <= 7 ? '3-7' : mn <= 12 ? '7-12' : '12+';
    }
    var nb = num(a.nb_parkings), ext = norm(a.outside_access), eq = {};
    var defs = {
      parking: ['parkings?|garages?|place de stationnement', nb === null ? null : nb > 0, norm(a.specificities)],
      terrasse: ['terrasses?|jardins?', /terrasse|jardin/.test(ext) ? true : /^(non|aucun)$/.test(ext) ? false : null, ''],
      clim: ['clim|climatisation|climatise[e]?s?', null, ''],
      vue_mer: ['vue (?:degagee |panoramique )?(?:sur (?:la )?)?mer', null, ''],
      ascenseur: ['ascenseur', tri(a.elevator), ''], vendu_meuble: ['vendu meuble|vente meublee|cede meuble|entierement meuble|meuble et equipe', null, '']
    };
    EQUIPEMENTS.forEach(function (k) {
      var e = equipement(t + '\n' + defs[k][2], defs[k][0], defs[k][1]); eq[k] = e.valeur; preuves[k] = e.preuves;
      if (e.valeur === null) inconnus.push(k); if (e.conflit) conflits.push(k);
    });
    var gc = norm(a.global_condition), etat = null, niveau = null;
    if (/renover entierement|renover totalement|entierement a renover|gros travaux|a rehabiliter|plateau a amenager/.test(t)) { etat = 'a_rafraichir'; niveau = 'lourd'; }
    else if (/neuf|refait/.test(gc) || /(?:appartement|logement|bien)\s+(?:entierement\s+)?(?:renove|refait a neuf)|entierement refait a neuf/.test(t)) { etat = 'refait_neuf'; niveau = 'aucun'; }
    else if (/bon/.test(gc) || /aucuns? travaux|pas de travaux|bon etat/.test(t)) { etat = 'bon'; niveau = 'aucun'; }
    else if (/travaux|renover/.test(gc) || /a renover/.test(t)) { etat = 'a_rafraichir'; niveau = 'moyen'; }
    else if (/rafraichir/.test(gc) || /a rafraichir|travaux a prevoir|rafraichissement/.test(t)) { etat = 'a_rafraichir'; niveau = 'leger'; }
    var dpe = String(a.energy_rate || '').trim().toUpperCase(); if (!/^[A-G]$/.test(dpe)) dpe = null;
    if (!dist) inconnus.push('distance_mer'); if (!niveau) inconnus.push('etat'); if (!dpe) inconnus.push('dpe');
    if (!surface) inconnus.push('surface'); if (!pieces) inconnus.push('pieces');
    return fusion(eq, { extraction_version: VERSION, preuves: preuves, conflits: conflits,
      id: String(raw.adId || raw.listing_id || ''), url: raw.url || '', titre: raw.title || '', prix: num(raw.price), ancien_prix: num(a.old_price),
      surface: surface, pieces: pieces, type: typeDepuis(surface, pieces), dpe: dpe, charges_copro_an: num(a.annual_charges), etage: a.floor_display || null,
      distance_mer: dist, etat: etat, niveau_travaux: niveau, exclusions: exclusions, inconnus: inconnus,
      vendeur: raw.seller ? raw.seller.type : null, publie_le: raw.firstPublishedAt || null,
      lat: raw.location ? raw.location.lat : null, lng: raw.location ? raw.location.lng : null, photos: raw.images && raw.images.urls || [] });
  }
  function mensualite(capital, tauxPct, mois) {
    if (!capital) return 0; var r = tauxPct / 1200;
    return r ? capital * r / (1 - Math.pow(1 + r, -mois)) : capital / mois;
  }
  function etoilesDepuis(x, p) {
    if (x <= p[0][0]) return p[0][1];
    for (var i = 1; i < p.length; i++) if (x <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
    return p[p.length - 1][1];
  }
  function calculer(bien, reglages, curseurs) {
    bien = bien || {}; var R = normaliserReglages(reglages), c = curseurs || {}, raisons = [];
    function nombre(v, repli, min, max, nom) {
      var n = num(v); if (n === null) { if (present(v)) raisons.push(nom + ' invalide : défaut utilisé'); n = repli; }
      var borne = Math.max(min, Math.min(max, n)); if (borne !== n) raisons.push(nom + ' borné à ' + borne); return borne;
    }
    var type = RANG.indexOf(bien.type) >= 0 ? bien.type : typeDepuis(bien.surface, bien.pieces), B = R.benchmarks[type], F = {};
    var limites = {
      apport_pct: [0, 100], taux_pct: [0, 30], duree_ans: [1, 40], notaire_pct: [0, 20], amort_bien_ans: [1, 100], part_bati_pct: [0, 100],
      amort_travaux_ans: [1, 100], amort_meubles_ans: [1, 100], is_bas_pct: [0, 100], is_haut_pct: [0, 100], is_seuil_eur: [0, 1e9],
      horizon_is_ans: [1, 40], copro_min_fiable_an: [0, 1e6], vacance_imprevue_pct: [0, 100], occ_max_pct: [0, 100], jours_ouverts_an: [0, 365],
      aleas_travaux_pct: [0, 100], entretien_courant_pct: [0, 100], reserve_renouvellement_pct: [0, 100], plateforme_pct: [0, 99], conciergerie_pct: [0, 100],
      frais_dossier_eur: [0, 1e7], garantie_pct_emprunt: [0, 20], assurance_emprunteur_pct: [0, 10], frais_creation_eur: [0, 1e7],
      frais_lancement_eur: [0, 1e7], travaux_copro_eur: [0, 1e8], crl_pct: [0, 100], duree_sejour_moyenne: [1, 365],
      menage_cout_sejour: [0, 1e5], reserve_tresorerie_mois: [0, 24], is_autre_eur: [0, 1e8]
    };
    Object.keys(limites).forEach(function (k) { F[k] = nombre(present(c[k]) ? c[k] : R.fin[k], DEFAUTS.fin[k], limites[k][0], limites[k][1], k); });
    F.horizon_is_ans = Math.floor(F.horizon_is_ans);
    var prix = num(bien.prix); if (prix === null || prix <= 0) throw new RangeError('Prix du bien absent ou invalide');
    var surface = nombre(bien.surface, 0, 0, 10000, 'surface'), nego = nombre(c.nego_pct, 0, 0, 50, 'nego_pct'), prixAchat = prix * (1 - nego / 100);
    var niv = present(c.niveau_travaux) ? c.niveau_travaux : bien.niveau_travaux;
    if (!Object.prototype.hasOwnProperty.call(DEFAUTS.travaux_m2, niv)) niv = 'leger';
    var travauxBase = surface * nombre(R.travaux_m2[niv], DEFAUTS.travaux_m2[niv], 0, 20000, 'travaux_m2');
    // Le curseur représente un budget TOTAL déjà aléas compris.
    var travaux = present(c.travaux_eur) ? nombre(c.travaux_eur, travauxBase, 0, 1e8, 'travaux_eur') : travauxBase * (1 + F.aleas_travaux_pct / 100);
    var meubles = nombre(present(c.meubles_eur) ? c.meubles_eur : B.meubles, DEFAUTS.benchmarks[type].meubles, 0, 1e7, 'meubles_eur');
    var etatApres = c.etat_apres_travaux || bien.etat_apres_travaux;
    if (!Object.prototype.hasOwnProperty.call(DEFAUTS.ajustements.etat, etatApres)) {
      var renovationFinancee = travauxBase > 0 && travaux >= travauxBase && niv !== 'aucun';
      etatApres = renovationFinancee ? 'bon' : bien.etat;
      if (renovationFinancee) raisons.push('État bon après travaux supposé : programme et devis à confirmer');
      else if (travaux > 0 && niv !== 'aucun') raisons.push('Budget inférieur au programme de travaux : état actuel conservé');
    }
    var dist = bien.distance_mer || null, mAdr = 1;
    function ajuster(cat, cle) {
      if (cle === null || cle === undefined) return; var pair = R.ajustements[cat] && R.ajustements[cat][cle];
      if (Array.isArray(pair) && num(pair[0]) !== null) mAdr *= nombre(pair[0], 1, 0.1, 2, cat);
    }
    ajuster('distance_mer', dist);
    ['parking', 'terrasse', 'clim', 'vue_mer'].forEach(function (k) { var v = tri(bien[k]); ajuster(k, v === null ? null : v ? 'oui' : 'non'); if (v === null) raisons.push(k + ' inconnu : effet neutre'); });
    ajuster('etat', etatApres); mAdr = Math.max(0.8, Math.min(1.2, mAdr));
    var adr = nombre(c.adr, nombre(B.adr, DEFAUTS.benchmarks[type].adr, 0, 10000, 'benchmark ADR') * mAdr, 0, 10000, 'adr');
    // Pas de coefficients d'occupation cumulés, y compris avec des réglages v1.
    var occ = nombre(c.occ_pct, nombre(B.occ, DEFAUTS.benchmarks[type].occ, 0, 100, 'benchmark occupation'), 0, F.occ_max_pct, 'occ_pct');
    if (occ > 85) raisons.push('Occupation supérieure à 85 % : vérifier les comparables');
    var nuits = F.jours_ouverts_an * occ / 100 * (1 - F.vacance_imprevue_pct / 100), brut = adr * nuits;
    var pf = F.plateforme_pct / 100, cc = F.conciergerie_pct / 100, assiette = c.assiette_conciergerie || R.fin.assiette_conciergerie;
    var plateforme = brut * pf, conciergerie = brut * (assiette === 'brut' ? 1 : 1 - pf) * cc;
    var gestionPct = (pf + (assiette === 'brut' ? 1 : 1 - pf) * cc) * 100, gestion = plateforme + conciergerie;
    var netLegacy = nombre(B.net, 67.6, 0, 100, 'benchmark net');
    if (present(c.frais_gestion_pct) || (Math.abs(netLegacy - 67.6) > 1e-8 && !present(c.plateforme_pct) && !present(c.conciergerie_pct))) {
      gestionPct = nombre(c.frais_gestion_pct, 100 - netLegacy, 0, 100, 'frais_gestion_pct'); gestion = brut * gestionPct / 100; plateforme = null; conciergerie = null;
      raisons.push('Gestion forfaitaire : vérifier la neutralité du ménage');
    }
    var sejours = nuits / F.duree_sejour_moyenne, coutMenage = sejours * F.menage_cout_sejour;
    var factureMenage = present(c.menage_facture_sejour) ? c.menage_facture_sejour : R.fin.menage_facture_sejour;
    var prixMenage = nombre(factureMenage, F.menage_cout_sejour / (1 - pf), 0, 1e6, 'menage_facture_sejour');
    var recettesMenage = sejours * prixMenage, fraisMenage = recettesMenage * pf, margeMenage = recettesMenage - fraisMenage - coutMenage;
    if (!F.menage_cout_sejour) raisons.push('Ménage supposé neutre : coûts et refacturation à confirmer');
    var coproAn = num(bien.charges_copro_an), coproAnn = coproAn !== null && coproAn >= 0;
    var copro = nombre(c.copro_mois, coproAnn ? coproAn / 12 : nombre(B.copro, DEFAUTS.benchmarks[type].copro, 0, 1e6, 'copro défaut'), 0, 1e6, 'copro_mois');
    if (coproAnn && coproAn < F.copro_min_fiable_an) raisons.push('Copro faible (' + coproAn + ' €/an) conservée : justificatif à vérifier');
    var horsCopro = nombre(c.charges_hors_copro_mois, nombre(B.charges, DEFAUTS.benchmarks[type].charges, 0, 1e6, 'charges défaut'), 0, 1e6, 'charges_hors_copro_mois');
    var charges = nombre(c.charges_mois, horsCopro + copro, 0, 1e6, 'charges_mois');
    if (present(c.charges_mois)) horsCopro = Math.max(0, charges - copro);
    var crlApplicable = tri(present(c.crl_applicable) ? c.crl_applicable : present(bien.crl_applicable) ? bien.crl_applicable : R.fin.crl_applicable);
    if (crlApplicable === null) raisons.push('CRL de ' + F.crl_pct + ' % provisionnée : âge du bâtiment et exonérations à vérifier');
    var crl = crlApplicable === false ? 0 : nombre(c.crl_assiette_eur, brut, 0, 1e9, 'crl_assiette_eur') * F.crl_pct / 100;
    var entretien = brut * F.entretien_courant_pct / 100, reserve = brut * F.reserve_renouvellement_pct / 100;
    var revenusNets = brut - gestion + margeMenage, netAvantCredit = revenusNets - charges * 12 - crl - entretien - reserve;
    var notaire = prixAchat * F.notaire_pct / 100;
    var coutHorsFinancement = prixAchat + notaire + travaux + meubles + F.travaux_copro_eur + F.frais_creation_eur + F.frais_lancement_eur;
    var apportDemande = present(c.apport_eur) ? nombre(c.apport_eur, 0, 0, 1e10, 'apport_eur') : prixAchat * F.apport_pct / 100;
    var aFinancer = Math.max(0, coutHorsFinancement - apportDemande), dossier = aFinancer > 0 ? F.frais_dossier_eur : 0;
    var emprunt = aFinancer > 0 ? (aFinancer + dossier) / (1 - F.garantie_pct_emprunt / 100) : 0;
    var garantie = emprunt * F.garantie_pct_emprunt / 100, coutTotal = coutHorsFinancement + dossier + garantie, apport = Math.min(apportDemande, coutTotal);
    var moisCredit = Math.round(F.duree_ans * 12), mens = mensualite(emprunt, F.taux_pct, moisCredit), assurance = emprunt * F.assurance_emprunteur_pct / 100;
    // Frais bancaires exclus de l'assiette du score, inclus dans le coût et le financement réels.
    var rendement = netAvantCredit / coutHorsFinancement * 100;
    var eligibleReduit = tri(present(c.is_taux_reduit_eligible) ? c.is_taux_reduit_eligible : R.fin.is_taux_reduit_eligible) !== false;
    function isDe(base) { return base <= 0 ? 0 : eligibleReduit ? Math.min(base, F.is_seuil_eur) * F.is_bas_pct / 100 + Math.max(0, base - F.is_seuil_eur) * F.is_haut_pct / 100 : base * F.is_haut_pct / 100; }
    // Bénéfice des autres activités retrouvé à partir de l'IS qu'elles génèrent (inverse du barème).
    function beneficeDepuisIS(is) {
      if (is <= 0) return 0;
      if (!eligibleReduit || !F.is_bas_pct) return F.is_haut_pct ? is / (F.is_haut_pct / 100) : 0;
      var plafondBas = F.is_seuil_eur * F.is_bas_pct / 100;
      return is <= plafondBas ? is / (F.is_bas_pct / 100) : F.is_seuil_eur + (is - plafondBas) / (F.is_haut_pct / 100);
    }
    var benefAutre = beneficeDepuisIS(F.is_autre_eur), isAutre = isDe(benefAutre);
    function dotation(montant, duree, an) { return montant / duree * Math.max(0, Math.min(1, duree - an + 1)); }
    var restant = emprunt, reportAvec = 0, reportSans = 0, cumulAvec = 0, cumulSans = 0, anneesSansIS = 0, an1, echeancier = [];
    for (var y = 1; y <= F.horizon_is_ans; y++) {
      var intY = 0, capitalY = 0, paiementsY = 0, moisY = 0;
      for (var mo = 0; mo < 12 && restant > 1e-7 && (y - 1) * 12 + mo < moisCredit; mo++) {
        var it = restant * F.taux_pct / 1200, paie = Math.min(mens, restant + it), cap = paie - it;
        intY += it; capitalY += cap; paiementsY += paie; restant = Math.max(0, restant - cap); moisY++;
      }
      var assurY = assurance * moisY / 12;
      var amortY = dotation((prixAchat + notaire) * F.part_bati_pct / 100, F.amort_bien_ans, y) + dotation(travaux + F.travaux_copro_eur, F.amort_travaux_ans, y) + dotation(meubles, F.amort_meubles_ans, y);
      // Réserve non dépensée réintégrée. Frais initiaux déduits en année 1 : hypothèse fiscale à valider.
      var fiscalAvantAmort = netAvantCredit + reserve - intY - assurY - (y === 1 ? dossier + garantie + F.frais_creation_eur + F.frais_lancement_eur : 0);
      // Résultat de la société entière (autres activités + ce bien) ; l'IS du bien = IS total − IS déjà dû.
      // Négatif = économie d'IS pour la société.
      var resSans = benefAutre + fiscalAvantAmort + reportSans, resAvec = benefAutre + fiscalAvantAmort - amortY + reportAvec;
      var isSans = isDe(resSans) - isAutre, isAvec = isDe(resAvec) - isAutre;
      reportSans = Math.min(0, resSans); reportAvec = Math.min(0, resAvec); cumulSans += isSans; cumulAvec += isAvec; if (isAvec <= 0) anneesSansIS++;
      var ligne = { annee: y, interets: intY, capital_rembourse: capitalY, echeances: paiementsY, assurance: assurY, amortissements: amortY,
        resultat_fiscal: fiscalAvantAmort - amortY, is_societe_total: isAvec + isAutre, deficit_reportable: -reportAvec, is: isAvec, is_sans_amortissement: isSans, capital_restant: restant,
        cash_flow_apres_is: netAvantCredit - paiementsY - assurY - isAvec };
      echeancier.push(ligne); if (y === 1) an1 = ligne;
    }
    var statutJuridique = c.statut_juridique || bien.statut_juridique || 'a_verifier';
    if (['confirme', 'a_verifier', 'incompatible'].indexOf(statutJuridique) < 0) statutJuridique = 'a_verifier';
    var dpe = String(bien.dpe || '').trim().toUpperCase();
    if (dpe === 'F' || dpe === 'G') { if (statutJuridique !== 'incompatible') statutJuridique = 'a_verifier'; raisons.push('DPE ' + dpe + ' : vérifier changement d’usage et rénovation ; le budget ne garantit pas une nouvelle étiquette'); }
    else if (dpe === 'E') raisons.push('DPE E : budgéter la conformité énergétique à l’échéance 2034');
    else if (!/^[A-D]$/.test(dpe)) { if (statutJuridique === 'confirme') statutJuridique = 'a_verifier'; raisons.push('DPE valide à vérifier'); }
    if (statutJuridique !== 'confirme') raisons.push('Faisabilité juridique ' + (statutJuridique === 'incompatible' ? 'incompatible' : 'à vérifier : copropriété et règles locales pour la société'));
    var etoilesBrutes = etoilesDepuis(rendement, R.paliers), etoiles = Math.max(1, Math.min(5, Math.round(etoilesBrutes * 2) / 2)), statut = 'ok';
    if ((bien.exclusions || []).length || statutJuridique === 'incompatible') { statut = 'exclu'; etoiles = 0; raisons.push('Exclu : ' + ((bien.exclusions || []).join(', ') || 'incompatibilité juridique')); }
    else if (netAvantCredit < 0) { statut = 'rejet'; etoiles = 0; raisons.push('Exploitation déficitaire après entretien et réserve, avant crédit'); }
    if (!dist) raisons.push('Distance mer inconnue : effet neutre, emplacement à confirmer');
    if (!bien.niveau_travaux && !present(c.travaux_eur)) raisons.push('État inconnu : provision de travaux légers, devis nécessaire');
    if (!surface) raisons.push('Surface absente : budget travaux non estimable');
    if (R._paliers_migres) raisons.push('Ancien barème mensuel remplacé par le barème de rendement');
    if (!bien.extraction_version) raisons.push('Extraction ancienne : réextraire les annonces brutes pour fiabiliser les équipements');
    var reserveInitiale = F.reserve_tresorerie_mois * (charges + mens + assurance / 12);
    var dscr = an1.echeances + an1.assurance > 0 ? netAvantCredit / (an1.echeances + an1.assurance) : null;
    var r0 = function (x) { return x === null ? null : Math.round(x); };
    return {
      version: VERSION, statut: statut, statut_juridique: statutJuridique, etoiles: etoiles, raisons: raisons,
      score_metrique: 'rendement_exploitation_hors_financement', etoiles_non_arrondies: etoilesBrutes,
      eligible_alerte: statut === 'ok' && statutJuridique === 'confirme' && !!surface && crlApplicable !== null && !!bien.extraction_version &&
        !!dist && !!bien.niveau_travaux && ['parking', 'terrasse', 'clim', 'vue_mer'].every(function (k) { return tri(bien[k]) !== null; }),
      hypotheses: { type: type, distance_mer: dist, niveau_travaux: niv, etat_apres_travaux: etatApres || null, adr: adr, occ_pct: occ,
        jours_ouverts_an: F.jours_ouverts_an, nuits_louees: nuits, charges_mois: charges, charges_hors_copro_mois: horsCopro, copro_mois: copro,
        copro_source: present(c.copro_mois) ? 'curseur' : coproAnn ? 'annonce' : 'defaut', travaux_eur: travaux, meubles_eur: meubles,
        apport_pct: F.apport_pct, taux_pct: F.taux_pct, duree_ans: F.duree_ans, nego_pct: nego, prix_achat: prixAchat, frais_gestion_pct: gestionPct,
        crl_applicable: crlApplicable, crl_pct: F.crl_pct, menage_cout_sejour: F.menage_cout_sejour, menage_facture_sejour: prixMenage,
        entretien_courant_pct: F.entretien_courant_pct, reserve_renouvellement_pct: F.reserve_renouvellement_pct,
        frais_dossier_eur: dossier, garantie_eur: garantie, frais_creation_eur: F.frais_creation_eur, frais_lancement_eur: F.frais_lancement_eur,
        travaux_copro_eur: F.travaux_copro_eur, assurance_emprunteur_pct: F.assurance_emprunteur_pct, is_taux_reduit_eligible: eligibleReduit },
      revenus_bruts_an: r0(brut), frais_gestion_an: r0(gestion), revenus_nets_an: r0(revenusNets), plateforme_an: r0(plateforme), conciergerie_an: r0(conciergerie),
      recettes_menage_an: r0(recettesMenage), cout_menage_an: r0(coutMenage), plateforme_menage_an: r0(fraisMenage), marge_menage_an: r0(margeMenage),
      charges_fixes_an: r0(charges * 12), crl_an: r0(crl), entretien_courant_an: r0(entretien), reserve_renouvellement_an: r0(reserve),
      net_avant_credit_an: r0(netAvantCredit), cout_total: r0(coutTotal), cout_hors_financement: r0(coutHorsFinancement), notaire_eur: r0(notaire),
      frais_financement_eur: r0(dossier + garantie), apport: r0(apport), emprunt: r0(emprunt), tresorerie_initiale: r0(reserveInitiale), fonds_propres_initiaux: r0(apport + reserveInitiale),
      mensualite: r0(mens), mensualite_assurance_comprise: r0(mens + assurance / 12), assurance_emprunteur_an: r0(assurance), interets_an1: r0(an1.interets), capital_rembourse_an1: r0(an1.capital_rembourse),
      effort_treso_mois: r0(an1.cash_flow_apres_is / 12), cash_flow_apres_is_an: r0(an1.cash_flow_apres_is), effort_treso_avant_is_mois: r0((an1.cash_flow_apres_is + an1.is) / 12),
      effort_hors_capital_mois: r0((netAvantCredit - an1.interets - an1.assurance - an1.is) / 12),
      rendement_net_pct: Math.round(rendement * 100) / 100, rendement_net_cout_total_pct: Math.round(netAvantCredit / coutTotal * 10000) / 100,
      couverture_dette: dscr === null ? null : Math.round(dscr * 100) / 100, benefice_an1_hors_credit: r0(netAvantCredit),
      amortissements_an1: r0(an1.amortissements), resultat_fiscal_an1: r0(an1.resultat_fiscal), is_du_an1: r0(an1.is), gain_is_horizon: r0(cumulSans - cumulAvec),
      is_du_horizon: r0(cumulAvec), annees_sans_is: anneesSansIS,
      is_autre_eur: r0(isAutre), benefice_autre_eur: r0(benefAutre), is_societe_an1: r0(an1.is_societe_total),
      economie_is_societe_an1: r0(Math.max(0, -an1.is)), economie_is_societe_horizon: r0(Math.max(0, -cumulAvec)),
      amortissement_bien_an: r0((prixAchat + notaire) * F.part_bati_pct / 100 / F.amort_bien_ans), horizon_is_ans: F.horizon_is_ans,
      benefice_net_an1_hors_capital: r0(netAvantCredit - an1.interets - an1.assurance - an1.is), echeancier_annuel: echeancier,
      limites_modele: ['Année stabilisée : lancement et saisonnalité non simulés', 'IS simplifié ; déduction des frais initiaux et amortissements à valider',
        'Fiscalité de revente et distribution non simulée ; économie IS hors sortie']
    };
  }
  var api = { VERSION: VERSION, DEFAUTS: DEFAUTS, extraire: extraire, calculer: calculer, typeDepuis: typeDepuis, normaliserReglages: normaliserReglages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DealScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
