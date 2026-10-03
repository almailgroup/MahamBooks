#!/usr/bin/env bash
# Regenerates the template gallery thumbnails in public/templates/: one per
# template and document language (<id>.jpg in English, <id>-ar.jpg in Arabic,
# <id>-ar-en.jpg bilingual). Requires poppler (pdftoppm) and ImageMagick (convert).
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

VARIANTS=invoice DPI=110 npx tsx --tsconfig tsconfig.scripts.json scripts/render-templates.tsx "$tmp"
mkdir -p public/templates
for png in "$tmp"/*-invoice-1.png; do
  name=$(basename "$png" -invoice-1.png)
  case "$name" in
    *-ar-en) out="${name%-ar-en}-ar-en" ;;
    *-ar) out="${name%-ar}-ar" ;;
    *-en) out="${name%-en}" ;;
    *) continue ;;
  esac
  convert "$png" -resize 560x -background white -flatten -strip -quality 80 "public/templates/$out.jpg"
done
ls -la public/templates
