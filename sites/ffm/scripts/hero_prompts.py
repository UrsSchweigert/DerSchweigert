#!/usr/bin/env python3
"""Every hero art prompt, from one fixed template, the hero's figure brief and the clip's four poses.

    hero_prompts.py --hero rogue --sheet swing   print one prompt
    hero_prompts.py --list                       print all 80 as "hero:sheet" plus the prompt
    hero_prompts.py --check                      verify the rules; exit 1 on a violation

Stdlib only, no free-text argument, no file or network access. Workers paste the output
into the asset request and never write a prompt by hand.
"""
import argparse
import re
import sys

# Same ids and order as HEROES in static/game/heroes.js (a test keeps them equal).
HERO_IDS = (
    "adventurer", "adventuress", "princess", "princess-armed", "rogue",
    "rogue-f", "soldier", "soldier-f", "monk", "priestess",
)
SHEETS = ("idle", "walk", "swing", "hurt", "dead", "victory", "cast", "portrait")
MAX_LENGTH = 1500

# Figure brief and strike weapon per hero. Hair and headgear are described positively.
BRIEFS = {
    "adventurer": (
        "a young adventurer with short, softly tousled golden-blonde hair with at most three "
        "small rounded tufts, a crimson scarf, a blue plate cuirass with pauldrons and a longsword",
        "the longsword"),
    "adventuress": (
        "a young adventuress with longer hair tied back, a crimson scarf, a blue plate cuirass "
        "with pauldrons and a longsword",
        "the longsword"),
    "princess": (
        "a courtly princess in a midnight-blue and gold gown with a gold circlet, carrying a light rapier",
        "the light rapier"),
    "princess-armed": (
        "a warrior princess in travel armour with a gold circlet, a sword in one hand and a staff in the other",
        "the sword"),
    "rogue": (
        "a male rogue with his hood half down, leather and forest-green clothes and a shortbow",
        "the shortbow"),
    "rogue-f": (
        "a female rogue with her hood half down, distinct hair and face, leather and forest-green "
        "clothes and a shortbow",
        "the shortbow"),
    "soldier": (
        "a male soldier in a steel helmet with a brass nose guard, a round buckler on the left arm "
        "and an arming sword",
        "the arming sword"),
    "soldier-f": (
        "a female soldier in a steel helmet with a brass nose guard, a distinct face, a round buckler "
        "on the left arm and an arming sword",
        "the arming sword"),
    "monk": (
        "a male monk in a wrapped robe with a shaved head and bound fists",
        "the bound fist"),
    "priestess": (
        "a priestess in a wrapped robe with a sash, hair in a high knot and bound fists",
        "the bound fist"),
}
BOW_HEROES = ("rogue", "rogue-f")

STYLE = "Pixel art, dark outline, limited palette, flat shading."
LAYOUT = ("Lay the four poses out as a 2x2 grid of equal cells on a flat single-colour backdrop, "
          "no shadow, facing right, no text.")

# The four poses of each clip, frame for frame as in the shared clips.
POSES = {
    "idle": ("neutral stance", "inhale, chest slightly raised", "full breath, shoulders high",
             "exhale, settling back"),
    "walk": ("contact, front foot forward", "pass, legs together", "contact, other foot forward",
             "pass, legs together on the other side"),
    "swing": ("windup, {w} drawn back", "strike, {w} sweeping forward",
              "impact, {w} fully extended", "follow-through, {w} carried past the target"),
    "hurt": ("recoil, head and shoulders thrown back", "recoil, held at its deepest",
             "recoil, starting to recover", "recoil, nearly upright"),
    "dead": ("buckle, knees giving way", "fall, body toppling backwards", "ground, lying flat",
             "still, motionless on the ground"),
    "victory": ("raise, one arm lifted", "cheer, arm high and chest out", "plant, arm lowered, feet set",
                "hold, proud upright stance"),
    "cast": ("gather, the free casting hand drawn in to the chest",
             "thrust, the free casting hand thrust forward, palm open",
             "hold, the casting hand held out steady", "recover, the casting hand drawn back"),
}
BOW_SWING = ("loose, the bow held forward at full draw", "bow held forward, string just released",
             "follow-through, bow arm extended", "recover, bow lowered to the ready position")
BOW_NOTE = ("Paint no arrow in flight in any frame, because the strike effect draws the arrow.")


def _poses(hero, sheet):
    poses = POSES[sheet]
    if sheet == "swing":
        if hero in BOW_HEROES:
            return BOW_SWING
        weapon = BRIEFS[hero][1]
        return tuple(p.format(w=weapon) for p in poses)
    return poses


def prompt(hero, sheet):
    if hero not in BRIEFS or sheet not in SHEETS:
        raise ValueError("unknown hero or sheet")
    brief = BRIEFS[hero][0]
    if sheet == "portrait":
        return (f"{STYLE} A head-and-shoulders bust portrait of {brief}, facing right, centred, "
                "on a flat single-colour backdrop, no shadow, no text. Keep the character and "
                "palette of the reference sheet.")
    if sheet == "idle":
        if hero == "adventurer":
            subject = ("Keep the reference figure exactly, and change only its hair to this: short, "
                       "softly tousled golden-blonde hair with at most three small rounded tufts.")
        else:
            subject = (f"Draw a new figure, {brief}, in the reference's pixel style, proportions "
                       "and size.")
    else:
        subject = (f"Keep the character, palette and proportions of the reference sheet: {brief}.")
    cells = " ".join(f"{i}. {p}." for i, p in enumerate(_poses(hero, sheet), 1))
    parts = [STYLE, subject, f"The {sheet} clip, four poses in reading order: {cells}", LAYOUT]
    if sheet == "swing" and hero in BOW_HEROES:
        parts.append(BOW_NOTE)
    return " ".join(parts)


def build_all():
    return [(f"{h}:{s}", prompt(h, s)) for h in HERO_IDS for s in SHEETS]


FORBIDDEN = re.compile(r"spik|starburst|in the style of|inspired by|\blike\b|\bsimilar to\b", re.I)
GRID_RULES = ("2x2 grid", "flat single-colour backdrop", "no shadow", "facing right", "no text")
HAIR = "short, softly tousled golden-blonde hair"


def check():
    errors = []
    items = build_all()
    if len(items) != len(HERO_IDS) * len(SHEETS) or len(set(k for k, _ in items)) != len(items):
        errors.append("roster coverage: expected one prompt per hero and sheet")
    for key, text in items:
        hero, sheet = key.split(":")
        if FORBIDDEN.search(text):
            errors.append(f"{key}: forbidden wording")
        if len(text) >= MAX_LENGTH:
            errors.append(f"{key}: {len(text)} characters")
        rules = GRID_RULES if sheet != "portrait" else GRID_RULES[2:]
        for rule in rules + (("flat single-colour backdrop",) if sheet == "portrait" else ()):
            if rule not in text:
                errors.append(f"{key}: missing '{rule}'")
        if hero == "adventurer" and sheet in ("idle", "portrait") and HAIR not in text:
            errors.append(f"{key}: missing the adventurer's hair brief")
        if sheet == "idle":
            want = "Keep the reference figure" if hero == "adventurer" else "Draw a new figure"
            if want not in text:
                errors.append(f"{key}: wrong idle wording")
        has_note = "no arrow in flight" in text
        if has_note != (sheet == "swing" and hero in BOW_HEROES):
            errors.append(f"{key}: bow arrow clause misplaced")
    for line in errors:
        print(line, file=sys.stderr)
    return 1 if errors else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--hero", choices=HERO_IDS)
    ap.add_argument("--sheet", choices=SHEETS)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    if args.check:
        return check()
    if args.list:
        for key, text in build_all():
            print(f"{key}\t{text}")
        return 0
    if not (args.hero and args.sheet):
        ap.error("give --hero and --sheet, or --list, or --check")
    print(prompt(args.hero, args.sheet))
    return 0


if __name__ == "__main__":
    sys.exit(main())
