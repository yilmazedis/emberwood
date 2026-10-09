# Emberwood

A small online 3D action RPG in the browser: make an account and a hero (Warrior, Scientist, Rogue or Healer),
then fight monsters alongside other players, gear up, upgrade your gear at the anvil, trade, and hunt the world
bosses for unique items.
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
automated tests; `&cls=scientist`, `rogue` or `healer` picks the class of a new offline hero). Three.js loads from a CDN, so you need an internet connection.

## Online play

- **Accounts:** username and password. Passwords are stored as scrypt hashes; a signed token keeps you signed in
  for 30 days. Signing in somewhere else signs the older session out.
- **Heroes:** up to 4 per account, any mix of the 4 classes (below), each class with two looks to pick from. Names
  are unique, 3–14 letters (Turkish letters are fine). Heroes from before the four classes were moved over on
  their first visit: Knights and Barbarians became Warriors, Mages Scientists, Rogues stayed Rogues. Their old
  items were sold for them (gold ×3 of their worth), they got their class's gear for their level, some potions and
  camp scrolls, and every skill point to spend; a notice tells them so.
- **Saving:** the game sends the hero's progress (and the account's bank) to the server every few seconds and when
  you leave. If the line drops, the game keeps going and reconnects by itself. Each hero has a revision number that
  a trade bumps, so a save sent from before a trade is refused and nothing is lost or doubled.
- **The shared world:** the monsters live on the server (`src/sim/world.js`): they spawn, wander, chase the nearest
  hero and attack, the same for everybody. You see the other heroes nearby in their class and gear, with a name tag
  and life bar, and what they do (swings, skills, ale, falling and rising). Whether a monster's blow, bolt or slam
  lands is decided by the game of the hero it's aimed at (it knows where that hero really stands, so dodging works);
  the server keeps the monsters' life and shares out each kill (below). Loot is rolled by the game it's given to, and
  only that hero sees it.
- **Places** (`src/maps.js`): Emberwood, three lands beyond the waystones, a dungeon in each, and the Arena. Each is
  its own area on the server, far from the others in the same coordinates, and only areas with heroes in them move
  on, so a new land costs nothing while it's empty. Dungeons are a private **copy per party** (or lone hero), kept
  for five minutes once empty. The server decides travel: you must stand at the waystone, door or stairs, and be
  of the place's level; updates carry a stay number (`ep`) so nothing from the place you left leaks in.
- **Kills are shared:** the heroes who hurt a monster form teams (a party, or a lone hero). The XP is split between
  teams by damage dealt; a party's part goes to its members within 60 m by level, plus 20% per extra member, so
  grouping pays. The team that dealt the most gets the loot; party members take turns. A world boss is fairer:
  everyone who dealt at least a tenth of its damage gets loot of their own too. Everyone credited counts the
  kill for their quests.
- **Parties:** up to 8. Tap a hero's name (or `/invite Name`) to invite; the party frame shows each member's level,
  life and land; `/p` is the party's chat; `/kick`, `/leave`, and the leader can pass the lead. A party shares one
  copy of each dungeon. Parties live on the server (a restart ends them); a member who drops out keeps their place
  for five minutes.
- **Trading:** right-click (or tap) a hero standing near you and pick Trade. The bag opens with the trade beside it:
  click (or tap) items in the bag to put them in, set some gold; any change takes both "accept"s back. When both accept, the server checks that every item and coin is
  really there, swaps them in both saves and tells both games (`server/trade.mjs`).
- **The Arena:** by waystone, from level 5. In its pit every hero but your party is a foe: a blow goes through the
  server (both in the pit, within reach, not party) to the victim's game. The server scales it to 45% of what it
  would do to a monster and takes the victim's armor (and dodge) off it, so both heroes see the same number. A stun
  on a hero is halved (1.5 s at most). Fainting there costs no gold (elsewhere you lose a tenth of your gold). Wins
  and losses are kept per hero (`arena.json` in the data folder) for the champions' board in the arena's yard.
- **Chat:** one world channel (Enter, or the Chat button on phones); nearby heroes also show it in a bubble.
  Last 20 lines are shown to heroes who arrive.
- **Levels:** up to 80. Quick to 10; after that each level asks for more kills of your own level (about 50 at 20,
  130 at 40, 240 at 59; some 5 700 such kills from 1 to 60, plus what quests give). Monsters' life and damage, and what armor takes, grow faster past 10 with the gear.
  No monsters outside the caves are above level 62: from 58 to 80 the **hidden caves** (below) are the way up, one a
  day, a good share of a level each.
- **Away:** a browser stops a hidden tab's frames. With auto-hunt on, the hero keeps hunting there anyway
  (Settings, In the background: Keep hunting, the default; a small worker ticks the game ten times a second,
  without drawing); set to Pause, or without auto-hunt, the hero waits where it stands and monsters leave it
  alone. Phones stop the game in the background whatever the setting.

The server (`server/`, Node built-ins only) speaks JSON over one WebSocket at `/ws` and shows `{"ok":true,…}` at
`/status`. Ten times a second it moves the world on and sends each hero's game what's around it: monsters and heroes
within ~55 m (in full the first time, then only what changed) and what happened. Games show that 0.18 s in the past
so movement stays smooth between updates. The messages have a version (`PROTOCOL` in `src/sim/world.js`): a game
that doesn't match the server asks to reload (or, if the server is the older one, to try again in a minute). Its data lives outside the website, in `$EMBERWOOD_DATA` or `~/emberwood-data`: one JSON file per account
(`accounts/<name>.json`), `names.json` (who has which hero name) and `secret.key` (signs the tokens; keep it private).
To back up, copy that folder.
**Accounts from the terminal** (`server/accounts.mjs`, run in the game's folder on the server):
`node server/accounts.mjs` lists the accounts (their heroes, last sign-in); `password <name>` sets a new password
(passwords are kept only as scrypt hashes: nobody can read one back); `create <name>` makes an account;
`hero <account> <Name> <class> [level]` adds a hero at that level in its class's gear, with potions and gold, every
point free (for testing); `level <account> <Hero> <level>` changes an existing hero's level, nothing else. The tool
never edits the files itself (the running server keeps accounts in memory and would write its own copy back): it
leaves an order in `admin/` in the data folder, which the server carries out within a couple of seconds (no
Restart) and answers. A hero being played when its account changes goes back to the hero list, with a note; its
older saves are refused. If the server isn't running, the order waits for it to start.

## Deploy

Live at https://emberwood.kerimcaglar.com, on DirectAdmin + LiteSpeed shared hosting.

- **Order:** `git pull`, then Restart the game server (most updates change both). Open games notice the new version
  within a few minutes (or at once, through the game server) and show a **Refresh** banner: refreshing saves the hero
  first. When the server's language changed (`PROTOCOL` in `src/sim/world.js`), games reconnecting to the restarted
  server save and reload by themselves. The version is a hash of the game's files in `version.json`
  (`tools/stamp-version.mjs`; `node tools/stamp-version.mjs --install` adds a pre-commit hook that keeps it current). The host only really starts (or restarts) the Node app when an ordinary web request reaches it, and a
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
  After a `git pull` that changes `server/` or the shared files in `src/` (`sim/`, `maps/`, `items.js`,
  `classes.js`, `monsters.js`, `camps.js`, `quest-data.js`…), press Restart for the app.
- **Slow host, slow phones:** the host takes a second or two to answer each request, so the game asks for few:
  every code file at once (`modulepreload` links in `index.html`: list new modules there too), the item models packed
  into one file (`tools/pack-items.mjs`), every dungeon's pieces in another (`tools/pack-dungeon.mjs`, fetched on the
  way to a dungeon door). When a pack changes, give its address a new `?v=` so no stale copy is used. A model download that gets no data for 20 s is dropped and asked for again
  (3 tries), and the game waits up to 20 s for the game server, then tries once more by itself.
- **Hosting test:** `tools/hosting-test` measures whether a host can run the server (see its README). Hyperion passed
  with caveats: it is shared and overloaded, so expect the occasional stutter; a small VPS would remove it.

## Classes

Four classes (`src/classes.js`). Each fights in its own ways, chosen by the weapons it holds, and each has three
skill trees.

| Class | Ways to fight | Strengths |
|---|---|---|
| **Warrior** | Sword (or axe) and shield · two one-handed weapons · one great weapon (two-handed sword or axe, spear, maul) | Most Life and armor; taunts, shields, whirlwinds and huge two-handed blows |
| **Scientist** | Long staff (15% faster attacks, more spell power; the big fire and frost spells) · short staff and a book (the book adds spell power; poisons, curses, party teleport) | Fire and frost from range, the best at many monsters at once; fragile |
| **Rogue** | Two daggers (assassin) · a bow (archer) | Critical hits, the fastest feet; Swiftness (+move speed for 10 minutes) on any friendly hero |
| **Healer** | Mace and shield · a warrior's two-handed sword, spear or maul (not Raptor and the other warrior-only weapons) | Emberwood's doctor: treats wounds, tonics that last 10 minutes, brings round heroes who faint; fights alone with lancets and ether but kills slower than the rest |

Basic attacks: melee weapons swing, bows shoot arrows, staves and short staves fire bolts. Intelligence raises the
damage of spells (a Scientist's and a Healer's, staff bolts too), the class's primary attribute its weapon
blows (below). An archer (hero or monster) raises the bow
upright with the string toward them, draws to the cheek and looses with a twang; the arrow flies head first and
sticks a moment in whatever it hits.

## Attributes

Three attributes, as in Dota 2 (`src/attributes.js`). Every class has a **primary** one that powers its weapon
blows (Warrior: Strength; Rogue: Agility; Scientist and Healer: Intelligence); besides, each does the same for
everyone:

| Attribute | What each point gives | Primary for |
|---|---|---|
| **Strength** | +2 Life (times the class's Life multiplier), +0.03 Life a second | Warrior: +0.6% weapon damage |
| **Agility** | +0.08% attack speed, +0.1 armor | Rogue: +0.6% weapon damage |
| **Intelligence** | +1% spell damage (staff bolts too), +0.1% healing, +2 Mana | Scientist and Healer: +0.6% weapon damage |

A hero starts with its class's (Warrior 24 / 14 / 10, Scientist 12 / 12 / 26, Rogue 14 / 24 / 10, Healer
18 / 10 / 22, in that order) and gets **5 points a level** to spend anywhere, in the character window (+1, +5, or
**Suggested**: Warrior 3 STR 2 AGI, Scientist 4 INT 1 STR, Rogue 4 AGI 1 STR, Healer 3 INT 2 STR). **Take back
all** returns every point for the same fee as skill points. Every level also adds a little of its own (1.4%
damage, Life, Mana and armor), so points are a choice, not a toll.

**Items give attributes**, not bonuses: a weapon has its damage and speed, clothes and shields their armor, and
everything else an item gives is attributes, by its level, its slot (a two-handed weapon or a book most, gloves
least) and its kind (swords Strength, daggers and bows Agility and Strength, staves Intelligence…). Upgrades raise
them like the rest.

**Balance:** with the suggested split each class kills a monster of its level about as fast as before attributes
(within a tenth or so) and lasts about as long (scientists a little longer, still the most fragile). All in on
the primary attribute hits up to a third harder for less Life; a Scientist who takes Strength trades damage for a
third more Life; a Warrior who takes Agility swings faster but hits softer.

## Skills

A hero gets **one skill point per level** and puts it in one of their class's three trees (K, or the Skills
button). A tree's four skills open at 1, 6, 15 and 30 points in it; every point makes its skills 1.2% stronger and
adds the tree's own small bonus. Eighty points can't fill everything: go all in on one or two trees, or spread
out and be good at more but best at nothing. The skill window takes every point back for a fee (free below
level 10). Click (or tap) an open skill to put it on one of the 8 action slots.

| Class | Trees (skills in the order they open) |
|---|---|
| Warrior | **Arms:** Power Strike, Cleave, Charge, Execute · **Guard:** War Cry, Shield Bash, Shield Wall, Last Stand · **Fury:** Battle Rage, Whirlwind, Leap Slam, Earthshatter |
| Scientist | **Pyrology:** Fireball, Flame Wave, Inferno, Meteor · **Cryology:** Ice Bolt, Frost Nova, Blizzard, Glacial Prison · **Alchemy:** Toxic Flask, Blink, Teleport Party, Plague |
| Rogue | **Assassination:** Backstab, Poison Blade, Shadow Step, Eviscerate · **Marksmanship:** Power Shot, Multi-Shot, Crippling Arrow, Arrow Rain · **Shadow:** Swiftness, Smoke Bomb, Vanish, Shadow Mantle |
| Healer | **Medicine:** Treat Wounds, Remedy, Revive, Triage · **Tonics:** Vitality Tonic, Toughening Salve, Painkiller, Aid Station · **Surgery:** Lancet, Vital Strike, Ether Flask, Healing Vapours |

Some skills need a weapon: shield skills a shield, Earthshatter a two-handed weapon, the big staff spells a long
staff, Teleport Party and Plague a book, dagger and bow skills their weapon. Skills cost mana as a share of the
level's mana pool, so they cost the same at every level, and enough that a long fight needs mana potions (mana
comes back slowly, four times faster in a camp). Treatments and tonics go on the friendly hero you picked
(or you); the 10-minute boosts (Swiftness, Vitality Tonic, Toughening Salve) are kept when you log out.
Teleport Party opens a door: every party member, anywhere, is asked whether to step through to the caster.

Stuns, slows, poisons, weakening and the like are applied by the game server, so everyone sees them; bosses shrug
off most of a stun. Each skill is one definition (`src/skills/*.js`) that plays out the same on every screen, and
only the caster's game deals its damage.

**Balance:** with the same level and gear, the classes kill a monster of their level in a few seconds: sword
and shield is the baseline; two weapons, great weapons and daggers are 15–40% faster; the long staff is fastest
alone and on groups; the bow is a little faster and safe at range; a Healer is 10–20% slower with Retribution (and
much slower when built for healing). In the Arena the skills hit heroes at 45%.

## Fighting

- **Targets:** click (or tap) a monster to target it; Z picks the nearest (again: the next). The target's frame shows
  its Life and what's on it (poisoned, slowed, weakened…).
- **Combos:** R (or the sword button) attacks your target. Press again just as a blow lands (the attack slot
  flashes) and the next blow comes faster and harder: four in a chain (×1, ×1.04, ×1.08, ×1.2), +5% for a perfect
  press, and the chain starts over after the fourth. Too early breaks it. A skill cast in that moment is stronger
  too. Holding R (or the button) keeps swinging without the bonus.
- **Monsters that keep their distance** (casters, archers) step back when a hero comes close, but only a moment at
  a time, then stand and fight a few seconds; and a melee blow carries the hero a stride toward a foe backing
  away, so it lands.
- **Auto-hunt:** T (or AUTO) fights the monsters around where you switched it on the way a player would: it chains
  combos (each press as a blow's window opens) and uses the skills on the action bar, each when it makes sense
  (in this order: walls and smokes when hurt, heals for itself or a hurt party member, long boosts that ran out,
  buffs in a fight, skills around it when foes crowd it, area skills on groups or a boss, Execute on a weak foe,
  Charge and Shadow Step to close in, then strikes), in a blow's combo window when it can (stronger). It keeps a
  tenth of its mana for heals and walls, never blinks, opens doors or vanishes, and never starts a fight with a
  hero. It picks up gold and items between fights and drinks a potion when hurt. Moving stops it. With a full bag
  (a red "!" on the bag button) it leaves items where they lie and keeps hunting.

## Items

Every item has a fixed name and fixed stats: a Giant Sword is always the same Giant Sword (`src/items.js`): its
damage and speed (weapons) or armor (clothes, shields), and attributes (above). Items come in three classes, **low**
(levels 1–19), **middle** (20–39) and **high** (40–80; the best are level 50, and monsters past that drop them),
and every hero class has its own weapons and clothes in each. Above them, **rare** items (level 70) only drop in the
Death Canyon (below). Clothes are four-piece sets per class and item class (the Warrior's are
Plate, Chitin and Shell; the Scientist's Linen, Alchemist and Aether; the Rogue's Leather, Stalker and Nightshade;
the Healer's Chain, Apothecary and Physician).

| Class | Low | Middle | High |
|---|---|---|---|
| Warrior | Short Sword, Large Axe, Blade Axe, Giant Sword* | Mirage Sword, Glaive*, Sword of the Dead, Gigantic Axe | Raptor, Iron Impact*, Wyrmfang, Titan Greatsword* |
| Scientist | Oak Staff, Copper Rod, Ember Staff, Galvanic Rod; Field Notes (book) | Frostwood Staff, Alchemist's Rod, Stormcaller, Catalyst Rod; Codex of Elements | Arcanum Staff, Aether Rod, Archmage's Spire, Philosopher's Rod; Tome of Ascension |
| Rogue | Dagger, Short Bow, Kris, Hunter's Bow | Stiletto, Composite Bow, Viper Fang, Longbow | Nightfang, Elven Bow, Soul Reaper, Dragonbone Bow |
| Healer | Iron Mace, Morning Star (and the * weapons) | Bonesetter, Flanged Mace | Lifewarden, Physician's Scepter |

\* Warriors and Healers both can use these. Shields (Round, Kite, Tower) are for both too.

- **Drops are rare:** a monster drops an item now and then (a slime about one time in forty, a knight one in
  fifteen), and the best ones for its level least often. **High class** items are rarer still (most of the times
  one would drop, nothing does: about two kills in a hundred from level 45), and **no merchant sells them**. A boss drops one item, sometimes a recipe too; a chest
  in a dungeon, one now and then. Gold drops often.
- **Accessories:** rings, earrings, necklaces and belts (copper, silver, gold), for every class. Nobody sells them:
  they only drop from monsters.
- **Potions** of a kind all go in one bag slot, however many.
- **Unique items:** only the world bosses (below) drop them, one in five kills, every unique of the boss's item
  class equally likely: weapons, shields, books and accessories, never clothes. They are a quarter stronger
  than normal items of their level.
- **Upgrades:** Brom the blacksmith in Emberwood's camp upgrades items: weapons, shields and books up to **+10**,
  clothes and accessories up to **+7** (normal items start at +1, uniques at +0). Each + adds a tenth of the item's
  main stats. It never fails; each step costs recipes of the item's class (one up to +4, two for +5 and +6, three
  for +7 and +8, four for +9, five for +10) and a small fee. Brom sells the recipes (for now cheaply, while
  upgrading is tried out: low 50, middle 200, high 600 gold); quests, bosses and world bosses give some.
- **Upgrade glow** (`src/enchant.js`), on what a hero holds, for everyone to see: nothing up to +7; at +8 a pink
  aura with sparkles around the weapon's head (a shield's, book's or bow's middle); at +9 the weapon also shines
  in slow pulses; at +10 it shines all the time. A unique item has its own glow at any level.

## Camps

Every land's camp has a **weaponsmith** and an **armorer** (their class's gear up to the land's level), a
**provisioner** (healing and mana potions, elixirs of might, iron and vigor that last 10 minutes, camp scrolls that
take you back to the nearest camp), a **banker**, and a **notice board** with the land's quests. Emberwood's camp
also has **Brom's anvil**. Merchants buy anything you sell, and sell back the last things you sold.

**The bag:** drag an item onto another slot to move it (two items swap places; potions of a kind join up). On a
phone, hold the item a moment, then drag. Nothing is sold by a click: press **Sell…** under the bag, pick the
items (click or tap; they get a red mark and the total shows), then **Sell**. "Sell what you can't use" at a
merchant picks those items for you to check and confirm.

The **bank** is one for the whole account: 60 slots and gold, shared by all your heroes at every banker.

## Quests

89 quests, 22–23 in each land with its dungeons (`src/quest-data.js`). Each is done once: the board offers the
next as you grow and finish earlier ones. They ask for kills, things that drop while the quest is on, places to
find, people to talk to, and a few first steps (spend a skill point, wear a helmet, bank something, upgrade at the
anvil). Rewards are XP, gold, potions, gear for your class and recipes. Accepted quests show under your portrait
with their progress, and their zone gets a dashed gold ring on the minimap; a golden "!" over a board means there's
a new quest or a reward waiting. Any board takes a finished quest back.

## Places

**Emberwood** is where every hero starts: meadows of slimes, a bandit hideout, cultists at the standing stones,
the graveyard and Grok's lair. The crypt door at the east end of the graveyard leads down to **the Forgotten Crypt**
(levels 7–9) and **Morvain the Lich**: bolt volleys, violet grave circles that erupt a moment later (step out!),
skeletons raised at 70% and 40% life, blinking away when you stand on him, enraged below 30%.

The waystone in camp takes you (from level 8) to three more lands, each with five zones, its own monsters, weather,
a camp, a boss who calls for help at 70% and 40% life and rages below 30%, and a dungeon. Every dungeon's boss
room has a **trapdoor down** to a deeper, harder floor with its own boss:

| Land | Levels | Boss | Dungeon (levels, boss) | Deeper (levels, boss) |
|---|---|---|---|---|
| Emberwood | 1 – 10 | Grok the Brute | Forgotten Crypt (7 – 9, Morvain the Lich) | The Bone Pits (11 – 14, the Bone Colossus) |
| Frostfang Highlands (snow) | 10 – 22 | Hrimgar the Frost Jarl | Rimeheart Caverns (20 – 24, Vorrak the Rime King) | The Frozen Deep (25 – 28, Ymira of the Deep) |
| Cinderfall Wastes (ash and lava) | 22 – 40 | Vulkhar the Ashen King | The Molten Forge (38 – 42, Forgemaster Kaldur) | The Magma Core (43 – 46, the Magmaborn) |
| Shadowmere (twilight marsh) | 40 – 58 | Malakar the Hollow King | The Abyssal Vault (56 – 60, Nyxara) | The Void Below (60 – 62, the Void Herald) |

**Hidden caves** (`src/caves.js`, `src/maps/caves.js`, drawn by `src/cave-view.js`): every land hides one, its
mouth in the bushes beside an easy zone. Its **key** drops now and then (one kill in 25) from the monsters within
30 m of the mouth, for every hero credited with the kill whose cave it is; only while a hero carries the key (or its
party's cave is open to it) does the mouth show itself, its bushes parting and a glow pulsing there (a ring on the
minimap too).

| Land | Cave | Heroes (levels) | Its monsters | Keeper |
|---|---|---|---|---|
| Emberwood | Bramble Hollow (by the Bandit Hideout) | 1 – 7 | 3 – 9 | Old Mossjaw |
| Frostfang Highlands | the Rimewell (by the Snowdrift Fields) | 8 – 19 | 10 – 24 | Frostmaw, the Rimewell Warden |
| Cinderfall Wastes | the Ember Vein (by the Ashen Flats) | 20 – 37 | 22 – 42 | the Scorchmother |
| Shadowmere | the Gloamdeep (by the Gloom Marsh) | 38 – 80 | 40 – 80 | the Gloam Stalker |

- **Which cave:** a hero finds (and uses) only the key of the furthest land it may enter: once Cinderfall opens to a
  hero (level 20), Emberwood's and Frostfang's caves are behind it, and a key it still carries for one of them
  crumbles. One key at a time; a key stays with the hero who found it (no bank, trade or sale).
- **Going in:** at the mouth, with the key: the server takes the key out of the hero's save (older saves are
  refused after, as with trades) and opens a private copy of the cave for the hero's **party**. Every member who
  may use that cave is called and can step in from wherever they are (or walk in by the glowing mouth while it's
  open). Alone is allowed, and hard.
- **One a day:** a hero who has been in a cave today (Turkey's day: midnight there) stays out of every other, even if
  its party opens one, and once out (stepped out, or fainted and woken in camp) it doesn't go back in, not even into
  the copy it left. The server keeps the day. Each copy is its party's (or its lone hero's) alone: no other party or
  hero ever comes in. The cave's rules show before going in (at the mouth, with a party's call, and from the key).
- **Ten chambers:** the monsters of each chamber rise as the one before falls silent (its gate of fallen rock
  crumbles); every one of them must fall before the next gate opens. They are elites (30% more Life, 15% harder
  blows, 30% more XP), of the heroes' own level (within the cave's), a level more every three chambers, and the
  tenth holds the cave's **keeper** (three levels up, calling for help) and two of its guards. Each hero in the cave
  beyond the first adds monsters (three more per chamber for every four heroes) and half again their Life (and
  XP), so a party's members earn about what one hero alone would, faster and safer.
- **The reward:** when the keeper falls, everyone in the cave gets **40% of the XP of their next level** (on top of
  the kills), the keeper's treasure opens (gold, potions, often an item and a recipe), and daylight opens a way out
  in its hall.

**The Death Canyon** (`src/maps/canyon.js`, drawn by `src/canyon-view.js`), through a gate of red rock west of
Shadowmere's camp, from **level 70**: a narrow gorge winding north between layered red mountains, from its camp
past five wider chambers (the Red Gorge, the Dragon's Spine, the Scar, the Bone Pass and the Maw) to **Grakhul, the
Canyon Tyrant**. Its monsters, levels 70–78 (Rock Slimes, Dust Stalkers, Canyon Ravagers, Bone Shamans, Canyon
Archers, Scorched Knights), are all **elites**: 40% more Life, 25% harder blows, 40% more XP. Go in alone or with a
party, whenever you like; make a party there too. It is meant to be survived in a party.

- **Heroes fight heroes:** out of its camp, Last Rest (safe: a provisioner, a banker and the gate back to
  Shadowmere; no waystone), every hero not in your party is your foe, as in the arena's pit (blows a little under
  half as hard as on a monster, armor and dodging counted by the server). Fainting there costs a tenth of your gold,
  like anywhere; the canyon's fights aren't on the champions' board, but the canyon hears of each one.
- **Rare items:** only its monsters carry them: **one kill in a thousand** (the Tyrant one in a hundred) drops a
  rare item (level 70, a tenth stronger than a normal item of its level: weapons, shields, books, a set of clothes
  for each class (Warlord, Plaguewarden, Phantom, Stormweave) and Obsidian accessories), and apart from that, one in a
  thousand a **Rare Upgrade Recipe**, the only way to upgrade them (the anvil, as ever). Neither is sold anywhere;
  normal monsters never drop them. Rare items glow in their own colour.
- **Calamities:** every minute to a minute and a half (sometimes after only 30–45 seconds) the canyon strikes the
  heroes out in it (never the camp), and often another follows about ten seconds later. The world picks them, so everyone sees the same; their blows are fixed, not a share of
  Life, so stronger heroes (and parties, healing each other) stand longer:
  - an **earthquake**: the whole canyon shakes for seconds, wearing 45 Life a second off everyone out in it, while
    rocks fall from the walls and fissures burst where red rings show (700 and a stagger)
  - **meteors**: fire falls where red rings show (1000, wide) and the crater burns a while (140 a second)
  - a **lightning storm**: the sky darkens, rain, bolts where blue rings show (750 and a stagger)
  - a **sandstorm**: the sand closes in, hard to see and slow to walk, scouring 75 Life a second until it passes or
    you reach the camp

  The first strike of each falls right by every hero: keep moving.

**World bosses** roam the lands: Gorehorn the Wanderer in Emberwood (low class uniques), Skadi the Frost Giant in
Frostfang (low), Ignis, the Living Pyre in Cinderfall (middle) and Umbra the Devourer in Shadowmere (high). One rises
a few minutes after heroes arrive in a land, and ten minutes after it falls. It walks from zone to zone and never
attacks first, but once struck it fights everyone who hit it and calls for help. It has ten times the Life of the
land's boss and armor that takes a tenth off every blow (its own blows are a boss's): bring a party. Bosses walk
through trees and rocks instead of getting stuck on them. Everyone who dealt at least a tenth of a world boss's
damage, in a party or not, gets their own drop: gold, one item or recipe, and one time in five a unique. The world chat announces when one rises and falls, and a ☠ marks it on
the minimap.

The lands' shapes are in `src/maps/*.js` (an `OutdoorMap` or `DungeonMap` each, shared with the server); `lands.js`,
`dungeon.js` and `arena.js` draw them, and `places.js` switches between them.

## Controls

**Desktop:** left click the ground to walk there (WASD also move) · left click a monster to target and attack it
· Z nearest target · R attack (combos: see above) · 1–8 skills (at your target, at the cursor for areas, at the
friend you clicked for heals) · T auto-hunt · Q healing potion · X mana potion · E talk to people in camp, use
waystones, doors and trapdoors · I (or B, Tab) character and bag · K skills · H help · F full screen · right click a
hero: party or trade · right click an item: everything you can do with it · Enter chat (`/p` party, `/invite Name`) ·
mouse wheel zoom · Esc let go of the target, or settings · M mute. The menu is the row of icons in the bottom right
corner, under the log (what you picked up, gold included).

**Phones and tablets** (switches automatically on the first touch): a floating joystick on the left of the screen
(push a little to walk, fully to run), the sword button (tap for each blow of a combo, hold to keep swinging), six
skill buttons around it, the two potions and AUTO beside them. Tap a monster to target it, a hero for party or
trade. Without a target, attacks and skills go at the nearest enemy. In the bag, tap an item to see it, then Use
or Equip; hold it a moment to drag it elsewhere. Chat opens a line at the top of the screen (the keyboard covers the bottom). The page can't be zoomed
by accident (a quick double tap or two fingers on the buttons used to zoom iPhones in, leaving the game shifted). A
web page can't lock the screen's turning on iPhones; on Android it goes full screen and stays sideways.

## Sound and settings

Everything you hear is synthesized live with WebAudio; there are no audio files.
- **Music** (`music.js`): small synth instruments (harp, pads, flute, bass, bells, brass, taiko drums) play seeded,
  slowly changing patterns, so it never loops exactly. A folk theme in D dorian outdoors, a dark drone with distant bells
  in the crypt, and a drum-driven battle theme whenever a boss is fighting you; they crossfade.
- **Ambience** (`ambience.js`): wind and birdsong in the woods, crows and stronger wind in the graveyard, water by the
  pond, crackling near fires; in the crypt a low rumble, a draft, dripping water and more echo.
- **Settings** (Esc, or the Settings button): music, sound effect and ambience volume, mute, graphics quality (Low, Mid,
  High (the default) or Ultra: below), frame rate (60, or 30 to save battery and keep a laptop or phone cooler),
  camera distance (phones have no mouse wheel), and
  **Leave game**, which saves and returns to the title screen. Online the world doesn't wait while the settings are
  open (offline it pauses); monsters leave a hero alone while the app is in the background, and the sound rests. Settings are kept in the browser
  (`emberwood-settings`), separate from the save.

## Keeping it light

The game never draws more than 60 frames a second (or 30, in Settings), however fast the screen is: a 120 Hz
MacBook used to draw twice as many for nothing. Graphics quality (`QUALITY` in `game.js`):

| Quality | Pixels (× the screen's, at most what it has) | Smoothed edges | Shadows (phones: half, at least 1024) | Glow |
|---|---|---|---|---|
| Low | 1 | none | none | none |
| Mid | 1.25 | 2× | 1024 | small |
| High (default) | 1.5 | 2× | 2048 | half size |
| Ultra | 2 | 4× | 4096, soft | full size |

If frames come late for a few seconds, it draws fewer pixels, but only while that helps: a phone saving power holds
the frame rate at 30 whatever the picture, and then the game goes back to sharp and leaves it for ten minutes.

No browser pop-ups (they take a phone out of full screen and turn it back upright): the game asks its own
questions (taking back skill points, deleting a hero, trades, party invites). Trees, rocks, grass and flowers are drawn in 32 m chunks of the map, so
only what the camera (or the sun, for shadows) can see is drawn: that halved the triangles of a frame. The game's
own code is a fraction of a millisecond a frame; the picture is the work.

The server's world is light too: with 60 heroes moving and fighting in four lands a tick takes about 1 ms (1% of one
CPU core at ten ticks a second), with 150 about 4 ms. Node.js is plenty for this: the world's code is the same
JavaScript the game runs, so the rules live in one place. What limits it first is the host (shared and slow) and the
data sent (about 13 KB a second per hero); a small VPS is the next step up, long before another language would be.

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
| Heroes, bandits, cultists, bosses, the camp's people | KayKit Adventurers character models (`assets/characters`), recolored per class look and per land (`assets.js` repaints the swatch textures) |
| Skeleton minions, warriors, rogues, mages | KayKit Skeletons character models (`assets/characters/Skeleton_*`); glowing eyes come from the pack's `Glow` material |
| Bone weapons and shields (skeleton loot) | KayKit Skeletons item models (`assets/items/Skeleton_*`) |
| Walk / run / idle / hit / death / throw animations | KayKit shared rig animations (`assets/animations`) |
| Swords, axes, daggers, bows, staves, shields, books | KayKit item models (`assets/items`, packed into `items.glb`), attached to the `handslot` bones; maces, spears and mauls are built in code (`gear.js`) |
| Helmets and cape | Parts of the Knight model, shown or hidden when equipped |
| Gloves and boots on the knight | The Knight's hands/feet are recolored by a shader that follows the skinning weights of the hand/forearm and foot/toe/shin bones (`character.js`) |
| Gloves, boots, rings, earrings, necklaces, belts, recipes, potions (icons, loot on the ground) | Small procedural models (`gear.js`); the packs have none |
| Sword swings, the bow draw | Generated in code (`character.js`): keyframed swings; the bow arm, the bow and the string hand are aimed from where the bones are, so the draw fits any model; the free pack has no attack clips |
| Arrows | Built in code (`combat.js`): a wooden shaft, a steel head and feathers in the archer's color |
| Terrain, trees, rocks, grass, water, camps, graveyard | Generated in code (`terrain.js` places them, `world.js` draws them), flat-shaded to match KayKit |
| Market stall, bank, anvil, notice board | Generated in code (`npcs.js`), with the pack's items as wares on the counter |
| The crypt: walls, floors, pillars, stairs, torches, banners, chests, props | KayKit Dungeon models, packed into one file (`assets/dungeon/crypt.glb`), placed on a 4 m grid and merged into two meshes (`dungeon.js`); walls on the camera side are clipped low |
| Morvain the Lich | The Skeleton Mage, scaled up and tinted violet, with a glowing staff; his rune circle is a shader (`dungeon.js`) |
| Slimes | Generated in code (`enemies.js`) |
| Inventory icons and portrait | Rendered at startup from the same 3D models (`assets.js`) |
| Fire, sparks, slash arcs, glow | Particles, shaders and bloom (`fx.js`) |
| Sound effects, music and ambience | Synthesized with WebAudio (`audio.js`, `music.js`, `ambience.js`) |

## Code map

- `src/game.js`: renderer, camera, damage, rewards, helping other heroes, save
- `src/input.js`: keyboard, mouse, joystick and touch buttons (also clears keys the browser never "releases")
- `src/control.js`: targeting, click-to-move, attacking and casting at a target, auto-hunt
- `src/player.js`: stats, leveling, combos, inventory, skill points, buffs, and the looks other players see
- `src/skills.js`: the skill trees, buffs and mana costs; `src/skills/*.js`: the 48 skills, one definition plays
  each for our hero (with the damage) and for others; `src/skillui.js`: the skill window
- `src/sim/world.js`: the shared world the server runs: monster AI, spawns, the crypt, heroes, who sees what
- `src/link.js`: the game's side of it: smooth movement between updates, attacks played out, what we report back
- `src/local.js`: the same world running in the page, for offline play (`?autostart`)
- `src/enemies.js`: monsters as the world reports them (models, animation, their attacks on our hero)
- `src/others.js`: the other heroes (models in their gear, name tags, what they do); `src/chat.js`: world chat
- `src/monsters.js`: monster types and the spawn table; `src/terrain.js`: ground height, zones, what blocks the way
  (with fixed seeds, so the game and the server agree); `src/crypt-map.js`: the crypt's map, walls and paths
  (these three, `classes.js`, `util.js` and `noise.js` are plain data and math, shared with the server)
- `src/items.js`: every item (weapons, clothes, accessories, uniques, potions, recipes, cave keys), tiers, upgrades,
  loot rolls; `src/attributes.js`: what Strength, Agility and Intelligence do
- `src/caves.js`: the hidden caves' rules (shared with the server); `src/maps/caves.js` their plans;
  `src/cave-view.js` the caves and their mouths, drawn
- `src/maps/canyon.js`: the Death Canyon (shared with the server: its calamities are picked in `sim/world.js`);
  `src/canyon-view.js` draws it and its calamities
- `src/gear.js`: procedural models (maces, spears, mauls, gloves, boots, accessories, potions, recipes)
- `src/enchant.js`: the glow of a held item upgraded to +8, +9 or +10
- `src/camps.js`: who stands in each camp (shared with the server); `src/npcs.js`: the camp's people drawn, their
  stock, buying, selling and the anvil; `src/bank.js`: the account's bank
- `src/trade.js`, `server/trade.mjs`: trading between heroes
- `src/dungeon.js`: the dungeons drawn: their pieces, torch lights, chests, the way in, out and down;
  `src/maps/depths.js`: the deeper floors
- `src/audio.js`, `src/music.js`, `src/ambience.js`: sound effects, generative music, ambience (mixer and volumes in `audio.js`)
- `src/settings.js`: saved player settings
- `src/classes.js`: the playable classes (shared with the server)
- `src/net.js`, `src/account.js`: the connection to the game server, and the sign-in / hero screens
- `server/`: the game server (`main.mjs` messages, `store.mjs` accounts on disk, `auth.mjs` passwords and tokens, `ws.mjs` WebSocket)
- `src/quest-data.js`: every quest; `src/quests.js`: the notice boards, progress and rewards
- `src/combat.js`: projectiles (arrows too) and ground loot
- `src/ui.js`, `style.css`: HUD, action bar, minimap, inventory, tooltips
- `src/character.js`, `src/animator.js`: model setup, animation blending, procedural swings

## Adding more art

KayKit's other free packs (Forest, Halloween…) use the same rig and style. The Skeletons pack was added this way:

- **New monster:** copy the `.glb` into `assets/characters/`, add its name to `CHARACTERS` in `assets.js`, and add an entry to `ENEMY_TYPES` and `SPAWNS` in `monsters.js` (then restart the game server). The skeleton entries show the options: `offhand` (shield), `style: 'chop'`, `eyes` (glow color), `bolt` (caster projectile color), `loot: 'bone'` (loot table).
- **New weapon or shield:** copy the `.gltf`, `.bin` and texture into `assets/items/`, add the model name to `ITEM_MODELS` in `assets.js`, add an item to `items.js`, then repack: `node tools/pack-items.mjs` (it packs every `ITEM_MODELS` model into `assets/items/items.glb`, which the game loads instead of the ~50 separate files).
- **More crypt pieces:** name any Dungeon pack model in `crypt-map.js` (e.g. `put('barrel_large', x, z)`), then repack:
  `node tools/pack-dungeon.mjs "<KayKit_Dungeon_Pack_1.1_FREE>/Assets/gltf"`. It writes every model `dungeon.js`
  names into `assets/dungeon/crypt.glb`, one file instead of ~80 (the host is slow to answer each request).
- **Attack animations:** if you get a pack with combat clips (for example Rig_Medium_CombatMelee), drop the `.glb` into `assets/animations/`, add it to `ANIMATIONS`, and call `anim.play('<clip name>')` instead of `startSwing`.

Heroes are saved on the game server. Offline play (`?autostart`) saves in the browser's localStorage instead; to
start that over, run `localStorage.removeItem('emberwood-save-v1')` in the console.
