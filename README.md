# Onde

Une radio en streaming : un site public épuré pour écouter, et un studio privé pour
téléverser vos fichiers et piloter la grille.

```
http://localhost:3000          le site public
http://localhost:3000/studio   le studio (réservé au compte propriétaire)
```

## Démarrer

```bash
npm install
npm start          # ou : npm run dev  (rechargement automatique)
```

Ouvrez `http://localhost:3000`, cliquez sur **Se connecter → Créer un compte**.
**Le tout premier compte créé devient automatiquement le propriétaire** et reçoit
l'accès au studio ; tous les suivants sont de simples auditeurs.

Variables d'environnement (toutes facultatives) :

| Variable      | Effet                                                                    |
|---------------|--------------------------------------------------------------------------|
| `PORT`        | Port d'écoute (3000 par défaut)                                           |
| `ADMIN_EMAIL` | Cette adresse obtient le rôle studio à l'inscription, même si ce n'est pas le premier compte |
| `SEED_DEMO=0` | N'installe pas les 4 stations de démonstration au premier lancement       |

## Le site public

- **La grille** — l'index des stations, filtrable par genre, par type et par tri
  (récentes, mieux notées, plus écoutées, A→Z).
- **Deux types de stations** : *direct* (un flux Icecast/Shoutcast en http(s)) et
  *mixtape* (une suite de vos propres fichiers, dans l'ordre que vous fixez).
- **Le lecteur reste en bas de l'écran** et ne s'interrompt pas quand on change de
  page : c'est un seul élément audio pour toute l'application. Barre de
  progression, file de lecture, volume, raccourcis clavier (`espace` lecture/pause,
  `alt + ←/→` piste précédente/suivante), et intégration aux commandes média du
  système (écran verrouillé, casque).
- **Compte** — inscription, connexion, présentation, changement de mot de passe.
- **Notation** — une note de 1 à 5 par station, moyenne et répartition affichées ;
  recliquer sur sa propre note la retire.
- **Suivi** — la liste de vos stations, sur votre page de compte.
- **Playlists** — privées ou publiques, contenant des titres *et* des stations,
  réordonnables par glisser-déposer.
- **Historique** — vos dernières écoutes.
- Thème clair / sombre, suivant le système par défaut.

## Le studio

Accessible sur `/studio` avec le compte propriétaire. Quatre onglets :

- **Antenne** — écoutes, notes, comptes, espace disque, stations les plus écoutées.
- **Stations** — création et édition : nom, accroche, genre, description, pochette,
  source (URL de flux ou mixtape), mise en ligne ou brouillon. Pour une mixtape, le
  **programme** se compose depuis la bibliothèque et se réordonne au glisser-déposer.
- **Titres** — dépôt de fichiers (glisser-déposer ou sélection, 20 fichiers par
  envoi, 120 Mo par fichier, `mp3 flac wav ogg opus m4a aac webm`). Les tags
  ID3/Vorbis sont lus à l'import : titre, artiste, album, année, durée et pochette
  intégrée. Chaque titre reste modifiable et supprimable.
- **Auditeurs** — la liste des comptes, promotion au studio, suppression.

Une station en brouillon n'apparaît nulle part sur le site public tant qu'elle n'est
pas cochée « visible sur le site ».

## Comment c'est fait

Aucune étape de build, aucun framework front : du HTML, du CSS et des modules ES
servis tels quels.

```
server.js              montage Express, en-têtes de sécurité, repli SPA
src/db.js              schéma SQLite + stations de démonstration
src/auth.js            sessions en base, bcrypt, garde-fous de rôle
src/util.js            slugs, validation
src/routes/auth.js     inscription, connexion, profil
src/routes/stations.js grille, détail, notes, suivis, écoutes
src/routes/playlists.js playlists et leur contenu
src/routes/studio.js   téléversements et administration (rôle studio requis)
public/css/onde.css    la feuille de style commune
public/js/player.js    le lecteur audio persistant
public/js/app.js       le site public (routage + vues)
public/js/studio.js    le studio
data/                  base SQLite + fichiers téléversés (hors dépôt)
```

- **Base** : SQLite via `better-sqlite3`, en mode WAL, clés étrangères activées.
- **Sessions** : jeton aléatoire de 32 octets en base, cookie `httpOnly`,
  `sameSite=lax`, 30 jours ; le cookie passe en `secure` dès que la requête arrive
  en HTTPS. Mots de passe hachés en bcrypt (coût 12).
- **Fichiers** : renommés aléatoirement à l'écriture, servis par `express.static`,
  qui gère les requêtes `Range` — donc le déplacement dans un titre fonctionne.
- **En-têtes** : `Content-Security-Policy` stricte (`script-src 'self'`), `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`.

## À savoir avant de mettre en ligne

- Servez le site en HTTPS derrière un reverse proxy. Attention : une page en HTTPS
  ne peut pas lire un flux de radio en `http://` (contenu mixte bloqué par le
  navigateur) — préférez des URL de flux en `https://`.
- `data/` contient la base et tous les fichiers audio : c'est le seul dossier à
  sauvegarder.
- Les uploads ne sont pas ré-encodés : le fichier déposé est celui qui est diffusé.
- Ne diffusez que ce que vous avez le droit de diffuser. Les quatre stations
  installées au premier lancement sont des flux publics (SomaFM, Radio France)
  donnés en exemple ; supprimez-les depuis le studio.
