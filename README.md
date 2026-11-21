# Deal

Outil personnel de chasse aux biens immobiliers à rentabiliser en location saisonnière (Golfe-Juan pour commencer). C'est une application web installable (PWA), qui marche hors ligne. Les annonces sont collectées et notées chaque matin par n8n ; l'app affiche **tous** les biens, notés de 1 à 5 étoiles, avec une fiche par bien et un simulateur à curseurs.

Ce dépôt ne contient que le code de l'application : aucune donnée, aucun secret. Tout passe par le serveur n8n après connexion.

## Les 3 versions

| Version | Où | Rôle | Icône |
|---|---|---|---|
| **LOCAL** | `http://localhost:8080` sur le PC | Développer et tester à chaud | balise LOCAL |
| **TEST** | `https://xtrmit.github.io/deal-test/` | Valider sur le téléphone | orange, « Deal T » |
| **PROD** | `https://xtrmit.github.io/deal/` | Usage réel | bleu lagon, « Deal » |

Workflows n8n séparés : `/webhook/deal-test/api` pour TEST et LOCAL, `/webhook/deal/api` pour PROD.

## Mise en route (une seule fois)

```powershell
cd F:\DEAL
.\tools\setup-github.ps1
```

Crée les dépôts publics `deal-test` et `deal` (code uniquement).

## Cycle de travail

1. **Tester sur le PC** : `.\tools\serve.ps1` (Chrome s'ouvre sur LOCAL).
2. **Envoyer en TEST** : `.\tools\deploy.ps1 test`.
3. **Valider sur le téléphone** avec l'app « Deal T » (orange).
4. **Publier en PROD** : `.\tools\deploy.ps1 prod`, puis taper `OUI`. Seul le code déjà passé par TEST est accepté.

## Connexion

- **Ordinateur** : identifiant + mot de passe → session de 30 jours.
- **Téléphone** : sur l'ordinateur, Réglages → « Ajouter un téléphone » affiche un QR code (valable 10 min, usage unique). Le scanner avec l'appareil photo ouvre Deal et appaire le téléphone.
- Chaque appareil est révocable depuis Réglages → Appareils.

## La formule (une seule)

`js/scoring.js` est **la** formule : la PWA l'utilise pour les curseurs (recalcul instantané) et le workflow d'ingestion n8n l'exécute pour les étoiles de référence et la détection des nouveaux biens 5 étoiles. Toute modification → incrémenter `VERSION` dans ce fichier, déployer, puis mettre à jour le workflow d'ingestion.

## Fichiers

```
index.html                 page de l'app
css/app.css                styles (Lagon, clair / sombre, 3 tailles de texte)
js/scoring.js              LA formule (partagée avec n8n)
js/sync.js                 synchronisation n8n + IndexedDB + file d'attente hors ligne
js/app.js                  socle : connexion, feuilles, mises à jour, calcul d'un bien, indice de fatigue
js/liste.js                liste notée, filtres, nouveautés depuis la dernière visite
js/fiche.js                fiche bien : photos, simulateur, caractéristiques, suivi
js/reglages.js             financement, benchmarks, critères (garde-fou budget), appareils, QR
js/qr.js                   générateur de QR code (repris de Tribu)
version.js                 numéro de version (déclenche les mises à jour)
sw.js                      service worker : hors ligne, mise à jour
manifest*.webmanifest      fiches d'installation (PROD / TEST)
fonts/, icons/, tools/
```

## Scoring 2.0 / PWA 0.3.0

Le moteur reste autonome, sans réseau ni dépendance. Les exports CommonJS et
`globalThis.DealScoring`, les signatures `extraire(raw)` et `calculer(bien, reglages, curseurs)`,
les champs historiques et les statuts `ok/rejet/exclu` sont conservés.
Le sens de la note et de certaines métriques change volontairement :

- Équipements : `true` = présent, `false` = explicitement absent, `null` = inconnu ou contradictoire.
  `preuves`, `conflits`, `inconnus` et `extraction_version` accompagnent la nouvelle extraction.
  Un inconnu n'applique aucun coefficient ADR. La distance exige une indication explicite
  vers la mer/plage ; le temps en voiture et la proximité du port ne suffisent pas.
- Type : pièces explicites prioritaires, surface seulement en repli.
- Rendement : `100 × net_avant_credit_an / cout_hors_financement`, calculé sans arrondis intermédiaires.
  Le solde inclut gestion, charges fixes, CRL, entretien et réserve de remplacement.
  L'investissement comprend achat, acquisition, travaux avec aléas, meubles et autres frais initiaux,
  mais exclut les seuls frais de financement pour garder une note indépendante de l'apport et du crédit.
  Barème : 0/2/4/6/8 % → 1/2/3/4/5 étoiles, interpolation et arrondi à la demi-étoile.
  `rendement_net_pct` porte ce rendement ; `rendement_net_cout_total_pct` inclut aussi les frais bancaires.
- `effort_treso_mois` = cash-flow après échéances, assurance et IS, réserve de remplacement déduite.
  `effort_hors_capital_mois` conserve un solde hors remboursement du capital, après assurance et IS ;
  il ne détermine plus les étoiles. Ce n'est ni un TRI ni une rentabilité après revente.
- Coût complet : frais de dossier et garantie financés, assurance emprunteur, meubles,
  entretien, réserve et CRL. La réserve initiale de trésorerie est affichée séparément et ajoutée
  à `fonds_propres_initiaux`, pas comptée une seconde fois dans le coût du projet.
- `statut_juridique` : `a_verifier`, `confirme`, `incompatible`. Un DPE F/G ne plafonne plus
  artificiellement les étoiles mais empêche l'éligibilité aux alertes. Des travaux budgétés ne prouvent
  pas une amélioration du DPE. `incompatible` exclut le bien. Les autorisations locales restent à établir.

### Hypothèses par défaut (budgets de simulation, pas devis ni mesures de marché)

| Paramètre | Studio | T2 | T3 | T4 |
|---|---:|---:|---:|---:|
| `benchmarks.*.adr` | 85 | 100 | 130 | 165 |
| `benchmarks.*.occ` | 50 | 52 | 48 | 45 |
| `benchmarks.*.charges` hors copro / mois | 310 | 357,50 | 406,67 | 460 |
| `benchmarks.*.copro` / mois | 90 | 110 | 140 | 170 |
| `benchmarks.*.meubles` | 5 000 | 7 000 | 10 000 | 13 000 |

| Paramètre | Valeur |
|---|---|
| `travaux_m2` aucun/léger/moyen/lourd/structurel | 0 / 400 / 800 / 1 300 / 2 000 |
| `fin.aleas_travaux_pct` | 15 % ; le curseur `travaux_eur` est déjà un TOTAL avec aléas |
| `fin.jours_ouverts_an`, `fin.vacance_imprevue_pct` | 350 jours, 0 % supplémentaire |
| `fin.plateforme_pct`, `fin.conciergerie_pct` | 15,5 % puis 20 % après plateforme : 32,4 % effectifs |
| `fin.entretien_courant_pct`, `fin.reserve_renouvellement_pct` | 2 % et 3 % du loyer brut |
| `fin.frais_dossier_eur`, `fin.garantie_pct_emprunt` | 1 000 € et 1,5 % du capital financé |
| `fin.assurance_emprunteur_pct` | 0,30 % du capital initial par an, jusqu'à remboursement |
| `fin.crl_pct`, `fin.crl_applicable` | 2,5 %, `null` : provision prudente à vérifier ; `false` retire la CRL |
| `fin.reserve_tresorerie_mois` | 6 mois de charges fixes et de service de la dette |
| `fin.frais_creation_eur`, `fin.frais_lancement_eur`, `fin.travaux_copro_eur` | 0 à remplacer par des devis / appels de fonds ; coût inconnu, pas réputé absent |
| `fin.menage_cout_sejour`, `fin.menage_facture_sejour` | 0 / `null` : neutralité supposée ; avec coût renseigné, refacturation par défaut majorée de la commission plateforme |

Le ménage doit être paramétré selon le contrat. La commission conciergerie est supposée hors ménage.
L'assiette CRL est le loyer hors ménage par défaut ; `crl_assiette_eur` permet de la remplacer.
Les charges fixes agrégées doivent être remplacées par les montants du bien, sans doubler les coûts
d'entretien déjà provisionnés séparément. Les coefficients ADR cumulés sont bornés à 0,80–1,20 ;
aucun coefficient d'équipement ne s'applique à l'occupation.

### Fiscalité : limites explicites

IS annuel avec report des déficits et arrêt des intérêts / assurances à maturité. Réserve non dépensée
réintégrée au résultat fiscal. Amortissement immobilier indicatif : 70 % de l'achat et acquisition / 30 ans ;
travaux / 10 ans ; meubles / 7 ans. Frais de financement, création et lancement déduits en année 1 :
option et traitement comptable à valider. Le taux réduit suppose `is_taux_reduit_eligible: true` ;
mettre `false` si la société n'est pas éligible. Les déficits initiaux sont supposés nuls.
`gain_is_horizon` mesure seulement un écart d'IS pendant la détention, sans valeur actuelle,
sans fiscalité de revente ni de distribution. Lancement, inflation, renouvellements détaillés,
TVA para-hôtelière et résultat d'autres biens de la société ne sont pas simulés.

Références des avertissements : [CRL, Service public](https://entreprendre.service-public.gouv.fr/vosdroits/F32939),
[DPE et changement d'usage, Service public](https://www.service-public.gouv.fr/particuliers/vosdroits/F2043),
[guide ministériel des meublés de tourisme](https://www.ecologie.gouv.fr/sites/default/files/documents/25113_GuidePratique2025MeubleTourisme.pdf).

### Migration PWA / n8n (v2 du moteur, PWA 0.4.0)

1. `deploy.ps1 test` publie la PWA **et** le moteur : l'ingestion n8n TEST télécharge `js/scoring.js` depuis
   GitHub Pages à chaque run (aucune copie à mettre à jour dans n8n). En PROD, l'URL sera celle du site PROD.
2. L'ingestion réextrait chaque annonce du scrape à chaque run : les trois états (présent / absent / inconnu)
   s'appliquent dès le run suivant. Les annonces déjà retirées gardent leur ancienne extraction.
3. Réglages TEST passés aux valeurs v2 le 22/11/2026, sauf le T2 qui garde les chiffres réels de Romain
   (ADR 115 €, occupation 54 %, charges hors copro 343 €/mois). Le bouton « Remplacer les réglages globaux
   par les valeurs v2 » remettrait le T2 à 100 € / 52 % : ne pas l'utiliser sans raison.
4. `fin.is_autre_eur` (Réglages → « IS que ta société paie déjà ») : la perte fiscale du bien s'impute sur le
   bénéfice de la société la même année ; l'économie d'IS entre dans le cash-flow.
5. La bannière « nouveaux biens 5 étoiles » ne dépend pas de la faisabilité juridique (« à vérifier » par défaut
   pour tous les biens) ; exclus et rejets n'y figurent pas.

### Vérification

```powershell
node --test tools/*.test.cjs
```

Les tests couvrent extraction, migration, non-mutation, financement, IS, A/B, rendu / interactions PWA
et exécution du moteur dans un Code node n8n simulé. Ils n'exécutent aucun workflow distant.

| Défauts v2, sans négociation | A | B |
|---|---:|---:|
| ADR / occupation des 350 nuits ouvertes | 117,325 € / 48 % | 100 € / 52 % |
| Loyer brut annuel | 19 711 € | 18 200 € |
| Solde exploitation annuel | 5 286 € | 5 412 € |
| Travaux avec 15 % d'aléas | 25 760 € | 37 260 € |
| Meubles | 10 000 € | 7 000 € |
| Investissement hors financement | 276 600 € | 233 260 € |
| Coût complet avec dossier et garantie | 281 148 € | 237 294 € |
| Emprunt (apport 20 % du prix) | 236 548 € | 202 294 € |
| Rendement du score / sur coût complet | 1,91 % / 1,88 % | 2,32 % / 2,28 % |
| Étoiles financières | 2 | 2 |
| IS année 1 | 0 € | 0 € |
| Cash-flow mensuel après IS et assurance | −1 368 € | −1 096 € |

A : parking et terrasse absents, climatisation présente, vue mer / distance / état inconnus.
B : équipements et distance inconnus, travaux moyens demandés, copro 1 236 €/an. La vue mer inconnue
est neutre pour les deux. État « bon après travaux » supposé avec un programme financé ; un budget
insuffisant conserve l'état actuel. Pour B, le coût du passage du DPE F à une classe admissible reste à établir.
Les deux cas sont « à vérifier » juridiquement et ne sont pas éligibles aux alertes automatiques.
