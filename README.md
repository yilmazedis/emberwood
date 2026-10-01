# Emberwood

A small online 3D action RPG in the browser: make an account and a hero, then fight monsters alongside other players,
collect loot and gear up.
It uses Three.js with the free **KayKit Adventurers**, **Skeletons** and **Dungeon** packs (CC0, by Kay Lousberg).

## Run it

Emberwood is an online game: the website (this folder) plus a game server (`server/`) that keeps accounts and
characters. Locally, run both from this folder (Node 22 or newer):

```bash
EMBERWOOD_DATA=./server-data node server/index.js
```
```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Pages opened from `localhost` (or your home network, e.g. `192.168.x.x`) talk to
the server on port 8787; anything else talks to `wss://gameserver.kerimcaglar.com`. Add `?server=ws://host:port/ws`
to point a page at another server, or `?autostart` to play offline with a hero saved in the browser (used by the
automated tests). Three.js loads from a CDN, so you need an internet connection.

## Online play

- **Accounts:** username and password. Passwords are stored as scrypt hashes; a signed token keeps you signed in
  for 30 days. Signing in somewhere else signs the older session out.
- **Heroes:** up to 4 per account, any mix of the 4 classes (`src/classes.js`: Knight, Barbarian, Mage, Rogue, each
  with its own model, starting gear and stats). Names are unique, 3–14 letters (Turkish letters are fine). A hero
  saved in the browser from the single-player days can be brought online once, as a Knight.
- **Saving:** the game sends the hero's progress to the server every few seconds and when you leave. If the line
  drops, the game keeps going and reconnects by itself.
- **The shared world:** the monsters live on the server (`src/sim/world.js`): they spawn, wander, chase the nearest
  hero and attack, the same for everybody. You see the other heroes nearby in their class and gear, with a name tag
  and life bar, and what they do (swings, skills, ale, falling and rising). Everyone who hits a monster gets the kill's
  XP and quest credit and rolls their **own** loot, which only they see, so nobody steals anyone's drops. Whether a
  monster's blow, bolt or slam lands is decided by the game of the hero it's aimed at (it knows where that hero
  really stands, so dodging works); the server keeps the monsters' life. Morvain's crypt is shared by everyone for now.
- **Chat:** one world channel (Enter, or the Chat button on phones); nearby heroes also show it in a bubble.
  Last 20 lines are shown to heroes who arrive.
- **Coming next:** parties with their own copy of the crypt, and trading.

The server (`server/`, Node built-ins only) speaks JSON over one WebSocket at `/ws` and shows `{"ok":true,…}` at
`/status`. Ten times a second it moves the world on and sends each hero's game what's around it: monsters and heroes
within ~55 m (in full the first time, then only what changed) and what happened. Games show that 0.18 s in the past
so movement stays smooth between updates. The messages have a version (`PROTOCOL` in `src/sim/world.js`): a game
that doesn't match the server asks to reload (or, if the server is the older one, to try again in a minute). Its data lives outside the website, in `$EMBERWOOD_DATA` or `~/emberwood-data`: one JSON file per account
(`accounts/<name>.json`), `names.json` (who has which hero name) and `secret.key` (signs the tokens; keep it private).
To back up, copy that folder.

## Deploy

Live at https://emberwood.kerimcaglar.com, on DirectAdmin + LiteSpeed shared hosting.

- **Order:** `git pull`, then Restart the game server (most updates change both). Players get the new game when
  they reload. The host only really starts (or restarts) the Node app when an ordinary web request reaches it, and a
  WebSocket doesn't count: so the game knocks on `/status` while it connects (and tries again once the server is
  up), and the server knocks on its own door every few minutes while anyone is connected. To check a restart by
  hand, open https://gameserver.kerimcaglar.com/status: `uptimeS` starts again from 0.
- **https only:** `.htaccess` sends `http://` visitors on to `https://` (the game server only takes the game from
  `https://emberwood.kerimcaglar.com`, and the app needs https). Refused connections are logged in the server's
  `stderr.log` (in the app root, `server/`).
- **Website:** the subdomain's `public_html` is a symlink to the clone
  (`~/domains/emberwood.kerimcaglar.com/public_html -> emberwood`). Deploy with `git pull` in the clone.
  `.htaccess` sets the model MIME types and cache headers, and blocks `.git`, log files and `server/`.
- **Game server:** a DirectAdmin "Setup Node.js App" on `gameserver.kerimcaglar.com`: application root
  `domains/emberwood.kerimcaglar.com/emberwood/server`, startup file `index.js`, the newest Node.js. No `npm install`.
  After a `git pull` that changes `server/` (or `src/classes.js`), press Restart for the app.
- **Slow host, slow phones:** the host takes a second or two to answer each request, so the game asks for few:
  every code file at once (`modulepreload` links in `index.html`: list new modules there too), the item models packed
  into one file, the crypt in another. A model download that gets no data for 20 s is dropped and asked for again
  (3 tries), and the game waits up to 20 s for the game server, then tries once more by itself.
- **Hosting test:** `tools/hosting-test` measures whether a host can run the server (see its README). Hyperion passed
  with caveats: it is shared and overloaded, so expect the occasional stutter; a small VPS would remove it.

## Classes and skills

Each class has its own four skills (`src/skills.js`), unlocking at levels 1 to 4 (keys 1–4, or the round buttons
on phones). Stuns, slows and taunts are applied by the game server, so everyone sees them: dizzy stars over a
stunned monster, a frosty blue tint on a slowed one. Bosses shrug off most of a stun.

| Class | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **Knight** (sword and shield) | Shield Bash: 120%, stuns 1.5 s | Charge: rush 7 m, 150% around you, knockback, short stun | War Cry: monsters within 9 m turn on you for 4 s; +50% armor for 8 s | Second Wind: heal 35% |
| **Barbarian** (two-handed axe) | Cleave: wide arc, 170%, knockback | Leap Slam: jump 8 m, 180% within 3 m, slows by half for 3 s | Whirlwind: spin 1.4 s, 5 × 65% | Battle Rage: +30% attack speed, +25% damage for 8 s |
| **Mage** (staff) | Fireball: 220% blast | Frost Nova: 120% within 5 m, slows by 60% for 4 s | Blink: teleport 8 m | Meteor: 350% within 3.5 m after a moment |
| **Rogue** (daggers) | Twin Strike: 2 × 90%, more crits | Fan of Knives: 7 knives, 80% each | Smoke Bomb: stuns within 4 m for 2 s; half of the blows at you miss for 4 s | Shadow Step: appear behind an enemy 12 m away, 250%, more crits |

Percentages are of weapon damage; the mage's spells (and the mage's basic attack, an arcane bolt from the staff
instead of a swing) also scale with Spell Power. Other heroes' skills play out on your screen the same way, from
the same code, without the damage (their game deals it).

## Controls

**Desktop:** WASD to move · left click to attack (hold to keep swinging) · 1–4 skills · Q ale (heal) · I bag · E use what's in reach (merchant, stash, notice board, the crypt door, chests) · Enter chat · mouse wheel to zoom · Esc settings · M mute

**Phones and tablets** (switches automatically on the first touch): a floating joystick on the left half of the screen
(push a little to walk, fully to run), a hold-to-attack sword button and skill buttons on the right. On touch screens,
attacks and skills aim at the nearest enemy. In the bag, tap an item to see it, then Equip or Sell. Chat opens a line
at the top of the screen (the keyboard covers the bottom); the last three lines stay there for a while.

**Camp:** Wren the merchant sells ale and gear around your level (new stock every 5 minutes and on level-up),
buys back anything you sold this session, and can sell all your common items at once. The stash chest next to
the stall holds 30 items; both are saved with your character.

**Quests:** the notice board on the east side of camp has a five-part story (the meadow slimes, the bandit hideout,
the cultists at the stones, the graveyard, then Grok) and three bounties that are rerolled when you claim or skip them
(slay monsters, pick up gold, find magic items). Accepted quests show under your portrait with their progress, and
their zone gets a dashed gold ring on the minimap. When one is done, go back to the board to claim gold, XP, ale or
an item; a golden "!" over the board means there's a new story quest or a reward waiting.

**The Forgotten Crypt:** the crypt door at the east end of the graveyard leads down to a dungeon (level 7 – 9):
a hall of bones, a chapel, an ossuary and a vault full of skeletons, two chests that refill every few minutes, and
the sanctum of **Morvain the Lich**. He fires bolt volleys, drops violet grave circles that erupt a moment later
(step out!), raises skeletons at 70% and 40% life, blinks away when you stand on top of him, and is enraged below
30%. When he falls, his minions crumble and the hoard behind him opens. The stairs in the first room lead back up.
The story's last quest sends you down there.

## Sound and settings

Everything you hear is synthesized live with WebAudio; there are no audio files.
- **Music** (`music.js`): small synth instruments (harp, pads, flute, bass, bells, brass, taiko drums) play seeded,
  slowly changing patterns, so it never loops exactly. A folk theme in D dorian outdoors, a dark drone with distant bells
  in the crypt, and a drum-driven battle theme whenever a boss is fighting you; they crossfade.
- **Ambience** (`ambience.js`): wind and birdsong in the woods, crows and stronger wind in the graveyard, water by the
  pond, crackling near fires; in the crypt a low rumble, a draft, dripping water and more echo.
- **Settings** (Esc, or the Settings button): music, sound effect and ambience volume, mute, graphics quality (Low turns
  off shadows and glow and draws fewer pixels, for older phones), camera distance (phones have no mouse wheel), and
  **Leave game**, which saves and returns to the title screen. Online the world doesn't wait while the settings are
  open (offline it pauses); monsters leave a hero alone while the app is in the background, and the sound rests. Settings are kept in the browser
  (`emberwood-settings`), separate from the save.

## Install as an app (PWA)

The site is a Progressive Web App: `manifest.webmanifest` + `sw.js`.
- **Android / desktop Chrome:** the title screen shows an **Install as app** button (or use the browser menu).
- **iPhone / iPad:** Safari → Share → **Add to Home Screen** (the title screen explains this on iOS).

Installed, it opens fullscreen in landscape with its own icon. The service worker keeps code network-first,
so a `git pull` on the server reaches players right away. Models and libraries are cache-first, so after the first
visit the game also works offline.

## App icons

`icons/` is rendered from the game's own Knight model by `tools/icon.html`. To regenerate after a change,
serve the folder on port 8766 and run headless Chrome, e.g.:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader --default-background-color=00000000 --window-size=512,512 --virtual-time-budget=20000 --screenshot=icons/icon-512.png "http://localhost:8766/tools/icon.html?size=512"
```

Variants: `?size=192`, `?size=512&maskable` (Android adaptive icon), `?size=180&full` (apple-touch-icon), `?size=32` (favicon).

## Where the graphics come from

| What you see | Source |
|---|---|
| Knight, bandits, cultists, boss, Wren the merchant (Ranger) | KayKit Adventurers character models (`assets/characters`) |
| Skeleton minions, warriors, rogues, mages | KayKit Skeletons character models (`assets/characters/Skeleton_*`); glowing eyes come from the pack's `Glow` material |
| Bone weapons and shields (skeleton loot) | KayKit Skeletons item models (`assets/items/Skeleton_*`) |
| Walk / run / idle / hit / death / throw animations | KayKit shared rig animations (`assets/animations`) |
| Swords, axes, shields, staff, ale mug | KayKit item models (`assets/items`, packed into `items.glb`), attached to the `handslot` bones |
| Helmets and cape | Parts of the Knight model, shown or hidden when equipped |
| Gloves and boots on the knight | The Knight's hands/feet are recolored by a shader that follows the skinning weights of the hand/forearm and foot/toe/shin bones (`character.js`) |
| Gloves, boots and rings (icons, loot on the ground) | Small procedural models (`gear.js`); the packs have none |
| Sword swings | Generated in code (`character.js`); the free pack has no attack clips |
| Terrain, trees, rocks, grass, water, camps, graveyard | Generated in code (`terrain.js` places them, `world.js` draws them), flat-shaded to match KayKit |
| Market stall, stash chest and notice board | Generated in code (`town.js`), with the pack's items as wares on the counter |
| The crypt: walls, floors, pillars, stairs, torches, banners, chests, props | KayKit Dungeon models, packed into one file (`assets/dungeon/crypt.glb`), placed on a 4 m grid and merged into two meshes (`dungeon.js`); walls on the camera side are clipped low |
| Morvain the Lich | The Skeleton Mage, scaled up and tinted violet, with a glowing staff; his rune circle is a shader (`dungeon.js`) |
| Slimes | Generated in code (`enemies.js`) |
| Inventory icons and portrait | Rendered at startup from the same 3D models (`assets.js`) |
| Fire, sparks, slash arcs, glow | Particles, shaders and bloom (`fx.js`) |
| Sound effects, music and ambience | Synthesized with WebAudio (`audio.js`, `music.js`, `ambience.js`) |

## Code map

- `src/game.js`: renderer, camera, aim, damage, rewards, save
- `src/input.js`: keyboard, mouse, joystick and touch buttons (also clears keys the browser never "releases")
- `src/player.js`: stats, leveling, inventory, buffs, and the looks other players see
- `src/skills.js`: the classes' skills: one definition plays them for our hero (with the damage) and for others
- `src/sim/world.js`: the shared world the server runs: monster AI, spawns, the crypt, heroes, who sees what
- `src/link.js`: the game's side of it: smooth movement between updates, attacks played out, what we report back
- `src/local.js`: the same world running in the page, for offline play (`?autostart`)
- `src/enemies.js`: monsters as the world reports them (models, animation, their attacks on our hero)
- `src/others.js`: the other heroes (models in their gear, name tags, what they do); `src/chat.js`: world chat
- `src/monsters.js`: monster types and the spawn table; `src/terrain.js`: ground height, zones, what blocks the way
  (with fixed seeds, so the game and the server agree); `src/crypt-map.js`: the crypt's map, walls and paths
  (these three, `classes.js`, `util.js` and `noise.js` are plain data and math, shared with the server)
- `src/items.js`: item bases (weapons, shields, helmets, capes, gloves, boots, rings), rarities, affixes, loot rolls
- `src/gear.js`: procedural glove/boot/ring models
- `src/town.js`: the camp: merchant, stall, stash chest, notice board, shop stock, buyback, stash transfers
- `src/dungeon.js`: the crypt drawn: its pieces, torch lights, chests, the way in and out
- `src/audio.js`, `src/music.js`, `src/ambience.js`: sound effects, generative music, ambience (mixer and volumes in `audio.js`)
- `src/settings.js`: saved player settings
- `src/classes.js`: the playable classes (shared with the server)
- `src/net.js`, `src/account.js`: the connection to the game server, and the sign-in / hero screens
- `server/`: the game server (`main.mjs` messages, `store.mjs` accounts on disk, `auth.mjs` passwords and tokens, `ws.mjs` WebSocket)
- `src/quests.js`: the story quests, bounty templates, progress and rewards
- `src/combat.js`: projectiles and ground loot
- `src/ui.js`, `style.css`: HUD, action bar, minimap, inventory, tooltips
- `src/character.js`, `src/animator.js`: model setup, animation blending, procedural swings

## Adding more art

KayKit's other free packs (Forest, Halloween…) use the same rig and style. The Skeletons pack was added this way:

- **New monster:** copy the `.glb` into `assets/characters/`, add its name to `CHARACTERS` in `assets.js`, and add an entry to `ENEMY_TYPES` and `SPAWNS` in `monsters.js` (then restart the game server). The skeleton entries show the options: `offhand` (shield), `style: 'chop'`, `eyes` (glow color), `bolt` (caster projectile color), `loot: 'bone'` (loot table).
- **New weapon or shield:** copy the `.gltf`, `.bin` and texture into `assets/items/`, add the model name to `ITEM_MODELS` in `assets.js`, add a base to `BASES` in `items.js`, then repack: `node tools/pack-items.mjs` (it packs every `ITEM_MODELS` model into `assets/items/items.glb`, which the game loads instead of the ~50 separate files).
- **More crypt pieces:** name any Dungeon pack model in `crypt-map.js` (e.g. `put('barrel_large', x, z)`), then repack:
  `node tools/pack-dungeon.mjs "<KayKit_Dungeon_Pack_1.1_FREE>/Assets/gltf"`. It writes every model `dungeon.js`
  names into `assets/dungeon/crypt.glb`, one file instead of ~80 (the host is slow to answer each request).
- **Attack animations:** if you get a pack with combat clips (for example Rig_Medium_CombatMelee), drop the `.glb` into `assets/animations/`, add it to `ANIMATIONS`, and call `anim.play('<clip name>')` instead of `startSwing`.

Heroes are saved on the game server. Offline play (`?autostart`) saves in the browser's localStorage instead; to
start that over, run `localStorage.removeItem('emberwood-save-v1')` in the console.
