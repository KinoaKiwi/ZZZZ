# Game Design — Gayeulle Party

Ce document décrit les règles de jeu, l'économie virtuelle et les mécaniques de Contest, avec
un souci d'**équilibrage** et de **non pay-to-win**.

---

## 1. Boucle de jeu principale

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
  Je pars marcher ──► session GPS ──► tracé coloré ────┤
        │                                │             │
        │                                ▼             │
        │                         zone révélée         │
        │                    (perce le brouillard)     │
        ▼                                │             │
  missions du jour ◄─────────────────────┘             │
        │                                              │
        ▼                                              │
  Djadja Coins ──► boutique (cosmétique) ──────────────┘
        │
        ▼
  compagnon · campements · chat · photos · événements
```

Chaque balade produit : de l'**exploration** (carte qui grandit), du **souvenir** (photos,
POI), de la **progression** (missions, coins), et du **lien social** (chat, positions, camps).

## 2. La carte commune & le brouillard

- La carte démarre **sombre**, recouverte d'un **brouillard d'exploration**.
- Marcher révèle une bande autour de son tracé (buffer ~50 m) → **zone découverte**.
- Une zone découverte par **un** joueur devient visible pour **tout** le groupe (mode normal).
- Chaque tracé **garde son propriétaire** et sa couleur.

## 3. Économie : Djadja Coins

**Monnaie unique** du jeu : les **Djadja Coins**. Gagnés par le jeu, dépensés en cosmétique.

### Sources (crédit)
| Source                 | Exemple                                             |
| ---------------------- | --------------------------------------------------- |
| Missions journalières  | marcher X km, explorer une nouvelle zone, photos    |
| Compagnon              | sa sortie quotidienne peut rapporter un petit bonus |
| Événements / Contest   | récompenses de participation et de victoire         |

### Dépenses (débit)
| Dépense                | Usage                                               |
| ---------------------- | --------------------------------------------------- |
| Boutique cosmétique    | skins, vêtements, compagnons, camps, cartes, effets |
| Objets Contest         | bombe, pinceau, rouleau, bouclier (chers)           |

### Règle serveur (anti-triche)
Tout mouvement de coins passe par une fonction serveur atomique qui :
1. vérifie le solde (jamais négatif) ;
2. écrit le nouveau solde **et** une ligne dans `wallet_transactions` dans la même transaction.

Le client ne peut **jamais** écrire directement le solde.

## 4. Missions journalières

Exemples de missions (table `daily_missions`, code + objectif + récompense) :

| Code            | Objectif                     | Récompense (indicative) |
| --------------- | ---------------------------- | ----------------------- |
| `walk_2km`      | marcher 2 000 m              | 💰 modérée              |
| `explore_zone`  | révéler une nouvelle zone    | 💰 bonne                |
| `take_photo`    | ajouter 1 photo / POI        | 💰 faible               |
| `use_companion` | envoyer le compagnon         | 💰 faible               |

> Les valeurs exactes seront calibrées après playtest ; l'objectif est que **jouer normalement**
> (une balade + interactions) donne de quoi progresser sans grinder.

## 5. Boutique — cosmétique uniquement

**Aucun avantage de gameplay ne s'achète.** La boutique ne vend que de l'apparence :

- skins d'avatar, vêtements ;
- compagnons (apparence) ;
- décors de camps ;
- styles de carte ;
- styles de tracé ;
- effets visuels.

Cela garantit qu'un joueur qui dépense beaucoup **n'a aucun avantage** sur les autres :
la compétition reste basée sur l'exploration réelle.

## 6. Compagnon

- Chaque joueur possède **un** compagnon, qui vit sur la carte et possède une **niche**.
- **Une fois par jour**, le compagnon part de sa niche, **explore une zone inconnue**, **révèle
  ~100 m**, puis **revient dormir**.
- Contrainte technique : unicité `(companion_id, run_date)` → une seule sortie par jour.
- La zone révélée par le compagnon alimente `discovered_zones` (`source = companion`).

## 7. Campements

- **Camp personnel** : la niche du compagnon.
- **Camp de groupe** : créé par l'administrateur ; sert de point de **rendez-vous**, de **départ
  d'expédition** et de **lieu souvenir**.

## 8. Navigation piéton (marche uniquement)

Deux systèmes, jamais en voiture :

1. **GPS classique** : carte + chemin + instructions + recalcul (via OSRM profil `foot`).
2. **Mode Boussole** : **flèche + direction + distance**, **sans carte**.
   - Disponible **uniquement comme événement** (jamais en mode libre).

## 9. Événements administrateur

L'administrateur (👑 Le Kyk's par défaut) peut créer :

- **Contest** : compétition d'exploration avec récupération de tracés et objets spéciaux.
- **Contest Boussole** : Contest **+** Mode Boussole (carte cachée, navigation à la flèche).
- **Expéditions** : sorties de groupe organisées (départ depuis un camp de groupe).

## 10. Mode Contest — récupération de tracés

| Contexte    | Passer sur le tracé d'un autre joueur                 |
| ----------- | ----------------------------------------------------- |
| **Normal**  | ne récupère **rien** (les tracés coexistent)          |
| **Contest** | **récupère** la portion parcourue (transfert d'owner) |

La résolution géométrique (découpe du tracé adverse, réattribution de la portion, recalcul des
longueurs et scores) est faite **côté serveur** avec PostGIS (`ST_Split`, `ST_Difference`,
`ST_Length`).

## 11. Objets Contest

Achetés en **Djadja Coins**, volontairement **chers** pour préserver l'équilibre.

| Objet        | Effet                                    | Contre                   |
| ------------ | ---------------------------------------- | ------------------------ |
| 💣 **Bombe** | Détruit une partie du tracé ennemi       | (destruction)            |
| 🖌️ **Pinceau** | Récupère une partie du tracé adverse   | Bouclier                 |
| 🧻 **Rouleau** | Capture une zone plus grande           | Bouclier                 |
| 🛡️ **Bouclier** | Protège une zone                       | —                        |

**Principe d'équilibrage** : chaque objet offensif (bombe, pinceau, rouleau) a un coût élevé et
peut être neutralisé/limité par le bouclier sur une zone protégée. Les objets ne s'obtiennent
qu'en jouant (coins gagnés), jamais en payant de l'argent réel → pas de pay-to-win.

## 12. Contest Boussole

Combinaison ultime : **Contest + Boussole**.

- **carte cachée** (pas de fond de carte) ;
- navigation **par flèche** (direction + distance) ;
- **récupération active** de tracés ;
- **objets disponibles**.

C'est le mode le plus exigeant : on explore et on se bat « à l'aveugle », guidé seulement par la
boussole.

---

## Résumé des garde-fous d'équilibre

1. **Cosmétique only** en boutique → pas d'avantage acheté.
2. **Objets Contest chers** et **gagnés en jeu** → pas de pay-to-win, usage réfléchi.
3. **Économie & Contest résolus serveur** → pas de triche client.
4. **Marche uniquement** → progression liée à l'effort réel, plausibilité vérifiée.
