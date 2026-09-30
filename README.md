# Emberwood

A small 3D action RPG in the browser: a knight with skills and gear, monsters to farm, and loot to collect.
It uses Three.js with the free **KayKit Adventurers** and **KayKit Skeletons** packs (CC0, by Kay Lousberg).

## Run it

ES modules and model files need a local web server; opening `index.html` directly won't work. From this folder:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Three.js loads from a CDN, so you need an internet connection.

## Deploy

Live at https://emberwood.kerimcaglar.com. Two ways to host it:

- **Static files** (current): the subdomain's `public_html` is a symlink to the clone
  (`~/domains/emberwood.kerimcaglar.com/public_html -> emberwood`). Deploy with `git pull` in the clone; no restart.
  `.htaccess` sets the model MIME types and cache headers, and blocks `.git` and log files.
- **Node.js app:** set a Node.js app's root to the clone and its startup file to `server.js`.
  It only uses Node built-ins, so no `npm install` is needed.

## Controls

**Desktop:** WASD to move · left click to attack (hold to keep swinging) · 1–4 skills · Q ale (heal) · I bag · E trade / stash (in camp) · mouse wheel to zoom

**Phones and tablets** (switches automatically on the first touch): a floating joystick on the left half of the screen
(push a little to walk, fully to run), a hold-to-attack sword button and skill buttons on the right. On touch screens,
attacks and skills aim at the nearest enemy. In the bag, tap an item to see it, then Equip or Sell.

**Camp:** Wren the merchant sells ale and gear around your level (new stock every 5 minutes and on level-up),
buys back anything you sold this session, and can sell all your common items at once. The stash chest next to
the stall holds 30 items; both are saved with your character.

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
| Swords, axes, shields, staff, ale mug | KayKit item models (`assets/items`), attached to the `handslot` bones |
| Helmets and cape | Parts of the Knight model, shown or hidden when equipped |
| Gloves and boots on the knight | The Knight's hands/feet are recolored by a shader that follows the skinning weights of the hand/forearm and foot/toe/shin bones (`character.js`) |
| Gloves, boots and rings (icons, loot on the ground) | Small procedural models (`gear.js`); the packs have none |
| Sword swings | Generated in code (`character.js`); the free pack has no attack clips |
| Terrain, trees, rocks, grass, water, camps, graveyard | Generated in code (`world.js`), flat-shaded to match KayKit |
| Market stall and stash chest | Generated in code (`town.js`), with the pack's items as wares on the counter |
| Slimes | Generated in code (`enemies.js`) |
| Inventory icons and portrait | Rendered at startup from the same 3D models (`assets.js`) |
| Fire, sparks, slash arcs, glow | Particles, shaders and bloom (`fx.js`) |
| Sound | Synthesized with WebAudio (`audio.js`) |

## Code map

- `src/game.js`: renderer, camera, aim, damage, rewards, save
- `src/input.js`: keyboard, mouse, joystick and touch buttons (also clears keys the browser never "releases")
- `src/player.js`: stats, leveling, inventory, skills
- `src/enemies.js`: monster types, spawn table, AI
- `src/items.js`: item bases (weapons, shields, helmets, capes, gloves, boots, rings), rarities, affixes, loot rolls
- `src/gear.js`: procedural glove/boot/ring models
- `src/town.js`: the camp market: merchant, stall, stash chest, shop stock, buyback, stash transfers
- `src/combat.js`: projectiles and ground loot
- `src/ui.js`, `style.css`: HUD, action bar, minimap, inventory, tooltips
- `src/character.js`, `src/animator.js`: model setup, animation blending, procedural swings

## Adding more art

KayKit's other free packs (Dungeon, Forest, Halloween…) use the same rig and style. The Skeletons pack was added this way:

- **New monster:** copy the `.glb` into `assets/characters/`, add its name to `CHARACTERS` in `assets.js`, and add an entry to `ENEMY_TYPES` and `SPAWNS` in `enemies.js`. The skeleton entries show the options: `offhand` (shield), `style: 'chop'`, `eyes` (glow color), `bolt` (caster projectile color), `loot: 'bone'` (loot table).
- **New weapon or shield:** copy the `.gltf`, `.bin` and texture into `assets/items/`, add the model name to `ITEM_MODELS`, and add a base to `BASES` in `items.js`.
- **Attack animations:** if you get a pack with combat clips (for example Rig_Medium_CombatMelee), drop the `.glb` into `assets/animations/`, add it to `ANIMATIONS`, and call `anim.play('<clip name>')` instead of `startSwing`.

Progress is saved in the browser's localStorage. To start over, run `localStorage.removeItem('emberwood-save-v1')` in the console.
