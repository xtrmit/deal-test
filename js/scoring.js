/* Deal App — scoring.js
 * UNE seule formule, exécutée par la PWA (curseurs) ET par n8n (ingestion).
 * Aucun secret ici. Toute modification => incrémenter VERSION.
 */
(function (root) {
  'use strict';
  var VERSION = '1.1.1';

  /* ---------- Réglages par défaut (= Google Sheet migrée) ---------- */
  var DEFAUTS = {
    benchmarks: {
      // charges = charges fixes hors copro (€/mois) ; copro = copro par défaut (€/mois) si l'annonce ne la donne pas
      studio: { smin: 0,  smax: 29,  adr: 78,  occ: 50, net: 62, charges: 290, copro: 90 },
      t2:     { smin: 30, smax: 44,  adr: 115, occ: 54, net: 62, charges: 343, copro: 110 },
      t3:     { smin: 45, smax: 66,  adr: 132, occ: 45, net: 62, charges: 460, copro: 140 },
      t4:     { smin: 67, smax: 999, adr: 165, occ: 40, net: 62, charges: 550, copro: 170 }
    },
    ajustements: {
      distance_mer: { '0-3': [1, 1], '3-7': [0.93, 0.96], '7-12': [0.86, 0.91], '12+': [0.78, 0.84] },
      parking:      { oui: [1, 1], non: [0.95, 0.98] },
      vue_mer:      { non: [1, 1], oui: [1.15, 1.04] },
      terrasse:     { oui: [1, 1], non: [0.93, 0.98] },
      clim:         { oui: [1, 1], non: [0.96, 0.95] },
      etat:         { bon: [1, 1], refait_neuf: [1.08, 1.03], a_rafraichir: [0.93, 0.96] }
    },
    travaux_m2: { aucun: 0, leger: 300, moyen: 600, lourd: 1100, structurel: 1800 },
    fin: {
      apport_pct: 20, taux_pct: 4, duree_ans: 15, notaire_pct: 8,
      amort_bien_ans: 30, part_bati_pct: 70, amort_travaux_ans: 10, amort_meubles_ans: 7,
      is_bas_pct: 15, is_haut_pct: 25, is_seuil_eur: 42500, horizon_is_ans: 10, copro_min_fiable_an: 300,
      vacance_imprevue_pct: 5, occ_max_pct: 85
    },
    // Effort réel hors capital (€/mois) -> étoiles (interpolation linéaire)
    paliers: [[-700, 1], [-450, 2], [-250, 3], [-100, 4], [50, 5]],
    defauts_commune: { distance_mer: '7-12' }
  };

  var RANG = ['studio', 't2', 't3', 't4'];

  /* ---------- Extraction (serveur, à l'ingestion) ---------- */
  var EXCLUSIONS = [
    [/viager/i, 'viager'],
    [/vente\s+[aà]\s+terme/i, 'vente à terme'],
    [/nue[- ]propri[ée]t[ée]|usufruit/i, 'nue-propriété / usufruit'],
    [/sous\s+(offre|compromis)/i, 'sous offre / compromis'],
    [/(bien|appartement|logement)\s+(vendu\s+)?(lou[ée]|occup[ée])|vendu\s+lou[ée]|locataire\s+en\s+place|bail\s+en\s+cours|vendeur\s+occupant|occup[ée]\s+par/i, 'bien occupé'],
    [/local\s+commercial|fonds\s+de\s+commerce|murs\s+commerciaux|\bbureaux?\b\s+(à|a)\s+vendre/i, 'non résidentiel'],
    [/r[ée]sidence\s+(services|senior|g[ée]r[ée]e|de\s+tourisme)|bail\s+commercial/i, 'résidence gérée']
  ];

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function num(s) { var n = parseFloat(String(s == null ? '' : s).replace(/[^\d.,-]/g, '').replace(',', '.')); return isFinite(n) ? n : null; }

  function typeDepuis(surface, pieces) {
    var bySurf = surface == null ? null : (surface < 30 ? 0 : surface < 45 ? 1 : surface < 67 ? 2 : 3);
    var byRooms = pieces == null ? null : Math.min(Math.max(pieces, 1), 4) - 1;
    var r = bySurf == null ? byRooms : byRooms == null ? bySurf : Math.min(bySurf, byRooms);
    return RANG[r == null ? 1 : r];
  }

  // raw = item Apify memo23 ; renvoie les caractéristiques physiques (cachables)
  function extraire(raw) {
    var a = raw.attributes || {};
    var texte = (raw.title || '') + ' \n ' + (raw.description || '');
    var t = norm(texte);
    var surface = num(a.square);
    var pieces = num(a.rooms);
    var exclusions = [];
    EXCLUSIONS.forEach(function (e) { if (e[0].test(texte)) exclusions.push(e[1]); });
    var rtype = norm(a.real_estate_type);
    if (rtype && rtype.indexOf('appartement') < 0 && rtype.indexOf('maison') < 0) exclusions.push('type: ' + a.real_estate_type);

    // distance mer : texte uniquement (le GPS LeBonCoin est souvent celui de la commune)
    var dist = null, m;
    if (/pieds dans l.eau|front de mer|bord de mer|face (a la )?mer/.test(t)) dist = '0-3';
    else if ((m = t.match(/(\d{1,4})\s*(m|metres?)\s+(de la |des |de |du )?(mer|plages?|port|bord de mer)/))) {
      var d = +m[1]; dist = d <= 250 ? '0-3' : d <= 550 ? '3-7' : d <= 1000 ? '7-12' : '12+';
    } else if ((m = t.match(/(\d{1,2})\s*(min|minutes?|mn)\s*(a pied\s*)?(de la |des |de |du )?(mer|plages?|port|bord de mer)/))) {
      var mn = +m[1]; dist = mn <= 3 ? '0-3' : mn <= 7 ? '3-7' : mn <= 12 ? '7-12' : '12+';
    } else if (/proche (de la )?(mer|plages?)|a deux pas (de la )?(mer|plage)|proximite (immediate )?(de la )?(mer|plages?)/.test(t)) dist = '3-7';

    var vueMer = /vue (sur (la )?)?mer|vue mer|vue degagee sur la mer|vue panoramique sur la mer/.test(t) && !/sans vue mer|pas de vue mer/.test(t);
    var ext = norm(a.outside_access);
    var terrasse = /terrasse|jardin/.test(ext) || /terrasse|jardin/.test(t);
    var parking = (num(a.nb_parkings) || 0) > 0 || /parking|garage/.test(norm(a.specificities)) || /parking|garage|place de stationnement/.test(t);
    var clim = /climatis|\bclim\b|reversible/.test(t);

    var gc = norm(a.global_condition);
    var etat = null, niveau = null;
    if (/neuf|refait/.test(gc)) { etat = 'refait_neuf'; niveau = 'aucun'; }
    else if (/bon/.test(gc)) { etat = 'bon'; niveau = 'aucun'; }
    else if (/rafraichir/.test(gc)) { etat = 'a_rafraichir'; niveau = 'leger'; }
    else if (/travaux|renover/.test(gc)) { etat = 'a_rafraichir'; niveau = 'moyen'; }
    if (/renover entierement|renover totalement|a renover entierement|entierement a renover|gros travaux|a rehabiliter|plateau a amenager/.test(t)) { etat = 'a_rafraichir'; niveau = 'lourd'; }
    else if (!niveau && /renove|refait a neuf|refait neuf|entierement refait|neuf/.test(t)) { etat = 'refait_neuf'; niveau = 'aucun'; }
    else if (!niveau && /a rafraichir|travaux a prevoir|a renover|rafraichissement/.test(t)) { etat = 'a_rafraichir'; niveau = /a renover/.test(t) ? 'moyen' : 'leger'; }

    var inconnus = [];
    if (!dist) inconnus.push('distance_mer');
    if (!niveau) inconnus.push('etat');
    if (!a.energy_rate) inconnus.push('dpe');

    var imgs = (raw.images && raw.images.urls) || [];
    return {
      id: String(raw.adId || raw.listing_id || ''),
      url: raw.url || '',
      titre: raw.title || '',
      prix: num(raw.price),
      ancien_prix: num(a.old_price),
      surface: surface,
      pieces: pieces,
      type: typeDepuis(surface, pieces),
      dpe: (a.energy_rate || '').toUpperCase() || null,
      charges_copro_an: num(a.annual_charges),
      etage: a.floor_display || null,
      ascenseur: a.elevator === 'Oui',
      distance_mer: dist,
      vue_mer: vueMer,
      terrasse: terrasse,
      parking: parking,
      clim: clim,
      etat: etat,
      niveau_travaux: niveau,
      vendu_meuble: /vendu meuble|vente meublee|cede meuble|meuble et equipe|entierement meuble/.test(t),
      exclusions: exclusions,
      inconnus: inconnus,
      vendeur: (raw.seller && raw.seller.type) || null,
      publie_le: raw.firstPublishedAt || null,
      lat: raw.location ? raw.location.lat : null,
      lng: raw.location ? raw.location.lng : null,
      photos: imgs
    };
  }

  /* ---------- Calcul ---------- */
  function fusion(base, sur) {
    var o = {}; var k;
    for (k in base) o[k] = base[k];
    for (k in (sur || {})) if (sur[k] !== undefined && sur[k] !== null && sur[k] !== '') o[k] = sur[k];
    return o;
  }

  function mensualite(capital, tauxPct, ans) {
    if (capital <= 0) return 0;
    var r = tauxPct / 100 / 12, n = ans * 12;
    if (r === 0) return capital / n;
    return capital * r / (1 - Math.pow(1 + r, -n));
  }

  function interetsAnnee1(capital, tauxPct, mens) {
    var r = tauxPct / 100 / 12, restant = capital, tot = 0;
    for (var i = 0; i < 12 && restant > 0; i++) { var it = restant * r; tot += it; restant -= (mens - it); }
    return tot;
  }

  function etoilesDepuis(effort, paliers) {
    if (effort <= paliers[0][0]) return paliers[0][1];
    for (var i = 1; i < paliers.length; i++) {
      var p0 = paliers[i - 1], p1 = paliers[i];
      if (effort <= p1[0]) return p0[1] + (p1[1] - p0[1]) * (effort - p0[0]) / (p1[0] - p0[0]);
    }
    return paliers[paliers.length - 1][1];
  }

  /* bien = sortie de extraire() ; reglages = DEFAUTS fusionnés ;
   * curseurs = { apport_pct, taux_pct, duree_ans, travaux_eur, adr, occ_pct, charges_mois } (surcharges facultatives) */
  function calculer(bien, reglages, curseurs) {
    var R = reglages || DEFAUTS;
    var c = curseurs || {};
    var F = fusion(R.fin, { apport_pct: c.apport_pct, taux_pct: c.taux_pct, duree_ans: c.duree_ans });
    var B = R.benchmarks[bien.type];
    var A = R.ajustements;
    var raisons = [];

    // --- revenus ---
    var dist = bien.distance_mer || R.defauts_commune.distance_mer;
    var niv = bien.niveau_travaux || 'leger';
    var etatApres = (niv === 'moyen' || niv === 'lourd' || niv === 'structurel') ? 'bon' : (bien.etat || 'a_rafraichir');
    var mults = [A.distance_mer[dist], A.parking[bien.parking ? 'oui' : 'non'], A.vue_mer[bien.vue_mer ? 'oui' : 'non'],
                 A.terrasse[bien.terrasse ? 'oui' : 'non'], A.clim[bien.clim ? 'oui' : 'non'], A.etat[etatApres]];
    var mAdr = 1, mOcc = 1;
    mults.forEach(function (x) { if (x) { mAdr *= x[0]; mOcc *= x[1]; } });
    var adr = c.adr != null ? +c.adr : Math.round(B.adr * mAdr);
    var occ = c.occ_pct != null ? +c.occ_pct : Math.min(B.occ * mOcc, F.occ_max_pct);
    var brut = adr * 365 * occ / 100 * (1 - F.vacance_imprevue_pct / 100);
    var revenusNets = brut * B.net / 100;
    var coproAn = bien.charges_copro_an;
    var coproFiable = coproAn != null && coproAn >= F.copro_min_fiable_an;
    var copro = coproFiable ? coproAn / 12 : B.copro;
    if (coproAn != null && !coproFiable) raisons.push('Copro annoncée (' + coproAn + ' €/an) peu crédible : défaut utilisé');
    var chargesHorsCopro = c.charges_hors_copro_mois != null ? +c.charges_hors_copro_mois : B.charges;
    var coproRetenue = c.copro_mois != null ? +c.copro_mois : copro;
    var charges = c.charges_mois != null ? +c.charges_mois : chargesHorsCopro + coproRetenue;
    var netAvantCredit = revenusNets - charges * 12;          // indépendant du prix

    // --- projet & crédit ---
    var travaux = c.travaux_eur != null ? +c.travaux_eur : Math.round((R.travaux_m2[niv] || 0) * (bien.surface || 0) / 1000) * 1000;
    var notaire = bien.prix * F.notaire_pct / 100;
    var meubles = c.meubles_eur != null ? +c.meubles_eur : 0;   // budget meubles à part (0 par défaut)
    var coutTotal = bien.prix + notaire + travaux + meubles;
    var apport = bien.prix * F.apport_pct / 100;
    var emprunt = Math.max(coutTotal - apport, 0);
    var mens = mensualite(emprunt, F.taux_pct, F.duree_ans);
    var interets1 = interetsAnnee1(emprunt, F.taux_pct, mens);

    var effortTreso = netAvantCredit / 12 - mens;
    var effortHorsCapital = (netAvantCredit - interets1) / 12;

    // --- IS : année 1 + économie cumulée sur l'horizon (report des déficits) ---
    var isDe = function (base) {
      if (base <= 0) return 0;
      var b = Math.min(base, F.is_seuil_eur);
      return b * F.is_bas_pct / 100 + Math.max(base - F.is_seuil_eur, 0) * F.is_haut_pct / 100;
    };
    var amortBienAn = (bien.prix + notaire) * F.part_bati_pct / 100 / F.amort_bien_ans;
    var r = F.taux_pct / 100 / 12, restant = emprunt;
    var reportAvec = 0, reportSans = 0, cumulAvec = 0, cumulSans = 0, anneesSansIS = 0;
    var an1 = null;
    for (var y = 1; y <= F.horizon_is_ans; y++) {
      var intY = 0;
      for (var mo = 0; mo < 12 && restant > 0 && y <= F.duree_ans; mo++) { var iy = restant * r; intY += iy; restant -= (mens - iy); }
      var amortY = (y <= F.amort_bien_ans ? amortBienAn : 0) + (y <= F.amort_travaux_ans ? travaux / F.amort_travaux_ans : 0)
                 + (y <= F.amort_meubles_ans ? meubles / F.amort_meubles_ans : 0);
      var resSans = netAvantCredit - intY + reportSans;            // sans amortissement
      var resAvec = netAvantCredit - intY - amortY + reportAvec;   // avec amortissement
      var isSans = isDe(resSans), isAvec = isDe(resAvec);
      reportSans = Math.min(resSans, 0); reportAvec = Math.min(resAvec, 0);
      cumulSans += isSans; cumulAvec += isAvec;
      if (isAvec === 0) anneesSansIS++;
      if (y === 1) an1 = { amort: amortY, resultat: netAvantCredit - intY - amortY, is: isAvec };
    }
    var gainIS10 = cumulSans - cumulAvec;

    // --- étoiles ---
    var etoiles, statut = 'ok';
    if (bien.exclusions && bien.exclusions.length) { statut = 'exclu'; etoiles = 0; raisons.push('Exclu : ' + bien.exclusions.join(', ')); }
    else if (netAvantCredit < 0) { statut = 'rejet'; etoiles = 0; raisons.push('Ne couvre pas ses charges : aucun apport ni négociation ne le sauve'); }
    else {
      etoiles = etoilesDepuis(effortHorsCapital, R.paliers);
      if (bien.dpe === 'F' || bien.dpe === 'G') { etoiles = Math.min(etoiles, 1); raisons.push('DPE ' + bien.dpe + ' : meublé de tourisme interdit (loi Le Meur) sans rénovation'); }
      else if (bien.dpe === 'E') { etoiles -= 0.5; raisons.push('DPE E : D exigé dès 2034'); }
      etoiles = Math.max(1, Math.min(5, Math.round(etoiles * 2) / 2));
    }
    if (!bien.distance_mer) raisons.push('Distance mer inconnue : défaut ' + dist);
    if (!bien.niveau_travaux) raisons.push('État inconnu : travaux légers supposés');

    var r0 = function (x) { return Math.round(x); };
    return {
      version: VERSION, statut: statut, etoiles: etoiles, raisons: raisons,
      hypotheses: { type: bien.type, distance_mer: dist, niveau_travaux: niv, adr: adr, occ_pct: Math.round(occ * 10) / 10,
                    charges_mois: Math.round(charges), charges_hors_copro_mois: chargesHorsCopro, copro_mois: Math.round(coproRetenue), copro_source: c.copro_mois != null ? 'curseur' : coproFiable ? 'annonce' : 'defaut', travaux_eur: travaux, meubles_eur: meubles,
                    apport_pct: F.apport_pct, taux_pct: F.taux_pct, duree_ans: F.duree_ans },
      revenus_bruts_an: r0(brut), revenus_nets_an: r0(revenusNets), net_avant_credit_an: r0(netAvantCredit),
      cout_total: r0(coutTotal), apport: r0(apport), emprunt: r0(emprunt),
      mensualite: r0(mens), interets_an1: r0(interets1),
      effort_treso_mois: r0(effortTreso), effort_hors_capital_mois: r0(effortHorsCapital),
      rendement_net_pct: Math.round(netAvantCredit / coutTotal * 1000) / 10,
      benefice_an1_hors_credit: r0(netAvantCredit),
      amortissements_an1: r0(an1.amort), resultat_fiscal_an1: r0(an1.resultat), is_du_an1: r0(an1.is),
      gain_is_horizon: r0(gainIS10), is_du_horizon: r0(cumulAvec), annees_sans_is: anneesSansIS, horizon_is_ans: F.horizon_is_ans,
      benefice_net_an1_hors_capital: r0(netAvantCredit - interets1 - an1.is)
    };
  }

  var api = { VERSION: VERSION, DEFAUTS: DEFAUTS, extraire: extraire, calculer: calculer, typeDepuis: typeDepuis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DealScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
