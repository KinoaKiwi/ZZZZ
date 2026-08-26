# Onde

Un site d'écoute de créations sonores : documentaires, fictions, carnets. Rien en
direct — tout est publié à l'avance et se réécoute quand on veut. Le site public
d'un côté, un studio privé pour déposer et publier de l'autre.

```
http://localhost:3000          le site public
http://localhost:3000/studio   le studio (réservé au compte propriétaire)
```

## Démarrer

```bash
npm install
npm start          # ou : npm run dev  (rechargement automatique)
```

Ouvrez `http://localhost:3000`, puis **Se connecter → Créer un compte**.
**Le tout premier compte créé devient le propriétaire** et reçoit l'accès au
studio ; tous les suivants sont de simples auditeurs. Le catalogue démarre vide :
déposez vos fichiers dans le studio, complétez la fiche, publiez.

Variables d'environnement (facultatives) :

| Variable      | Effet                                                                  |
|---------------|------------------------------------------------------------------------|
| `PORT`        | Port d'écoute (3000 par défaut)                                        |
| `ADMIN_EMAIL` | Cette adresse obtient le rôle studio à l'inscription, même si ce n'est pas le premier compte |

## Deux objets, c'est tout

- **Une pièce** — un fichier audio et sa fiche : titre, chapô, auteur·rices,
  description, générique, thèmes, illustration, durée. C'est l'unité d'écoute.
- **Une série** — un regroupement de pièces qui se suivent, dans un ordre choisi.
  Une pièce peut très bien vivre seule.

## Le site public

- **Le catalogue** — l'index des pièces, filtrable par thème, triable (récentes,
  mieux notées, plus écoutées, les plus courtes, les plus longues, A→Z), avec
  recherche plein texte sur les titres, les auteurs et les descriptions.
- **Reprendre l'écoute** — chaque pièce commencée est reprise à la seconde près.
  La position est enregistrée sur le compte (donc d'un appareil à l'autre), ou
  dans le navigateur pour qui n'est pas connecté. Le catalogue affiche la reprise
  sur les pièces entamées, et une section « Reprendre l'écoute » les rassemble.
- **Le lecteur reste en bas de l'écran** et ne s'interrompt pas quand on change de
  page. Retour et avance de 15 secondes, vitesse de lecture (1× à 2×), file
  d'attente, déplacement dans la pièce, raccourcis clavier (`espace`, `←`/`→` pour
  ±15 s, `j`/`l` pour ±30 s) et intégration aux commandes média du système.
- **Séries** — page de série avec sa présentation, ses épisodes numérotés, un
  bouton pour tout écouter à la suite et un bouton pour la suivre.
- **Comptes** — inscription, connexion, présentation, mot de passe.
- **Notation** — de 1 à 5 par pièce, moyenne et répartition affichées ; recliquer
  sur sa propre note la retire.
- **À écouter** — la pile de ce qu'on met de côté.
- **Playlists** — privées ou publiques ; on y ajoute une pièce, ou une série
  entière d'un coup, et on réordonne au glisser-déposer.
- **Réactions** — un fil de discussion sous chaque pièce, 1500 signes maximum,
  supprimable par son auteur. Chacun peut **signaler** une réaction ou une
  playlist publique (spam, haine, harcèlement, hors sujet, droits, autre) : le
  signalement part dans la file du studio.
- **Historique** des écoutes, thème clair / sombre, mise en page responsive.

## Le studio

Sur `/studio`, avec le compte propriétaire. Quatre onglets :

- **Antenne** — le tableau de bord.
  - Quatre chiffres en tête : écoutes sur 30 jours, auditeurs connectés, **temps
    réellement écouté** (les pièces terminées comptent en entier, les autres là où
    l'auditeur s'est arrêté) et **taux d'achèvement**.
  - Deux courbes sur 30 jours, écoutes par jour et nouvelles inscriptions, avec le
    pic étiqueté, une infobulle au survol et un repli « voir les chiffres » qui
    donne le tableau des valeurs.
  - Un bloc **À traiter** : brouillons en attente, signalements ouverts, pièces en
    ligne que personne n'a encore écoutées, comptes restreints.
  - Le catalogue en chiffres, les thèmes les plus écoutés, la répartition des
    notes, le classement des pièces (écoutes, part terminée, note) et les derniers
    inscrits.
- **Pièces** — dépôt par glisser-déposer (20 fichiers par envoi, 400 Mo par
  fichier, `mp3 flac wav ogg opus m4a aac webm`), avec une série de destination
  facultative. Les tags ID3/Vorbis sont lus à l'import : titre, auteur, durée et
  illustration intégrée. Chaque fichier arrive en **brouillon** ; l'éditeur pleine
  page permet de renseigner la fiche puis de publier. Aperçu audio à côté de
  chaque ligne.
- **Séries** — création, présentation, illustration, ordre des épisodes au
  glisser-déposer. Supprimer une série ne supprime pas ses pièces : elles
  redeviennent des pièces isolées.
- **Modération** — cinq vues :
  - **Signalements** : la file d'arbitrage. Chaque cas montre le motif, qui a
    signalé, et le contenu visé cité en clair. Les gestes sont sur place — masquer
    ou supprimer une réaction, retirer une playlist du public, suspendre un compte
    — puis *classer* ou *écarter*. Un signalement traité reste consultable et peut
    être rouvert.
  - **Réactions** : les cent dernières, avec leur nombre de signalements ;
    masquer, supprimer, ou suspendre l'auteur.
  - **Playlists publiques** : retirer du public sans toucher au contenu — la
    playlist reste intacte chez son auteur, elle sort simplement de la liste.
  - **Comptes** : les comptes signalés ou restreints, avec une note interne.
  - **Journal** : toutes les décisions prises, horodatées et attribuées.
- **Auditeurs** — la liste complète : rôle, état du compte, réactions, écoutes,
  playlists, suppression.

### Les trois états d'un compte

| État | Ce qu'il peut faire |
|------|---------------------|
| **actif** | tout |
| **suspendu** | écouter, reprendre, mettre de côté, garder ses playlists privées — mais plus publier de réaction, de note ni de playlist publique |
| **fermé** | ne peut plus se connecter ; ses sessions ouvertes sont coupées |

Une réaction masquée disparaît pour tout le monde **sauf pour son auteur**, qui la
voit barrée avec la mention « masqué par la modération » : la modération est
visible, jamais un piège silencieux.

Rien n'apparaît sur le site public tant que la case « en ligne » n'est pas cochée
— sur la pièce comme sur la série.

## Comment c'est fait

Aucune étape de build, aucun framework front : du HTML, du CSS et des modules ES
servis tels quels.

```
server.js               montage Express, en-têtes de sécurité, repli SPA
src/db.js               schéma SQLite (et purge des tables de l'ancien modèle)
src/auth.js             sessions en base, bcrypt, garde-fous de rôle
src/util.js             slugs, thèmes, validation
src/routes/auth.js      inscription, connexion, profil
src/routes/catalog.js   catalogue, séries, notes, signets, reprises, écoutes
src/routes/community.js réactions et signalements
src/routes/playlists.js playlists et leur contenu
src/routes/studio.js    dépôts et administration (rôle studio requis)
public/css/onde.css     la feuille de style commune
public/js/player.js     le lecteur persistant (reprise, vitesse, ±15 s)
public/js/chart.js      les graphiques du studio, en HTML
public/js/app.js        le site public (routage + vues)
public/js/studio.js     le studio
data/                   base SQLite + fichiers déposés (hors dépôt)
```

- **Base** : SQLite via `better-sqlite3`, mode WAL, clés étrangères activées.
- **Sessions** : jeton aléatoire de 32 octets en base, cookie `httpOnly`,
  `sameSite=lax`, 30 jours ; le cookie passe en `secure` dès que la requête arrive
  en HTTPS. Mots de passe hachés en bcrypt (coût 12).
- **Fichiers** : renommés aléatoirement à l'écriture, servis par `express.static`,
  qui gère les requêtes `Range` — le déplacement dans une pièce fonctionne donc
  aussi pour un fichier de 300 Mo.
- **En-têtes** : `Content-Security-Policy` stricte (`script-src 'self'`),
  `nosniff`, `X-Frame-Options`, `Referrer-Policy`.
- **Permaliens** : l'adresse d'une pièce suit son titre tant qu'elle est en
  brouillon, puis se fige à la publication.
- **Graphiques** : dessinés en HTML et CSS, sans librairie — ils se recomposent
  avec la page et leur typographie ne se déforme pas. Une seule teinte porte la
  donnée, seul le pic est étiqueté, le reste est au survol, et chaque courbe est
  doublée d'un tableau de valeurs.
- **Modération** : chaque geste écrit une ligne dans `mod_actions`, avec son
  auteur et sa cible. Signaler deux fois le même élément est refusé, et les
  publications sont limitées en fréquence par compte.

## À savoir avant de mettre en ligne

- Servez le site en HTTPS derrière un reverse proxy.
- `data/` contient la base et tous les fichiers audio : c'est le seul dossier à
  sauvegarder.
- Les fichiers déposés ne sont pas ré-encodés : ce que vous déposez est ce qui est
  diffusé. Un MP3 128 kbps mono suffit largement pour de la parole et divise le
  poids par cinq.
- Ne publiez que ce que vous avez le droit de publier — musiques d'illustration et
  archives sonores comprises.
