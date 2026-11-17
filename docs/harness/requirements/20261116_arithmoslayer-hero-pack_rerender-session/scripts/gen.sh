#!/bin/bash
set -e
S=$1; SEED=$2
BASE=$(python3 sites/ffm/scripts/hero_prompts.py --hero adventurer --sheet idle)
FIX="Corrective sentence: dress the grey mannequin as a young adventurer with a smooth rounded cap of short soft golden-blonde hair and at most three small rounded tufts at the back; a short crimson scarf tucked at the collar; a light blue plate cuirass over a cream undershirt with two matching rounded pauldrons, one on each shoulder; tan bracers, brown boots; a slim straight longsword with a plain crossguard held low in the right hand in every pose; whole figure head to boots. Every cell shows a full side view in profile facing right, never from the front and never from behind, and no cell shows the grey mannequin."
URI="data:image/png;base64,$(base64 -i $S/mannequin.png | tr -d '\n')"
python3 tools/fal_image.py "$BASE $FIX" -m fal-ai/flux-pro/kontext -s 1024x1024 --seed $SEED --format png -o $S/id$SEED --param "image_url=\"$URI\""
