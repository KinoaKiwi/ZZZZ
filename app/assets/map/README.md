# Assets carte

Ce dossier accueille les ressources cartographiques locales :

- **styles MapLibre** (JSON) pour le rendu sombre / pixel-art de la carte ;
- éventuelles **tuiles / textures** pixel-art d'overlay (routes texturées, effets).

Par défaut, l'app charge un style distant via `MAP_STYLE_URL` (voir `.env`). Un style
local peut être placé ici (ex. `dark_style.json`) puis référencé à la place de l'URL
pour un rendu 100 % maîtrisé et hors-ligne.

Référence : https://maplibre.org/maplibre-style-spec/
