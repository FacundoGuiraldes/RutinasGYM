#!/usr/bin/env bash
# Descarga el dataset de ejercicios (JSON + imágenes + GIFs) en backend/dataset.
# No se sube al repo: las imágenes y GIFs son © Gym visual (ver NOTICE.md del dataset).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d dataset/.git ]; then
  echo "El dataset ya está descargado en backend/dataset (actualizando)..."
  git -C dataset pull --ff-only
else
  git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset.git dataset
fi
echo "Listo. Ejercicios: $(grep -c '"gif_url"' dataset/data/exercises.json)"
