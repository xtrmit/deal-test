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
