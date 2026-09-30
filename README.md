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

- **Node.js app** (current): in the hosting panel's "Setup Node.js App", set the application root to the clone,
  the URL to the subdomain, and the startup file to `server.js`. It only uses Node built-ins, so no `npm install` is needed.
  Deploy with `git pull`. Restart the app only when `server.js` itself changes.
- **Static files:** point the subdomain's document root at the clone. `.htaccess` sets the model MIME types
  and cache headers, and blocks web access to `.git`.

## Controls

WASD to move · left click to attack (hold to keep swinging) · 1–4 skills · Q ale (heal) · I bag · mouse wheel to zoom

## Where the graphics come from

| What you see | Source |
|---|---|
| Knight, bandits, cultists, boss | KayKit Adventurers character models (`assets/characters`) |
| Skeleton minions, warriors, rogues, mages | KayKit Skeletons character models (`assets/characters/Skeleton_*`); glowing eyes come from the pack's `Glow` material |
| Bone weapons and shields (skeleton loot) | KayKit Skeletons item models (`assets/items/Skeleton_*`) |
| Walk / run / idle / hit / death / throw animations | KayKit shared rig animations (`assets/animations`) |
| Swords, axes, shields, staff, ale mug | KayKit item models (`assets/items`), attached to the `handslot` bones |
| Helmets and cape | Parts of the Knight model, shown or hidden when equipped |
| Sword swings | Generated in code (`character.js`); the free pack has no attack clips |
| Terrain, trees, rocks, grass, water, camps, graveyard | Generated in code (`world.js`), flat-shaded to match KayKit |
| Slimes | Generated in code (`enemies.js`) |
| Inventory icons and portrait | Rendered at startup from the same 3D models (`assets.js`) |
| Fire, sparks, slash arcs, glow | Particles, shaders and bloom (`fx.js`) |
| Sound | Synthesized with WebAudio (`audio.js`) |

## Code map

- `src/game.js`: renderer, camera, input, damage, rewards, save
- `src/player.js`: stats, leveling, inventory, skills
- `src/enemies.js`: monster types, spawn table, AI
- `src/items.js`: item bases, rarities, affixes, loot rolls
- `src/combat.js`: projectiles and ground loot
- `src/ui.js`, `style.css`: HUD, action bar, minimap, inventory, tooltips
- `src/character.js`, `src/animator.js`: model setup, animation blending, procedural swings

## Adding more art

KayKit's other free packs (Dungeon, Forest, Halloween…) use the same rig and style. The Skeletons pack was added this way:

- **New monster:** copy the `.glb` into `assets/characters/`, add its name to `CHARACTERS` in `assets.js`, and add an entry to `ENEMY_TYPES` and `SPAWNS` in `enemies.js`. The skeleton entries show the options: `offhand` (shield), `style: 'chop'`, `eyes` (glow color), `bolt` (caster projectile color), `loot: 'bone'` (loot table).
- **New weapon or shield:** copy the `.gltf`, `.bin` and texture into `assets/items/`, add the model name to `ITEM_MODELS`, and add a base to `BASES` in `items.js`.
- **Attack animations:** if you get a pack with combat clips (for example Rig_Medium_CombatMelee), drop the `.glb` into `assets/animations/`, add it to `ANIMATIONS`, and call `anim.play('<clip name>')` instead of `startSwing`.

Progress is saved in the browser's localStorage. To start over, run `localStorage.removeItem('emberwood-save-v1')` in the console.
