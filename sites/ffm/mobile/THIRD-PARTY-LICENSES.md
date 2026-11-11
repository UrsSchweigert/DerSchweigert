# Third-party licences

The app is a Capacitor 8 shell around the game code in `sites/ffm/static`. The
packages in `package.json`/`package-lock.json` keep their own licence metadata;
this file records the purchase plugin the store integration depends on, as the
store integration's outcome requires.

## @capgo/native-purchases 8.9.6

- Purpose: in-app purchases for the one-time unlock `arithmoslayer_full_unlock` — StoreKit 2 on iOS (15+) and Google Play Billing on Android.
- Licence: Mozilla Public License 2.0 (MPL-2.0), see <https://www.mozilla.org/en-US/MPL/2.0/>.
- Source: <https://github.com/Cap-go/capacitor-native-purchases>
- Package: <https://www.npmjs.com/package/@capgo/native-purchases>
- Copyright: Capgo and the plugin's contributors.
- Wrapped by: `game/purchase.js` (`createPurchasesPlugin`, `createPurchaseStore`).
- No backend, no receipt server and no third-party purchase service: purchases are processed by Apple and Google only.

MPL-2.0 is file-level copyleft. The plugin stays an unmodified npm dependency;
changes to its files, if any were ever made, would have to be published under
the same licence.

## Generated combat sound effects (`static/game/sfx/`)

73 clips in 27 cue families, played by `game/audio.js` through `SFX_CUES`.
Most families hold three variants; `heal-charge`, `game-over`, `win-pop` and
`sword-gain` are single-file cues that fire once per session or per level. Family names map to file names one to one, so replacing a
clip needs no code change.

- Generator: ElevenLabs Sound Effects through fal.ai, endpoint `fal-ai/elevenlabs/sound-effects/v2`, generated 2026-11-11.
- Settings: `prompt_influence` 0.6 (0.65-0.75 for clips that came back too quiet or were regenerated), `output_format` `mp3_44100_96` for the fiend, hero and spell cues, `mp3_44100_128` for the three slashes, then decoded, loudness-normalised to RMS 0.09 with a -1 dBFS peak ceiling, and re-encoded once at `mp3_44100_96`.
- Output: 73 files, 920 KB total; hits 0.55-0.58 s, deaths 1.04 s, slashes 0.63-0.73 s, spell launches 1.36 s (fire) and 0.52 s (bolt), spell blasts 0.68 s, heal charge 2.0 s loop, heal bloom 1.0 s, dragon roars 1.6 s, answer sparkles 0.48 s, game-over 1.76 s, win pop 0.68 s, band chime 0.68 s, all 44.1 kHz stereo. No input audio, no voice model and no reference recording was used.
- Licence: ElevenLabs' Terms of Use govern the Output. Commercial use of generated audio requires a paid ElevenLabs subscription on the account that generated it (<https://elevenlabs.io/terms-of-use>, §3 free vs. paid use, §4 inputs and outputs); free-tier output is non-commercial only. Confirm the plan on the generating account before shipping a store build, because Arithmo Slayer is a paid app.
- Attribution: none required on a paid plan. The prompts are recorded here for provenance only.

### Prompts

| Family | Variant 1 | Variant 2 | Variant 3 |
| --- | --- | --- | --- |
| `sword-slash` | Fast sword slash whoosh, sharp steel blade swishing through air, dry close-up, arcade game hit sound effect, no reverb | Quick katana swipe, thin metallic swish cutting air, crisp and punchy, video game sound effect, dry, no music | Heavy sword slash, bright metallic ring with a fast air swish, short and dry, no reverb tail, game sound effect |
| `hero-hurt` | Short cartoon body hit thud, soft cloth impact with a quick breathy wince, dry, no gore, game sound effect | Quick padded impact with a low thump and a brief gasp, close and dry, arcade game damage sound | Dull body blow, cloth and leather thud with a short breath, no reverb, video game hurt sound |
| `answer-sparkle` | Tiny bright coin sparkle, quick glittery chime, very short, dry, no music | Small glassy sparkle tick, cheerful star glitter, short and dry | Soft magical twinkle, two quick bright notes, short, arcade reward sound |
| `game-over` | Slow sad descending sting, three low notes over a dark drone, loss screen, cartoon, no voices | — | — |
| `win-pop` | Big confetti cannon pop with a bright crack and paper flutter, celebration, loud, short | — | — |
| `sword-gain` | Bright glassy blade chime with a magical shimmer, reward unlocked, short, fantasy game, no voices | — | — |
| `heal-charge` | Gentle magical charging hum, soft shimmering tone rising slowly, seamless sustained loop, quiet, no melody, no voices | — | — |
| `heal-bloom` | Warm healing bloom: soft bell bloom with an airy rising swell and a gentle sparkle, 1 second, cartoon fantasy, no voices | Soft magical restoration chime, warm glassy bloom swelling upward, gentle, dry, game heal sound | Light green shimmer of energy blooming with a soft low thump and a warm chime, cartoon heal, no voices |
| `dragon-roar` | Powerful dragon roar, deep rumbling bellow with a rasp, cinematic but cartoonish, no words, no music | Huge beast roar, low growling bellow rising into a raspy roar, dry, fantasy game, no words | Monster roar with a crackling flame breath edge, deep and wide, short, cartoon fantasy, no words |
| `fire-cast` | A fiery ball of flame whooshing through the air, crackling embers trailing, sustained travel sound that lasts the whole clip, no impact, no music | Sustained fire whoosh travelling past, warm roaring flame with ember crackle, long, tapering at the end, game spell launch | Blazing fire trail swooshing through air, continuous roar with sparks, dry, no impact boom, game spell launch |
| `bolt-cast` | Electric arc buzzing and crackling as it travels, sustained zap whoosh lasting the whole clip, no impact, game spell launch | High voltage sizzle travelling fast, electric buzz with a whoosh, dry, no boom, game spell launch | Crackling energy bolt swooshing through air, bright electric buzz, short, no impact, game spell launch |
| `fire-impact` | A fiery burst of flame landing: fast whoosh into a low boom with crackling embers, dry, game spell hit | Flame blast hitting a target, punchy whoosh and a warm boom with a spark crackle, arcade spell sound | Bright fire burst, airy whoosh into a short crackling rumble, cartoon spell impact, no music |
| `bolt-impact` | Electric zap strike: sharp crack with a buzzing sizzle and a short thunder tail, game spell hit | Lightning burst, snappy electric crackle and a low rumble, dry arcade spell sound | Bright electric spark burst with a buzz and a quick roll of thunder, cartoon spell impact, no music |
| `slimeling-hit` | Wet squelchy slime impact, quick gooey blorp, short and dry, game hit sound | Bubbly wet pop of a soft gooey blob, immediate, close-miked, short, arcade game sound | Wet gooey splat with a bubbly pop, immediate, loud, close-miked |
| `slimeling-death` | Slime monster dissolving with a wet splat and a fading gurgle, short, cartoon, no gore | Gooey creature defeated, squelching collapse and bubbly fade out | Wet splat then a soft gurgling bubble fade, cartoon slime defeat, dry |
| `bonehead-hit` | Dry bone crack and rattle impact, short and snappy, skeletal hit sound | Hollow bone knock with a quick clatter, close and dry, game impact | Sharp skeletal clack with a light rattle, arcade hit sound |
| `bonehead-death` | A pile of dry wooden sticks tumbling and settling onto a table, playful clatter, cartoon, no music, no voices | A long playful rattle of many wooden sticks tumbling across a table and settling slowly, cartoon, no music, no voices | Bony clatter cascade ending in a dry knock, cartoon skeleton defeat |
| `toadlord-hit` | Chunky amphibian thud with a low croak, short and dry, game hit sound | Low squishy croak and a soft wet thump, immediate and loud, close, short | Heavy wet thump on a big toad, short croak, video game impact |
| `toadlord-death` | Large toad defeated, deep deflating croak and a wet flop, cartoon, no gore | Big amphibian sinking with a long low croak and a soft splat | Deflating toad sigh with a bubbly wet thud, cartoon defeat, dry |
| `magelitch-hit` | Bright glassy sparkle burst with a short electric pop, immediate and loud, close, no silence | Quick arcane spark crackle with a small glass chime, immediate and loud, close, short | Sparkly magic burst with a quick glass ping, video game impact |
| `magelitch-death` | Witch spell fizzling out, magical shimmer dissipating with a low sigh, cartoon, no voice | Enchanted creature defeated, arcane chime breaking apart and fading | Crackling magic unraveling into a soft descending shimmer, game defeat sound |
| `birdfoe-hit` | Feathery thump with a startled squawk, short and dry, game hit sound | Quick wing flap and a sharp bird squawk on impact, arcade hit | Soft feathered smack with a brief chirp, video game impact |
| `birdfoe-death` | Bird defeated, squawk and fluttering feathers falling, short, cartoon, no gore | Startled bird cry with wings flapping away and fading, game defeat sound | Shrill squawk cut short, then light feather flutter, cartoon defeat |
| `wolffoe-hit` | Furry thump with a short pained yelp, dry, game hit sound | Quick body blow on a wolf with a brief snarl, arcade hit | Muffled fur impact and a short growl, video game hit sound |
| `wolffoe-death` | Wolf defeated, low growl fading into a whine, short, cartoon, no gore | Beast collapsing with a soft thud and a fading whimper, game defeat sound | Growl tapering to a quiet whine with a body thump, cartoon defeat |
| `snakefoe-hit` | Sharp dry hiss and a scaly rattle, immediate and loud, close, short, game sound | Quick impact on a snake with a rattling hiss, arcade hit | Coiled body thump and a short sibilant hiss, video game impact |
| `snakefoe-death` | Snake defeated, long hiss fading out with a soft slither, cartoon, no gore | Serpent collapsing, hiss trailing off into a slither and a light thud | Rattling hiss fading to silence with a soft coil slump, game defeat sound |

Two prompts were rejected by the generator's content checker and were reworded:
the skeleton collapse became loose sticks tumbling, and a wet squish became a
wet splat. Both replacements are listed above; the flag was on wording, not on
gameplay content.
