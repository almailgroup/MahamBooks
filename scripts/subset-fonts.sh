#!/usr/bin/env bash
# Regenerates the fonts in src/pdf/fonts from the @expo-google-fonts
# packages (SIL Open Font License). Requires fonttools: pip install fonttools
# Subsetting keeps Latin (incl. Vietnamese), Greek, Cyrillic, punctuation,
# currency symbols and the OpenType features used for print (kerning,
# ligatures, tabular/lining figures). Hinting is dropped (not used in PDFs).
#
# Families with a Reserved Font Name (IBM Plex Sans, IBM Plex Sans Arabic,
# Playfair Display, Lora) are
# copied unmodified: the OFL does not allow a modified (e.g. subsetted)
# version to keep a reserved name.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=node_modules/@expo-google-fonts
OUT=src/pdf/fonts
UNICODES="U+0000-024F,U+0259,U+02B0-02FF,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2215,U+2219,U+221E,U+2248,U+2260,U+2264,U+2265,U+25A0-25FF,U+2713,U+2714,U+FEFF,U+FFFD"

FEATURES='kern,liga,clig,calt,ccmp,locl,mark,mkmk,tnum,lnum,pnum,case'
# JetBrains Mono's coding ligatures (calt) would draw "->" or "==" as single
# symbols; documents should show exactly what was typed.
NO_LIGATURES='kern,ccmp,locl,mark,mkmk,tnum,lnum,pnum,case'

mkdir -p "$OUT"

subset() {
  local pkg=$1 file=$2 name=$3 features=${4:-$FEATURES}
  local src
  src=$(find "$SRC/$pkg" -name "$file" | head -n 1)
  pyftsubset "$src" \
    --unicodes="$UNICODES" \
    --layout-features="$features" \
    --no-hinting \
    --name-IDs='*' \
    --notdef-outline \
    --output-file="$OUT/$name.ttf"
}

copy() {
  local pkg=$1 file=$2 name=$3
  cp "$(find "$SRC/$pkg" -name "$file" | head -n 1)" "$OUT/$name.ttf"
}

subset inter Inter_400Regular.ttf inter-400
subset inter Inter_400Regular_Italic.ttf inter-400-italic
subset inter Inter_500Medium.ttf inter-500
subset inter Inter_600SemiBold.ttf inter-600
subset inter Inter_700Bold.ttf inter-700
subset inter Inter_800ExtraBold.ttf inter-800

subset manrope Manrope_400Regular.ttf manrope-400
subset manrope Manrope_500Medium.ttf manrope-500
subset manrope Manrope_600SemiBold.ttf manrope-600
subset manrope Manrope_700Bold.ttf manrope-700
subset manrope Manrope_800ExtraBold.ttf manrope-800

copy ibm-plex-sans IBMPlexSans_400Regular.ttf plexsans-400
copy ibm-plex-sans IBMPlexSans_400Regular_Italic.ttf plexsans-400-italic
copy ibm-plex-sans IBMPlexSans_500Medium.ttf plexsans-500
copy ibm-plex-sans IBMPlexSans_600SemiBold.ttf plexsans-600
copy ibm-plex-sans IBMPlexSans_700Bold.ttf plexsans-700

subset jetbrains-mono JetBrainsMono_400Regular.ttf jetbrainsmono-400 "$NO_LIGATURES"
subset jetbrains-mono JetBrainsMono_500Medium.ttf jetbrainsmono-500 "$NO_LIGATURES"
subset jetbrains-mono JetBrainsMono_600SemiBold.ttf jetbrainsmono-600 "$NO_LIGATURES"

copy ibm-plex-sans-arabic IBMPlexSansArabic_400Regular.ttf plexarabic-400
copy ibm-plex-sans-arabic IBMPlexSansArabic_500Medium.ttf plexarabic-500
copy ibm-plex-sans-arabic IBMPlexSansArabic_600SemiBold.ttf plexarabic-600
copy ibm-plex-sans-arabic IBMPlexSansArabic_700Bold.ttf plexarabic-700

copy playfair-display PlayfairDisplay_400Regular.ttf playfair-400
copy playfair-display PlayfairDisplay_400Regular_Italic.ttf playfair-400-italic
copy playfair-display PlayfairDisplay_600SemiBold.ttf playfair-600
copy playfair-display PlayfairDisplay_700Bold.ttf playfair-700

copy lora Lora_400Regular.ttf lora-400
copy lora Lora_400Regular_Italic.ttf lora-400-italic
copy lora Lora_500Medium.ttf lora-500
copy lora Lora_600SemiBold.ttf lora-600
copy lora Lora_700Bold.ttf lora-700

subset space-grotesk SpaceGrotesk_400Regular.ttf spacegrotesk-400
subset space-grotesk SpaceGrotesk_500Medium.ttf spacegrotesk-500
subset space-grotesk SpaceGrotesk_600SemiBold.ttf spacegrotesk-600
subset space-grotesk SpaceGrotesk_700Bold.ttf spacegrotesk-700

subset dm-serif-display DMSerifDisplay_400Regular.ttf dmserif-400
subset dm-serif-display DMSerifDisplay_400Regular_Italic.ttf dmserif-400-italic

echo "Fonts written to $OUT"
