#!/usr/bin/env bash
# ============================================================================
# Gayeulle Party — applique le schéma sur une base Supabase (ou Postgres+PostGIS)
# ----------------------------------------------------------------------------
# Applique, dans l'ordre, toutes les migrations de backend/supabase/migrations/
# puis seed.sql, via psql. Fonctionne sur Supabase Cloud comme en self-host.
#
# Prérequis : psql (paquet postgresql-client).
#
# Usage :
#   export DATABASE_URL='postgresql://postgres:MOT_DE_PASSE@db.<ref>.supabase.co:5432/postgres'
#   ./tools/apply_migrations.sh
#
# ⚠️ Utilise la connexion DIRECTE / SESSION (port 5432), pas le pooler
#    « transaction » (port 6543) : les migrations créent des fonctions et
#    modifient des publications, ce qui exige une session complète.
# ============================================================================
set -euo pipefail

: "${DATABASE_URL:?Définis DATABASE_URL (chaîne de connexion Postgres Supabase)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql est requis. Installe-le : sudo apt install postgresql-client"
  exit 1
fi

DIR="$(cd "$(dirname "$0")/../backend/supabase" && pwd)"

echo "▶ Application des migrations depuis $DIR/migrations"
for f in "$DIR"/migrations/*.sql; do
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

if [ -f "$DIR/seed.sql" ]; then
  echo "▶ seed.sql (catalogues boutique + missions du jour)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/seed.sql"
fi

echo ""
echo "✅ Schéma appliqué. Vérifie dans Supabase : Table Editor + Database → Extensions (postgis)."
