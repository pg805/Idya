# Idya 0.3.0 — The World

Status: **planning**. Nothing here is built yet. This is the frame for 0.3.0 and
the plan for getting there.

## What this is

0.3.0 puts everything on **one persistent world map** and makes the game a live
social space: players in it at the same time as each other, running it themselves.

The biggest change isn't technical. It's that **the automatic parts of the game
become people.** No NPCs. No NPC shops. No self-running market. Players hold the
professions, players run the shops, players set the prices, players give each
other work. The GM's own character is the first shop in the world.

The combat and crafting systems survive as *numbers* — the resolution engine, the
damage budget, the recipes, the professions all still work. What changes is that
people operate them instead of the server.

This is the direction `CLAUDE.md` already commits to — "a place players share, not
a world simulated around one player" — followed the rest of the way.

### Sessions

The driver is **GM-run sessions**: whenever the GM has time to hop on and do
things. Weekends are the plan for now, but that's a schedule, not a rule.

Sessions are when the world is *litigated* — goals get announced, quests get
handed out, players propose systems, disputes get settled, things get built.

But the world doesn't freeze between them. Once players are running shops,
commerce happens whenever those players are online. A shop is open when its owner
is around. That's the point: sessions move the world forward, players keep it
alive.

### The first session

A near-empty field with a few tents. The GM lays out the goal for the area —
*build a mine* — and what that needs: infrastructure, farms, resources taken from
the wildlife and the land. Quests go out. Players talk about how to accomplish
them with the systems that exist, and propose the ones that don't.

> **TODO (GM):** the *why* behind the mine. Who is it for? What are the economic
> and social pressures that make building it urgent, and make the people in the
> field care? This is the motivation layer the current world doc is missing, and
> it's what turns a task list into a reason to play. Being written separately.
>
> This is the same writing job as the **forces** in §11 — the pressures that make
> the mine urgent are what characters pick a relationship to at creation. Write it
> once, use it twice.

## What survives, what changes, what's new

| | |
|---|---|
| **Survives** | Postgres + Prisma, the combat resolution stack (`resolveIntents`, AI planner, damage types, budget tooling, sims), crafting recipes, professions, upgrades, enchants, the tileset/terrain renderer, the Idya Pixel font, the board/grid engine |
| **Scrapped** | The automatic economy — NPC shops, server-driven price ticks, stock rolls. The orchard, outright. |
| **Changes frame** | Combat is entered from a place on the map instead of being the front door. Shops become player-run storefronts with owner-set prices. Global quests get folded into a real quest-giving system. Numbers across crafting/professions/drops are **up for change** once players are the ones moving goods. |
| **Genuinely new** | Web-native identity, location-based in-character chat, the persistent world map, the GM console, the application system, land + buildings, farming, party combat, deal-making |
| **Goes away** | Discord as the front end and as the identity provider. The bot **stays for announcements** — updates and things that genuinely matter — but not granular per-fight, per-enchant, per-craft noise. That all moves to in-world chat. |

## Combat

The existing round structure stays. `resolveIntents` is already simultaneous —
every unit submits an intent and the whole round resolves at once — so party
combat is collecting N intents from N sockets instead of one socket plus
`choosePlan`.

**Round timer:** open, but likely worth it. With a lot of people in one fight,
waiting on the slowest player is the failure mode. A countdown on the intent
phase (length TBD, GM-adjustable) solves it. Whether it's always on or only above
a player count is a design call.

---

## The open question underneath everything: how real-time is the world?

This is unresolved and it's upstream of several decisions below, so it's worth
holding open deliberately rather than picking early.

**What counts as canon?** If a session is happening in a Discord voice call and
someone says something there — is that in the world, or is only in-world text
canon? The answer shapes how much of the game has to actually be *in* the game.
Text-is-canon means the client has to carry the whole session. Voice-is-canon
means the client is a board and a ledger and the fiction lives in the call.

**Does movement outside combat happen in real time?** If the world is a grid,
real-time movement is probably the answer that makes sense — you walk, others see
you walk. But that opens the next question immediately:

**What does proximity let you do?** Once people occupy positions near each other
outside of combat, "nearby" becomes a mechanic. Who can you talk to, trade with,
follow, block, steal from, attack? Chat is already location-based (below), which
is the first instance of this. Everything else — trading, shops, pickpocketing,
whatever gets applied for — inherits whatever proximity rules get set here.

These need thinking through before Phase 2 hardens.

---

## Systems

### 1. Identity and accounts — the blocker

Divorcing Discord is bigger than swapping a login button, because **`discord_id`
is the primary key for every player-owned thing in the database**. It's the `@id`
on `User`, and it's carried as a loose string on `Character`, `KorelLedger`,
`BattleLog`, `EventLog`, and `ShopTransaction`.

Auth tokens are also two in-memory `Map`s built with `Math.random()`
(`src/server/index.ts:73-75`). **Every deploy logs out every player.** With a
push-to-dev workflow that's several times a day, and it's an outright blocker for
running a session.

The plan, in order:

1. **A fresh internal `account_id` (uuid), separate from the Discord id.** Not the
   Discord snowflake reused. A third-party identifier as the internal primary key
   leaks into every table and API response, is publicly resolvable to a Discord
   profile, is enumerable, and becomes a lie the moment someone unlinks Discord.
   Generate new uuids for everyone, existing players included.
2. **An `Identity` table** mapping `(provider, provider_user_id) → account_id`.
   Backfill one `('discord', <id>)` row per existing user, so current players keep
   their stuff and their Discord login keeps working. Build it for N providers on
   day one — the lesson of this divorce is *never have exactly one identity
   provider again*.
3. **Persist sessions.** A `Session` table (or signed cookies). Restart-survivable.
   This is the actual unlock.
4. **Then add Google OAuth** as the first new provider, plus an email magic-link
   as the escape hatch for anyone who won't hand over a Google account.

> **⚠ Migration landmine.** `discord_id` is a primary key with a real FK from
> `Character`. If you rename or retype the field in `schema.prisma` and run
> `prisma migrate dev`, Prisma's differ emits `DROP COLUMN` + `ADD COLUMN` and
> **destroys every account on the shared production database**.
>
> Do it **additively**, never as a rename: add `account_id` alongside the existing
> column, backfill it, add and backfill the matching column on each dependent
> table, cut the FKs and the code over, and only drop the old column once
> everything reads the new one. Nothing is destructive until after the cutover.

**Do this now, not later.** Six tables reference the identity today. Land,
buildings, chat, farm plots, applications, guilds, and shops will all reference it
too. The migration only gets bigger.

### 2. Chat

**All chat is in character, and all chat is location-based.** There is no global
channel and no guild channel. Discord remains the out-of-character room.

The design goal is to **mimic being in a place**:

- You hear what's said near you. Stand in an empty area and you hear nothing.
- Conversations belong to locations, not to groups. A guild talks by being in the
  same room, same as anyone else. If guild coordination at a distance turns out to
  matter, it should cost something in-world (a system someone applies for) rather
  than being a free channel.
- Range is a real parameter and ties directly into the proximity question above.

**Persistence:** messages persist to the database for history — logs, moderation,
being able to look back at what happened in a session. But that's a record, not a
feed. You don't get scrollback for a room you weren't standing in.

**Moderation:** GM can mute, time out, and delete. Blunt is fine; the population
is small and the GM is present.

Text only. No voice.

### 3. The world map

**A world map that sets the scale**, hand-authored where it matters and filled in
with generated terrain everywhere else.

- **The town is authored.** Being designed by hand now. Authored tiles override the
  generator.
- **The wilderness is generated**, and it doesn't need to be bespoke — a patch of
  forest can be whatever the generator says it is.
- **But it has to be the *same* patch of forest next time.** `terrain.ts` already
  generates deterministically from a seed (`src/combat/terrain.ts:67` — *"Same seed
  => same board"*), so `chunkSeed = hash(worldSeed, chunkX, chunkY)` gives stable
  terrain for free, with no storage.
- **And changes stick.** This is the part that matters most. If a bear knocks down
  a tree, that tree is down when you come back. Players can clear it, repair it,
  build over it. Stored as **sparse diffs** over the generated base — changes come
  from players *and* from world events, and eventually from players building their
  own towns out in the world.

So: derived terrain, persistent consequences.

#### Buildings and the town's size

**Buildings are 64×64px — exactly 2×2 tiles** on the existing 32px grid. That's a
general rule, not a per-building decision.

Convenient consequence: the **2×2 footprint engine already exists**. It was built
for multi-square units (melbear and sulgovenath), and the placement, collision, and
occupancy logic ports straight to buildings. See `enemyFootprintSize` and the
footprint work already on `dev`.

**Plots are larger than the buildings on them** — likely **3×3** around a 2×2
building. The five leftover tiles are the yard, and that's useful rather than
decorative: it's where a farm plot goes (§9), or a market stall, a workbench, a sign.
It gives homes a reason to exist beyond storage, and it means a plot's owner has
something to *do* with their land the moment they claim it.

Rough first-town composition: **~10 shop plots, ~20 home plots**. Which sizes the
town:

- 30 buildings × 2×2 = **120 tiles of pure footprint**
- With frontage and access, a plot is realistically ~3×3 or 3×4 → **~270–360 tiles**
- Plus streets, a square, the field and its tents, and edges → **~450–600 tiles**
- That's roughly a **22×22 to 24×25 tile town**

For scale: a combat board is **12×10 = 120 tiles** (`HUNT_BOARD_W/H`,
`src/server/index.ts:282-283`). So the town is about **four to five combat boards'
worth of ground**.

> **⚠ Chunk size — the town decides it, not the other way around.**
>
> The instinct was to close chunk size before drawing the town. It's actually the
> reverse: a chunk should be **the largest thing worth authoring as one seamless
> piece**, and that thing is the town. A seam running through the middle of a
> hand-drawn town is the one outcome to avoid.
>
> So: **draw the town at whatever size feels right, then set the chunk to fit it.**
> Around 24×24 (~576 tiles, a 768×768px canvas) is comfortable to render and lands
> at roughly 2×2 combat boards. Nothing about the renderer objects to that.
>
> This unblocks the map work — the town design isn't waiting on a technical
> decision, it's making one.

### 4. The GM console

Makes the GM a GM rather than someone with database access. Mostly thin — admin
endpoints over systems that already exist.

**It needs everything the archived Discord admin/dev commands did**, at minimum
(`archive/discord/commands/admin/admin.ts`, `.../dev/dev.ts`):

- `giveweapon`, `givekorel`, `giveitem`, `giveprofession` (user + level)
- `joinsim`
- `resetcharacter`

Plus the session-running functions that never existed:

- **Announce** — to a location, to everyone, in-fiction or out.
- **Issue a quest** — to a player, a group, or everyone.
- **Spawn** — an encounter, an enemy, an object, at a coordinate.
- **Place** — drop a building or a landmark onto the map live, mid-session.
- **Move** — teleport a player, or everyone, somewhere.
- **Watch** — presence roster, who's in what fight, live event feed.
- **Review** — the application queue.
- **Set price bounds** — see Shops.

There's already an `isDev()` gate in `src/server/index.ts` and a dev tab
(`/dev/replay`, `/dev/stats`, `/dev/matrix`) to build alongside. The dev pages
should fold into this console rather than staying a separate surface.

### 5. Applications

Players submit a proposal — a new system, a mechanic, an asset — through a form in
the web client. It lands in a queue. The GM reads it, discusses it in session, and
if it's good, **it gets built in TypeScript like anything else**.

**The GM always has final say.** No exceptions, no automatic acceptance thresholds.

**The more work an application takes off the GM's plate, the more likely it ships.**
That's the stated, advertised incentive: art attached, numbers already balanced,
edge cases thought through, a clear spec. A good application is most of a design
doc.

**Applications don't have to be nice.** "Pickpocketing" is a perfectly good
application. If it's fair and it's interesting, it can go in. Players can propose
adversarial, exploitative, or outright villainous systems — that's a feature. It
just isn't something to advertise directly; what gets advertised is that the system
is **intentionally very open ended**.

**Payoff:**
- **Credit** — shipped applications name their author where players can see it.
- **Custom items** tied to the accepted idea.
- **Possible exclusivity** — the applicant gets first or sole access to what they
  proposed, where that makes sense.

Three kinds:

- **System applications** — prose proposals. Status track:
  `submitted → discussed → accepted / declined → shipped`. Public, so the queue
  itself is social content.
- **Asset applications** — a PNG meeting the tileset spec. The easy half; the
  pipeline already exists (`npm run tiles:sync`, the Asset Library and its
  `build-tilesets.lua`). Accepted assets become world tiles or alternate skins for
  existing systems.
- **Character applications** — see §11. Same queue, same review, different stakes:
  what's being approved is a character's place in the world's canon.

**v1 is a form, a table, a review queue, and the GM.** Explicitly *not* an in-game
scripting language, a mod loader, or a sandbox. Players never execute code on the
server. The ownership comes from seeing your idea ship with your name on it.

Specifics still to work out: submission format, how much structure to require,
whether declined applications stay visible, how exclusivity is represented.

### 6. Shops, prices, and the economy

The automatic market is **scrapped**. No NPC vendors, no server-driven price
discovery, no stock rolls.

- **Players run shops.** A shop is a storefront owned by a character, and it's open
  when its owner is around.
- **Owners set prices.** Something close to the existing shop interface — that
  basic buy/sell surface is fine — but with prices as a tunable the owner controls
  rather than a number the server computes.
- **Price floors and ceilings, set by hand.** Probably heavy-handed at first: the
  GM sets min/max bounds per item and adjusts them as things shake out. Crude is
  fine; it's a guardrail against a broken opening market, not a simulation.
- **The economy becomes organic.** Value gets discovered by players trading with
  each other, not by a price curve.
- **Existing numbers are provisional.** Crafting costs, drop rates, profession
  pacing, korel sinks — all tuned against a server-run market that no longer
  exists. Expect to move them.

The existing market tables (`ShopItemState`, `ShopPriceTick`, `ShopTransaction`)
mostly become player-shop tables or go away. `ShopTransaction` is worth keeping as
a ledger.

### 6a. The korel faucet — the GM is the mint

With NPC shops gone, **player-to-player trade only moves korel around; it doesn't
create any.** Something has to mint it. **Decision: the GM does**, going into
session one.

- **Quests are the main faucet.** GM-assigned work pays big. That makes money
  supply a deliberate lever pulled during sessions rather than a byproduct of
  grinding, and it gives quests real economic weight — the reason to do the GM's
  work is that it's where money comes from.
- **One shop stays always open**, with deliberately **low korel** — a trickle, not
  a living. It's the floor: somewhere to offload raw material when nobody's around,
  priced badly enough that selling to a real player is always better. It keeps the
  world from going fully dead between sessions and gives brand-new players a first
  few coins without the GM present.
- **Eventually other shops mint too**, as players accumulate and re-spend. The GM
  stays the primary source, but not the only one.

The thing to stay conscious of: a session where the GM hands out nothing is a
session where the economy contracts. Money supply is now something to *watch*, and
the always-open shop's rates are the emergency valve if it gets too tight.

### 7. Quests and deals

Global quests get folded into a **real quest-giving system** rather than staying a
standalone tab. The existing collective deposit-for-reward mechanic is a good
primitive; it becomes one quest *type*.

The GM issues quests live from the console — to a player, a group, or everyone.

**Later: deals.** Players give each other work. A deal is a player-authored
agreement — do this, get that — with the system holding the terms and the escrow so
it doesn't run purely on trust. This is the natural endpoint of a player-run
economy, and it's the thing that makes professions into livelihoods rather than
menus. Design work not started.

### 8. Land and buildings

- **Parcels** — a claimable region of the map with an owner. Bought with korel; also
  a much-needed currency sink.
- **Buildings** — placed on an owned parcel. Homes, shops, workshops, farms. An
  entity at a coordinate with a type and state.
- **Shops are buildings.** People physically walk to your storefront. This is the
  strongest tie between the economy and the world.
- Eventually, players founding their own settlements out in the wilderness.

### 9. Farming

New system: **seeds + time**. (The orchard is scrapped, not migrated.)

- Seeds are planted on **owned world tiles**, not in a menu. Your farm is a place
  on the map people walk past.
- Growth stages render on the map. Tending as optional interaction.
- Harvest yields materials that feed crafting and the mine goals.

> **⚠ Pacing warning.** The default instinct for seeds-and-time is uniform
> 8/12/24-hour crops, which quietly turns the game into a daily-check-in chore and
> punishes exactly the player this design is for — someone who shows up when the GM
> is running a session.
>
> **Likely answer: a spread.** Some crops in hours, some in days, some in weeks.
> Short crops reward being around; long crops reward planning across sessions; the
> mix means no single login rhythm is the "correct" one. Exact durations TBD, but
> the principle is that timers should never make absence feel like a penalty.

### 10. Guilds

Player-created groups: membership, a name, a shared identity. **No guild chat** —
guilds talk by being in the same place, like everyone else.

Their real mechanical role is **gating**. Some things are gated by profession, some
by guild:

- Professions gate crafting and upgrading, as they do today.
- **Guilds gate abilities and systems.** If pickpocketing gets applied for and
  accepted, maybe only the thieves' guild can do it. Guild membership becomes a
  key to a body of systems rather than a social label.

That makes guild choice meaningful and makes accepted applications a natural way to
grow guild identity — a guild is partly defined by what its members successfully
applied for.

Shared land and guild halls come later.

### 11. Characters, canon, and the forces at play

Story and canon get made in play, but that only works if there's something to make
it *against*. Players need larger forces their characters have a stance toward —
otherwise everyone is a freelancer with no reason to care about the mine or about
each other.

**Not a world bible.** Nothing Dwarf Fortress-shaped, and nothing that has to be
finished before session one.

**Instead: a handful of forces.** Three to five, each with a name, a want, and a
pressure it exerts on the field. That's it — a paragraph apiece. They're the
answer to "why the mine, and for whom," and they're what characters pick a
relationship to. Same lore layer serves both jobs, so it only has to be written
once.

Forces stay deliberately thin at the start and **grow through play**: what they
turn out to want gets decided at the table, not in advance. Sessions add to them.

**Character creation becomes an application.**

- **Choose** a relationship to one or more forces from the authored list — backing
  it, owing it, hiding from it, indifferent to it.
- **Write something.** Required prose, not a name and a sprite. The point is the
  small commitment: someone who wrote three paragraphs before their first fight
  shows up differently than someone who clicked through.
- **The GM reviews it**, same queue as the other application types.

There's already scaffolding for this in the schema — `Character` carries
`nationality`, `faction`, and `bio` (`prisma/schema.prisma:21-40`). `faction` was
built to gate the now-archived NPC dialogue; it's the natural field for a
character's relationship to a force.

> **⚠ Don't let this gate play.** An approval queue on *making a character* means
> an excited new player waits for the GM before they can do anything, which is the
> worst possible first impression.
>
> **Approval should grant standing, not access.** Let people play immediately with
> a provisional character; what the review decides is whether their backstory
> enters canon, whether their claimed affiliation is honored, and whether the GM
> picks it up as a thread. That keeps the incentive to write well — approved
> characters get hooks, quests, and recognition — without making the door a
> bottleneck.

The GM payoff is the real reason to do this: a character who wrote that they're
fleeing a debt to one of the forces *is* a quest thread. Character applications are
where the GM's session prep comes from.

**Creation is also the teaching moment.** The problem isn't only that people should
*care* about the forces — it's that walking in without understanding what you're
walking into is a bad experience. Right now "aligned with the empire" doesn't mean
anything to a new player because nothing makes them find out.

Being made to choose is what makes someone read. So creation should present the
forces properly — what each wants, who it's at odds with, what siding with it costs
— rather than as a dropdown of names. The forces also belong on the in-client lore
page (`/app/lore`, served from `docs/lore/world_player.md`), with creation linking
into it. Comprehension is an onboarding problem, and creation is the only moment
you're guaranteed to have someone's attention.

#### Standing

**Standing is the third gating axis**, alongside profession and guild:

| Axis | Gates |
|---|---|
| **Profession** | Crafting and upgrading |
| **Guild** | Abilities and systems (the thieves' guild and pickpocketing) |
| **Standing** | Access, content, prices, and whose side of the world is open to you |

Standing with a force is earned and lost through play — quests taken, quests
refused, who you traded with, what you did in a session. It's a natural gate for a
lot: which quests you're offered, which buildings admit you, what a shopkeeper
charges you, which parts of the map are hostile, whether a guild will have you.

It also solves the character-application incentive cleanly. Approval isn't
permission to play — it's **starting standing**. A well-written character with a
clear stance begins the world already meaning something to somebody; a thin one
starts at zero and has to earn it in play. Same incentive, no door.

### 12. Death and stakes

Under consideration: **permanent character death**. The instinct is right — combat
currently has no consequence, so nothing that happens in it matters. But permadeath
sits in direct tension with everything else here, and the tension is worth stating
before picking a shape.

**The tension.** This design is built on accumulation: standing with the forces,
professions (rank 10 is ~600–2300 fights per `pacing_sim`), land, buildings, a
shop, guild membership, and prose someone actually wrote. In a roguelike, death is
a reset and that's the whole game. Here, death is a *demolition* of months of
investment. Permadeath makes a game with no persistence exciting and a game built
on persistence miserable.

**The way out is to separate what dies from what persists.** Death should be a
**succession event**, not a deletion:

- **Holdings outlive the person.** Land, buildings, and shops pass to an heir, a
  guild, or back onto the market. This is the part that makes death *content* — an
  estate, a vacancy, a contested storefront, a guild suddenly short a blacksmith.
  Permadeath in a world with property is a succession drama, and that is exactly
  the kind of thing that puts players in contact with each other.
- **Standing partly inherits.** A successor isn't a stranger to the forces, but
  isn't you either. Good gradient.
- **Professions are the hard case.** Losing rank 10 to one bad fight is punitive,
  not dramatic. Either professions attach to the *account* rather than the
  character, or they partially carry, or the rank grind gets much shorter. This has
  to be answered before permadeath can ship.

#### The injury ladder

Losing a fight doesn't kill you; it injures you. Death is what happens if you keep
losing.

| | |
|---|---|
| **Scale** | Injury level **0–6**. A loss is **+1**. |
| **Level 4** | A consequence kicks in — TBD (options below). |
| **Level 6** | Death. |
| **Natural healing** | Rest. Working figure: **3 levels a day**. |
| **Paid healing** | A player-run healing service — pay someone to clear injury faster. |

**The numbers work out sanely.** Healing 3/day against a threshold of 6 means a
full recovery is two days, and a player who loses three fights a day never dies —
they heal it back. To die you essentially have to lose **six fights in a burst**,
which is a stubborn player grinding an enemy well above their level and refusing to
stop. That's the right failure mode: death is self-inflicted and earned, not
ambient, and it lands on exactly the recklessness that should carry stakes.

**Tick it, don't lump it.** "3 a day" as a once-daily batch makes timing matter a
lot and can leave someone stuck for arbitrary reasons. The same rate as **1 level
per 8 hours** is smoother, has no cliff, and never makes a player wait for a
specific clock time.

Worth noting this timer is the *good* kind, unlike crop timers: **absence is the
cure**. Someone who plays once a week always arrives healthy; someone grinding all
day gets throttled. That's a natural brake, and it's aligned with the session
rhythm rather than fighting it.

> **⚠ The one real problem: being benched during a session.** Sitting at injury 5
> when the GM is running a session means being locked out on the single day things
> actually happen — the worst possible time.
>
> Two fixes, and they're both good:
>
> 1. **Injury gates combat risk, not participation.** Being hurt should mean
>    *fighting again risks death*, not "you can't do anything." Trade, talk, farm,
>    build, attend — all still open. You're in the session, just not in the fight.
> 2. **This is exactly why paid healing exists.** Sessions create a demand spike
>    for healers precisely when players most want back in. That gives a healing
>    service a real business, driven by the game's own rhythm, and it's one player
>    needing another player — which is the whole point.

**Death must never be a surprise.** Injury level has to be visible and the warning
at 5 has to be loud. A player walking into a fight not knowing it could be their
last is the version of this that feels cheap.

**Options for the level-4 consequence:**

- **Reduced max HP** — the classic. Note it creates a death spiral: hurt, so you
  lose more, so you get hurter. That's fine *here* because the exits are clearly
  marked (rest, or pay a healer) and it only bites after three ignored warnings. A
  spiral is only unfair when there's no way out.
- **Reduced movement** — the cheapest to build. Action type 14 (Move Debuff) and
  `effectiveMove` in `combatant_state.ts` already do exactly this.
- **Visible injury** — a limp, a bandage, a changed sprite. Worth doing *alongside*
  whichever mechanical penalty is chosen: it makes injury legible to other players,
  which is how someone gets offered or sold help. In a game about players
  interacting, making state visible is how interaction gets triggered.

Recommendation: a mechanical penalty **plus** the visible one.

**Death should be adjudicated, not rolled.** With a GM present, "you died because
you did something reckless and I called it" is satisfying. "You died because the
damage roll came up Hd4" is infuriating — and genuinely possible, given how much
variance the weakness/resist roll modes carry. Random permadeath teaches players to
never take risks, which is the exact opposite of stakes.

**Consider opting in.** Marked dangerous zones or marked quests where death is real
and the rewards match. Lets permadeath exist without being ambient, and makes
courage a choice rather than a tax.

> **⚠ Sequencing: don't ship this at session one.** Permadeath needs an estate to
> be dramatic. At session one nobody owns anything, has no standing, and has no
> heirs — so a death is just "delete your 20 minutes," which is the punitive version
> with none of the drama.
>
> Ship **consequence** first: the injury ladder, real loss, lasting wounds. Add
> permadeath once there's enough accumulated in the world that a death is a story
> other players are involved in.

Also unresolved: death is an **economic** event too. Inventory, korel, and shop
stock have to go somewhere. Looting, escheat to the guild, an estate sale — all
plausible, all systems, and a good candidate for an application.

### 13. The Cleric — and service professions

Healing belongs to a **Cleric** profession: the fourth, and the first of a new
*kind*. LJ, BS, and EN make **things**. The Cleric provides a **service**. That
opens a category worth naming, because it's the obvious shape for a lot of what
players will apply for later.

**The Cleric doesn't craft weapons or weapon parts** — it's a service profession,
and its craft output is consumables. (An earlier draft argued this structurally,
because a fourth weapon-crafter would break the L3/L4 dependency triangle. §14
removes that triangle entirely, so the constraint is now just what the profession
*is*, not geometry.)

**The "crafts less" tradeoff already exists — no new mechanic needed.** Profession
level cost is keyed to your *combined* level across all professions
(`levelCost(combined)`, `src/server/index.ts:1751`), and ranks 8–10 are already a
wall. Adding a fourth profession under that same curve automatically means spreading
yourself thin gets expensive, so people realistically take one or two high. The
interdependence falls out of the existing cost curve rather than a cap.

#### What healing should cost

The instinct — healing costs the healer korel or resources — is right, but the
choice between them matters a lot.

**Recommendation: healing consumes a consumable the Cleric crafts** (a salve, a
remedy), whose inputs are farmed. Not raw korel. That gets three things at once:

1. **A supply chain that puts three players in contact.** Farmer grows the
   reagent → Cleric crafts and applies the remedy → fighter gets back in the fight.
   Three roles, all needing each other, which is the whole design goal.
2. **Something to do when nobody's hurt.** A pure on-demand service starves in a
   small population — no injuries, no income, and at session zero that's most of the
   time. Craftable remedies can be produced ahead and stockpiled, so a Cleric
   *always* has work.
3. **Farming gets a demand sink it currently lacks.** As specced, crops feed
   "crafting and the mine goals," which is vague. Healing reagents are recurring,
   non-optional demand — the thing that turns farming from a materials faucet into a
   livelihood.

Korel still changes hands, of course; the patient pays. The point is that the
Cleric's *cost basis* is material, so pricing has a floor and healing isn't pure
rent on an unavoidable need.

#### The GM bootstraps every service

Worth stating as a general principle, since it applies well beyond healing:

**The GM starts out able to do everything, and hands each capability off as players
take it up.** The first shop is the GM's. The first healer is the GM. Over time the
town gains its own shopkeeper, its own Cleric, its own farmer.

That's not a stopgap — it's content. "The town now has its own healer" is a visible
milestone, it gives players something concrete to aspire to own, and it means the
world can be seen developing rather than just accumulating features.

#### Faith and allegiance

The Cleric is **religious, but "religious" is general** — a vocation practised
across a variety of forces rather than the priesthood of one church. Which force a
Cleric serves is a separate axis from the profession itself.

That separation does a lot of work cheaply:

- **One profession, many allegiances.** No per-force profession trees, no forked
  progression. A Cleric of one force and a Cleric of another have identical
  mechanics and different meanings.
- **It's the first place standing and profession intersect**, which makes it the
  template for service professions that come later.
- **Differentiate by flavor, not balance.** Same remedy mechanically, different
  name and sprite per faith. Identity for free, no tuning work.

> **Surface standing; don't enforce it.** The tempting move is to have the system
> refuse treatment based on the patient's standing with the Cleric's force. Don't.
> If the rule refuses, it's bureaucracy. If the *Cleric* refuses, it's character.
>
> Show a Cleric the patient's standing with their force and let them decide who they
> treat and what they charge — the same principle as letting shopkeepers set their
> own prices. A healer who turns away an enemy of their god is a story; an error
> message is not.

**Clerics can heal themselves**, at the same material cost as anyone else. Otherwise
the profession is strictly safer than the others and that distorts profession choice.

> **⚠ Natural healing is the anti-lockout guarantee.** Once healing is socially
> gated — by faith, by standing, by whether anyone's online — it becomes possible for
> a player to have no Cleric willing to treat them. Rest-over-time is what makes that
> survivable rather than a dead end: you can always wait it out. That's not a
> convenience feature, it's the floor that makes it safe to let Clerics refuse
> people.

**Open:** which forces have clerical traditions at all (a lore question for §11 —
not every force needs one, and the gaps are interesting), and what the *next*
service profession looks like, since applications will reach for the category once
it exists.

### 14. Rebuilding the crafting web around materials

Professions currently **own weapons**: each of the twelve craftable weapons belongs
to exactly one profession (`WEAPON_PROFESSION` in `upgrade_service.ts`), and
cross-profession dependency is bolted on at L3 and L4 as a special case.

**The rework: professions own materials, not weapons.**

| Profession | Domain |
|---|---|
| **Blacksmith** | Metal — blades, heads, fittings, bindings |
| **Carpenter** | Wood — hafts, handles, shafts, stocks, bows |
| **Enchanter** | Arcane — cores, foci, inscriptions |
| **Cleric** | Service — remedies (no weapon parts) |

Most weapons are mostly metal, so the Blacksmith matters to nearly everything. Most
weapons need a handle, so the Carpenter does too. That's the point.

#### Professions are roles, not levels

The important reframe: **a profession isn't your progression track, it's what you do
for the world.** Clerics heal. Blacksmiths work metal. Carpenters work wood.
Enchanters enchant. Everyone wants a weapon, and that alone is the reason Blacksmiths
and Carpenters exist.

That has a design consequence worth holding to deliberately: **profession rank should
unlock what you can make for other people, not how strong you are.** A rank-8
Blacksmith isn't a more powerful character — they're a more useful one. Their power
is social.

It follows that the weapon you personally wield shouldn't depend on your own
profession at all. It depends on **who you know**. Combat power comes from your
network, not your rank — which is exactly what the material web produces anyway, and
worth keeping true as the tree grows.

**The unit of crafting becomes the part, not the weapon.** A sword is a blade (BS)
plus a grip (Carpenter). A crossbow is a stock and limbs (Carpenter) plus a
mechanism (BS) plus bolts (EN). Interdependence stops being a tier-3 feature and
becomes how crafting works at every level.

**Rename Lumberjack → Carpenter.** "Lumberjack" names a gatherer; the professions
under this model are all makers. Gathering raw wood should be something anyone can
do — the profession is what you can *make* from it.

#### Who assembles?

**Recommendation: anyone can.** Parts are the tradeable goods; final assembly is
free. That way:

- Parts become real commodities with real markets — the market *is* the assembly
  line.
- No single profession is a bottleneck on finishing a weapon.
- A player can't self-supply without several high professions, which the combined
  level-cost curve already makes impractical. You have to trade.

The alternative — the "primary material" profession assembles — preserves more
per-profession identity but reintroduces a gatekeeper on every weapon. Worth
considering, but trade volume is the thing this design wants.

#### What this replaces, and what it breaks

**Replaces:** the L3 component triangle (`wand_base`, `staff_base`,
`battle_axe_hilt`) and the L4 bespoke two-part assemblies. Those exist to force
cross-profession dependency at high tiers. Under a material web that's the baseline
everywhere, so they collapse into the general part system. This is a
**simplification**, not additional work.

**Breaks:** the rule that *you only upgrade your own profession's weapons*. Under a
material web, a sword doesn't have one profession. That rule needs a new answer:

- **Part-targeted upgrades** (recommended) — you can upgrade the parts your
  profession made. Sharpen the blade if you're a Blacksmith; rebalance the haft if
  you're a Carpenter. This deepens the web the same way the crafting change does,
  and it maps naturally onto the existing system, where an upgrade already
  distributes EV across specific abilities.
- Or: the weapon's *dominant* material determines who can upgrade it. Simpler,
  keeps more of the current code, less interesting.

**Survives untouched:** the balance tooling. `budget.ts` and `cost_report.ts` cost a
*finished weapon*, and weapons are still finished weapons. Parts need prices, not
budgets. The sims don't care how a weapon was assembled.

#### Sequencing — and why this is cheaper than it looks

Do this **before session one**, not after. Profession choice is one of the first
things a player commits to, and restructuring professions after people have invested
in them means a migration plus a broken promise.

The reason that's affordable: **at session one, most of the weapon tree shouldn't
exist yet.** The town is an empty field with tents. There's no mine, so there's no
metal industry. Launching with a handful of L1 weapons in the new material web is
*correct fiction*, not a compromise — and it's a fraction of the content work of
porting all seventeen weapon YAMLs.

The tree then grows as the town earns it. Build the mine — the first session's
actual goal — and metal becomes available, and blacksmithing expands into the tiers
above. **The crafting web's expansion is the game's progression narrative**, which is
a much better reason for a weapon to be unavailable than a rank gate.

### 15. The reset, and the opening state

**Everything resets.** Characters, professions, inventories, korel, weapons — a
clean wipe, by design. The overhaul is large enough that carrying progress forward
would mean migrating data into a structure that no longer means the same thing.

**Frame it in fiction, not as maintenance.** The empty field with a few tents *is*
the reset. Nobody has anything because nothing has been built yet. That's a much
better story than "we wiped the database," and it makes the first session's
emptiness intentional rather than apologetic.

#### Returning players — seed them into roles

Because professions are roles rather than levels (§14), granting a returning player
rank isn't a head start in a race — it's **casting them as the town's blacksmith**.
That's infrastructure, and it's good for everyone: a town whose smith can already
make something is a town where anyone can get a weapon in week one.

So: offer returning players a **role**, seeded at whatever rank makes them
immediately useful to others. Publicly, in fiction, as part of the founding. Their
reward for having played before is that the world already knows who they are — which
is also standing, a title, and first pick of a shop plot.

**Handled by asking, not by a rule.** Before session zero the GM reaches out to
people who played and asks what they want — whether they'd like levels, which role
appeals, whether they'd rather start clean. It's a conversation, which is the right
tool for a group this size and sets the tone for how the world gets run.

#### Coverage is the GM's job, by design

A missing role would otherwise be a hole in the economy — no Carpenter means no
handles, which means no weapons. **That's exactly what the GM is for.** The GM being
the universal fallback isn't a stopgap or a risk being mitigated; it's the structural
answer, and it's why the GM hands out the starting weapons and gear in the first
place.

So the GM is permanently the missing link: whatever the town doesn't yet have
someone for, the GM covers, until a player takes it up (§13). Two things make that
smoother rather than replacing it — the GM can **cast deliberately at creation**,
saying out loud what the town is short of while people are still choosing, and a
**second profession is always purchasable** at whatever the combined-level curve
charges. Expensive, but it means a gap is always fillable by a player who wants it.

#### What players start with

- **The `branch` starter weapon.** It already exists and is exactly the "you have
  nothing" weapon.
- **The profession system is unchanged.** You buy profession levels with korel, and
  the cost is keyed to your *combined* level across professions
  (`levelCost(combined)`). Nobody is forced to pick one — but because spreading gets
  expensive fast, most people end up effectively specialised anyway. The
  specialisation is economic, not a rule.
- **A declared focus, but no granted rank.** Everyone starts at zero. What your
  character *intends* to do is stated at creation (§11) alongside the force stance and
  the prose — it's who they are, not a head start. The levels come from playing.

#### The first week's goal should be collective

A caution on scale: getting one player to an L1 weapon is *fast*. Rank 1 is roughly
7–16 fights and an L1 weapon is about 12 tier-1 materials, per `pacing_sim` — call
it an hour. As a week-one goal for an individual, that's over before the session
ends.

**So make the week-one goal the town's, not the player's.** Breaking ground on the
mine needs a collective deposit of ore and timber that no one person can supply.
Individual L1 weapons happen *along the way*, as the means rather than the end.

This is what the existing global quest system already does — a shared target, a
fixed price per deposit, rank-tiered trophies at completion. It's the right
primitive and it's already built.

#### Balancing without an automated economy

Worth stating plainly, because it changes how the tuning tools should be read:

- **`budget.ts` / `cost_report.ts` still work.** They price weapons in *power*, not
  money. Combat balance is unaffected by who runs the shops.
- **`pacing_sim.ts` partly stops applying.** It models farm → sell → rank using shop
  prices, and with no NPC shops there is no fixed sell rate to model. Its korel
  predictions become guesses.
- **What stays predictable is materials.** Drops are still server-controlled, so
  "how many fights to gather what a recipe needs" is exactly as computable as before.

**So tune recipes in fights, not korel.** Material cost is the part of the economy
that can actually be designed; korel prices are a social layer that players will set
and that will move. Materials are the balanceable currency — korel is the one that
floats.

### 16. The mine — and collective projects as the world's progression

The mine is the payload of session one, and right now it's only a goal. It needs to
be a **system**, because what happens when it completes is the whole point.

**Completing it should unlock the metal tier.** Ore becomes gatherable, so the
Blacksmith's tree opens upward, so better weapons become craftable. That's the
crafting-web-as-progression-narrative (§14) made concrete: the reason you couldn't
make a steel blade in week one wasn't a rank gate, it was that *the town had no
mine*. Now it does, because everyone built it.

**Shape:** a landmark placed on the map when the collective target is met — an
authored override on the terrain (§3) plus a gathering site that becomes usable.
Built via the existing global-quest primitive: a shared deposit target, everyone
contributing, rank-tiered trophies at completion (§7).

**Ownership: the town's, not a person's.** Everyone benefits. It's the collective
project; making it private would invert the point. Later projects can be
guild-owned, which is a different and also good thing.

#### The pattern this establishes

The mine shouldn't be a one-off. It's the **first instance of the engine that drives
the whole world forward**:

> The GM announces a collective project → players build it together → the map
> visibly changes → new systems and materials unlock → the next project becomes
> possible.

That's the loop that makes sessions matter and gives the world a direction that
isn't just individual accumulation. A farm, a road, a wall, a bridge, a second
town — each one is a shared goal, a visible change to the map, and a key to
something new.

It's also the natural home for accepted **applications**: a player-proposed system
often wants a place in the world, and "we have to build it first" is a much better
answer than it appearing overnight.

---

## Data model sketch

New Prisma models, roughly:

```
Identity      (provider, provider_user_id) -> account_id      # PK on the pair
Session       token, account_id, expires_at                    # restart-survivable auth
ChatMessage   x, y, account_id, character_id, body, created_at  # location-stamped
WorldTile     x, y, overrides…                                 # sparse diffs only
LandParcel    id, bounds/coords, owner_account_id, claimed_at
Building      id, parcel_id, x, y, type, state
PlayerShop    building_id, owner_account_id
ShopListing   shop_id, item_id, price, stock                   # owner-set price
PriceBound    item_id, min, max                                # GM-set guardrail
FarmPlot      character_id, x, y, seed_item_id, planted_at, stage
Injury        character_id, level, last_heal_tick_at           # 0-6; 6 = death
Quest         id, author (gm|account_id), target, terms, status
Force         id, name, blurb                                  # authored, 3-5 of them
CharacterForce character_id, force_id, stance, standing        # standing is earned/lost in play
Application   id, account_id, kind, title, body, status, gm_notes, created_at
                                                               # kind: system | asset | character
Guild         id, name, created_at
GuildMember   guild_id, account_id, role
```

Plus: `account_id` (uuid) added to `User` and every table currently keyed on
`discord_id`, and an `is_gm` flag on `User` to replace the current `isDev()` list.

Going away: `ShopItemState`, `ShopPriceTick`, `OrchardPlot`, and the NPC relation
table. Wilderness terrain gets **no table** — it's derived from
`hash(worldSeed, cx, cy)`.

---

## Rollout

Each phase ships to `dev` and gets tested in the browser — no long-lived branch,
because the whole premise is putting this in front of players as it's built.

| Phase | What | Why here |
|---|---|---|
| **0** | Identity: uuid `account_id`, `Identity` table, persisted sessions, Google OAuth + email fallback | Blocks everything, and the migration only grows as more tables reference identity. |
| **1** | Location-based in-character chat, presence, persisted history | Highest social value per effort. Also the first real test of proximity rules. |
| **2** | World map: coordinates, seeded chunks, diff storage, the authored town, movement, seeing other players | The map everything else sits on. Needs chunk size closed first. |
| **3** | GM console: ported admin/dev commands + announce, quest, spawn, place, move, roster | Makes sessions runnable as sessions rather than as chat plus manual DB edits. |
| **4** | Player shops: owner-set prices, GM price bounds, the always-open floor shop, NPC market removed | The GM's character is the first shop, and the mint needs somewhere to mint from. |
| **5** | Character creation: the forces list, required prose, chosen stance (GM reviews by hand at first) | Players need characters with a stake before the first session, not after. |
| **5b** | Crafting web rework (§14): material professions, parts, Cleric added, a small L1-only weapon set | Has to precede session one — profession choice is an early commitment and restructuring after is a broken promise. |
| — | **▶ SESSION ONE** | Phases 0–5. Combat, crafting, professions, and quests already work. |
| **6** | Applications: submit, queue, GM review, public status board — all three kinds | Ship right after the first session, while players have just been asked for ideas. |
| **7** | Land + buildings; shops become buildings on the map | Turns the economy into geography. Also the korel sink. |
| **8** | Farming: seeds + time on owned tiles, varied crop durations | Second acquisition pillar alongside combat. |
| **9** | Party combat: N-socket intents, round timer, join-at-location | The engine already supports it; sessions will tell us the style. |
| **10** | Guilds + guild-gated systems; deal-making | Formalize once groups actually exist and there are systems worth gating. |

Session one needs 0–5. That's the milestone worth pointing everything at.

Phase 5 is mostly **writing, not code** — the forces, the character-creation copy,
and the mine's motivation are one authoring job. It's also the phase most likely to
be the schedule risk, since it can't be delegated.

---

## Decisions already made

- **Same repo, `dev` branch, additive.** Not a new repo, not a long-lived feature
  branch — one server runs one branch, and the social game has to be playtested as
  it's built.
- **Combat keeps its round structure.** Not being rewritten as continuous
  real-time. A round timer is likely; the rest of the resolution stack stands.
- **No NPCs, no automatic market.** Players run the economy.
- **The GM is the mint.** Quests are the primary korel faucet. One always-open shop
  survives at deliberately low rates as a floor and a between-sessions valve.
- **Character creation requires written prose** and a chosen relationship to one of
  the world's forces, reviewed as an application. Review grants **standing, not
  access** — nobody waits on approval to start playing.
- **Standing is a first-class gate**, alongside profession and guild.
- **Losing a fight injures, it doesn't kill.** Injury 0–6, +1 per loss, 6 is death,
  consequence at 4, natural healing ~3/day, plus a paid player-run healing service.
  Injury gates *combat risk*, not participation.
- **Cleric is the fourth profession** and the first *service* profession — crafts
  consumables, no weapon parts. Religious, but across a variety of forces rather than
  one church; allegiance is a separate axis from the profession. Clerics can heal
  themselves.
- **Professions own materials, not weapons** (§14). Blacksmith = metal, Carpenter
  (renamed from Lumberjack) = wood, Enchanter = arcane. Weapons are assemblies of
  parts from several professions. Do it **before session one**.
- **Professions are roles, not levels.** Rank unlocks what you can make *for others*,
  not how strong you are; the weapon you wield depends on who you know.
- **The GM bootstraps every service** and hands each off as players take it up.
- **Buildings are 64×64px = 2×2 tiles.** Reuses the existing multi-square footprint
  engine.
- **The town's size sets the chunk size**, not the reverse.
- **Everything resets** — a clean wipe, framed in fiction as the world's founding.
  Players start with `branch`; the paid profession-level system is unchanged.
- **The GM is the missing link by design** — permanently the fallback for any role
  the town hasn't staffed, which is why the GM hands out starting gear.
- **Tune recipes in fights, not korel.** Materials are the balanceable currency;
  korel floats because players set it.
- **No global chat, no guild chat.** Location-based and in-character only; Discord
  is the OOC room.
- **Applications never execute player code.** A form and a queue; the GM builds
  accepted ideas by hand and has final say, always.
- **The orchard is scrapped**, not migrated.
- **The Discord bot survives for announcements only** — updates and things that
  matter, not per-fight or per-craft noise.
- **Text chat only.** No voice in the client.

## Open questions

1. **Chunk size** — falls out of the town's drawn size (§3). ~24×24 is the working
   assumption. Confirm once the town layout settles.
2. **What is canon?** Does what's said in a Discord voice call during a session
   count as in-world, or is only in-client text canon? Shapes how much has to live
   in the game.
3. **Real-time movement outside combat**, and if so, at what granularity —
   tile-occupancy with click-to-move, or sub-tile avatars?
4. **What proximity affords.** Once people stand near each other outside combat:
   who can talk, trade, follow, block, steal, attack? Chat range is the first case;
   everything else inherits the answer.
5. **Round timer** — always on, or only above a player count? How long? GM override?
6. **Land economy** — fixed parcel supply (scarcity, land value, resale) or a map
   that expands with the population?
7. **Crop duration spread** — the actual hours/days/weeks bands.
8. **Application specifics** — submission format, how much structure to require,
   whether declined applications stay public, how exclusivity is represented.
9. **Economy retuning** — how far crafting costs, drops, and profession pacing move
   once players set prices.
10. **The forces themselves** — how many, who they are, what they want. Blocks
    character creation copy and the first session's framing.
11. **Always-open shop rates** — how low is low enough that selling to a player is
    always better, without making it useless as a floor?
12. **The level-4 consequence** — max HP, movement, visible injury, or a mix.
13. **Permadeath shape** (§12) — what inherits (and especially what happens to
    professions), opt-in zones, and where a dead character's property and korel go.
14. **Cleric specifics** (§13) — which forces have clerical traditions, the remedy
    recipes and their farmed inputs, and what the next service profession looks like.
15. **What standing gates**, concretely — quests, prices, building access, hostile
    territory, guild eligibility? And how it's earned and lost.
16. **Who assembles a weapon** (§14) — anyone, or the dominant-material profession?
17. **How upgrades work** once a weapon has no single owning profession —
    part-targeted, or dominant-material? Supersedes the current "upgrade only your
    own profession's weapons" rule.
18. **Which weapons exist at session one**, and what the mine unlocks.
19. **Where the higher-level enemies live.** The baseline is answered — **you can
    always fight swallows**, by design, so the material faucet never closes and a
    new player always has something to do. What's open is how the rest of the roster
    is reached: wandering, hunting grounds, GM-spawned, or gated behind projects.
20. **Onboarding after the reset** — the tutorial (`tutorial_swallow`,
    `tutorial_complete`) assumes a solo funnel. With a founding session and a GM
    present, how much of it survives, and what does someone arriving in week three
    get instead?
21. **Session scheduling** — players need to know when a session is happening.
    A schedule surface in the client, or just the Discord announcement channel?
20. **The week-one collective target** — what quantity of what, and how it's framed
    as breaking ground on the mine.

---

*Related: `docs/terrain.md` (the tile/layer system this builds on),
`docs/interface-art.md`, `docs/PRD.md`, `docs/ideas.md`.*
