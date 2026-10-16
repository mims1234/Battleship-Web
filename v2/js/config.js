// Battleship v2 — shared constants, rule presets, campaign + gauntlet content.

export const GRID = 10;
export const VERSION = "2.0.0";

// Same fleet as v1 (names + sizes), each ship now carries a commander ability.
export const SHIPS = [
    { id: "carrier", name: "Carrier", size: 5, ability: "recon" },
    { id: "battleship", name: "Battleship", size: 4, ability: "barrage" },
    { id: "cruiser", name: "Cruiser", size: 3, ability: "repair" },
    { id: "submarine", name: "Submarine", size: 3, ability: "sonar" },
    { id: "destroyer", name: "Destroyer", size: 2, ability: "torpedo" }
];

export const ABILITIES = {
    recon: {
        id: "recon", ship: "carrier", name: "Air Recon", icon: "fa-plane", cooldown: 4, key: "1",
        target: "line", board: "enemy",
        desc: "Fly over a row or column and count the hidden hull sections in it. Fog blocks the count."
    },
    barrage: {
        id: "barrage", ship: "battleship", name: "Barrage", icon: "fa-burst", cooldown: 5, key: "2",
        target: "cross", board: "enemy",
        desc: "Fire five shells in a + pattern."
    },
    repair: {
        id: "repair", ship: "cruiser", name: "Repair Crew", icon: "fa-screwdriver-wrench", cooldown: 5, key: "3",
        target: "own", board: "home",
        desc: "Patch one damaged section of a ship that is still afloat."
    },
    sonar: {
        id: "sonar", ship: "submarine", name: "Sonar Ping", icon: "fa-satellite-dish", cooldown: 4, key: "4",
        target: "area", board: "enemy",
        desc: "Reveal ship contacts in a 3×3 area. Fog hides contacts."
    },
    torpedo: {
        id: "torpedo", ship: "destroyer", name: "Torpedo", icon: "fa-rocket", cooldown: 4, key: "5",
        target: "lane", board: "enemy",
        desc: "Run a torpedo along a row or column. It strikes the first intact hull and stops at islands."
    }
};

export const ABILITY_ORDER = ["recon", "barrage", "repair", "sonar", "torpedo"];
export const MANEUVER_COOLDOWN = 3;

export const DIFFICULTIES = {
    easy: { label: "Easy", desc: "Mostly random shots" },
    normal: { label: "Normal", desc: "Hunts around hits, checkerboard search" },
    hard: { label: "Hard", desc: "Probability heat-map targeting" }
};

export const RULE_INFO = {
    abilities: { label: "Ship abilities", icon: "fa-bolt", desc: "Each ship has a special power on a cooldown. You lose it when that ship sinks." },
    islands: { label: "Islands", icon: "fa-mountain-sun", desc: "Rocky islands block placement, shots and torpedoes." },
    mines: { label: "Sea mines", icon: "fa-bomb", desc: "3 hidden mines per side. Hitting one makes the shooter lose their next turn." },
    fog: { label: "Fog banks", icon: "fa-smog", desc: "A 3×3 fog bank per side hides contacts from sonar and recon." },
    maneuver: { label: "Maneuver", icon: "fa-arrows-up-down-left-right", desc: "Spend a turn to slide an undamaged ship 1 cell along its axis." },
    salvo: { label: "Salvo", icon: "fa-crosshairs", desc: "Fire one shot per ship you still have afloat." },
    noTouch: { label: "No-touch", icon: "fa-border-none", desc: "Ships cannot touch, diagonals included." }
};

export const CLASSIC_RULES = {
    difficulty: "normal", abilities: false, islands: false, mines: false, fog: false,
    maneuver: false, salvo: false, noTouch: false
};

export const TACTICAL_RULES = {
    difficulty: "normal", abilities: true, islands: true, mines: true, fog: false,
    maneuver: false, salvo: false, noTouch: false
};

export const THEMES = {
    atlantic: {
        label: "Atlantic",
        sky: { zenith: 0x0a1a2f, horizon: 0x3d6f8a, sun: 0xffcf9a, sunDir: [-0.45, 0.16, -0.88] },
        water: { deep: 0x03192c, shallow: 0x1f6f8b, foam: 0xd9f1f5 },
        fog: 0x274e64,
        accent: "#a7d7e0", accent2: "#c8a24a", enemy: "#e86a5c",
        hull: 0x7d8a99, deck: 0x4a5563, light: 1.0, weather: "storm"
    },
    brass: {
        label: "Brass",
        sky: { zenith: 0x0c172b, horizon: 0xc58a46, sun: 0xffb259, sunDir: [0.55, 0.1, -0.83] },
        water: { deep: 0x061426, shallow: 0x1e4b6a, foam: 0xf2e2c0 },
        fog: 0x6b5236,
        accent: "#f2d59c", accent2: "#c8a24a", enemy: "#ff7a5c",
        hull: 0x8a8476, deck: 0x5b5446, light: 0.95, weather: "clear"
    },
    regatta: {
        label: "Regatta",
        sky: { zenith: 0x1b4d98, horizon: 0xa9d6f6, sun: 0xfff3d6, sunDir: [0.3, 0.6, -0.74] },
        water: { deep: 0x072a63, shallow: 0x1e6fd9, foam: 0xffffff },
        fog: 0x9cc6ea,
        accent: "#7fe3d2", accent2: "#20bfa8", enemy: "#ff4d3d",
        hull: 0x9aa6b5, deck: 0x5d6a7b, light: 1.15, weather: "clear"
    }
};
export const THEME_ORDER = ["atlantic", "brass", "regatta"];

// AI admirals. Personality knobs feed the AI (ability use, repairs, evasive moves).
export const ADMIRALS = {
    drill: {
        name: "Chief Okafor", title: "Drill Instructor", icon: "fa-user-tie", color: "#7fb4c9",
        pers: { aggression: 0.25, repair: 0.3, evade: 0.2, think: 650 },
        lines: {
            intro: ["Eyes on the grid, cadet. Let's see what you've learned."],
            hit: ["Good hit! Keep that pressure on.", "Textbook."],
            miss: ["Splash. Recalibrate.", "Water, cadet."],
            sunk: ["You sank my {ship}. Not bad at all."],
            aiHit: ["Found you.", "Hull breach on your side, cadet!"],
            aiSunk: ["Your {ship} is down. Learn from it."],
            win: ["Exercise complete. You'll make a fine captain."],
            lose: ["Back to the simulator, cadet."]
        }
    },
    reef: {
        name: "Capt. Marisol Vega", title: "Reef Runner", icon: "fa-compass", color: "#20bfa8",
        pers: { aggression: 0.45, repair: 0.4, evade: 0.3, think: 700 },
        lines: {
            intro: ["These reefs have eaten bigger fleets than yours."],
            hit: ["Lucky current.", "Hm. You read the water well."],
            miss: ["The reef laughs at you.", "Nothing but coral."],
            sunk: ["My {ship}... the sea keeps what it takes."],
            aiHit: ["Gotcha, behind the rocks!", "Direct hit."],
            aiSunk: ["Your {ship} joins the reef."],
            win: ["You navigated well. The reef is yours."],
            lose: ["Should have charted these waters first."]
        }
    },
    silent: {
        name: "Cmdr. Ilse Brandt", title: "The Silent Hunter", icon: "fa-satellite-dish", color: "#a7d7e0",
        pers: { aggression: 0.8, repair: 0.35, evade: 0.4, think: 800 },
        lines: {
            intro: ["You will not hear me coming."],
            hit: ["...", "Acceptable."],
            miss: ["Silence.", "You fire at ghosts."],
            sunk: ["{ship} lost. Noted."],
            aiHit: ["Ping. Contact. Fire.", "Sonar never lies."],
            aiSunk: ["Your {ship} is on the seabed."],
            win: ["You found me. Impressive."],
            lose: ["Run silent, run deep. You did neither."]
        }
    },
    mines: {
        name: "Adm. Bogdan Kral", title: "The Minelayer", icon: "fa-bomb", color: "#c8a24a",
        pers: { aggression: 0.5, repair: 0.5, evade: 0.25, think: 750, extraMines: 2 },
        lines: {
            intro: ["Every wave hides a surprise. Step carefully."],
            hit: ["Grr. A dent, nothing more.", "You'll pay for that."],
            miss: ["Ha! Wide!", "Keep firing, maybe you'll find a mine."],
            sunk: ["My beautiful {ship}!"],
            aiHit: ["Boom!", "Ha ha! Burning!"],
            aiSunk: ["Your {ship} is scrap metal!"],
            win: ["Bah. You danced through my field."],
            lose: ["Kaboom. Told you so."]
        }
    },
    fog: {
        name: "The Grey Lady", title: "Fog Witch", icon: "fa-smog", color: "#c9d4e8",
        pers: { aggression: 0.6, repair: 0.5, evade: 0.5, think: 900 },
        lines: {
            intro: ["The fog sees you. You do not see the fog."],
            hit: ["The mist thins...", "You touched something real."],
            miss: ["Only vapour.", "The fog swallows your shot."],
            sunk: ["My {ship} fades into the grey."],
            aiHit: ["Out of the mist, a hit.", "I see you."],
            aiSunk: ["Your {ship} is lost in the fog."],
            win: ["The fog lifts. You have earned the clear sky."],
            lose: ["Lost in the grey. Forever."]
        }
    },
    iron: {
        name: "Grand Adm. Hale", title: "Iron Tide", icon: "fa-shield-halved", color: "#e86a5c",
        pers: { aggression: 0.7, repair: 0.45, evade: 0.3, think: 650 },
        lines: {
            intro: ["Full broadsides. No mercy, no pause."],
            hit: ["A scratch on iron.", "Hold the line!"],
            miss: ["Your volleys are weak.", "Miss. Again."],
            sunk: ["The {ship} was a fine vessel. Avenge her!"],
            aiHit: ["Broadside lands!", "Pound them!"],
            aiSunk: ["Your {ship} breaks under the tide."],
            win: ["Iron bends... it seems. Well fought."],
            lose: ["The tide rolls on."]
        }
    },
    ghost: {
        name: "Capt. Wren", title: "Ghost Fleet", icon: "fa-ghost", color: "#b9a7ff",
        pers: { aggression: 0.55, repair: 0.45, evade: 0.85, think: 800 },
        lines: {
            intro: ["Where I was is not where I am."],
            hit: ["You caught a ghost!", "Hmph."],
            miss: ["I was never there.", "Too slow."],
            sunk: ["My {ship} stops running."],
            aiHit: ["Boo.", "Found you, little ship."],
            aiSunk: ["Your {ship} becomes a ghost too."],
            win: ["You pinned a phantom. Remarkable."],
            lose: ["Chasing shadows to the end."]
        }
    },
    leviathan: {
        name: "Leviathan", title: "Admiral of the Abyss", icon: "fa-dragon", color: "#ff4d3d",
        pers: { aggression: 0.9, repair: 0.6, evade: 0.6, think: 700, extraMines: 1, armor: ["carrier"] },
        lines: {
            intro: ["Everything you know about this game ends here."],
            hit: ["Pain is information.", "Interesting."],
            miss: ["The abyss is wide.", "Predictable."],
            sunk: ["The {ship} returns to the deep."],
            aiHit: ["The deep reaches up.", "Hull breached."],
            aiSunk: ["Your {ship} feeds the abyss."],
            win: ["...The deep remembers your name."],
            lose: ["Down you go."]
        }
    },
    gauntlet: {
        name: "Gauntlet Warden", title: "Arena Master", icon: "fa-skull", color: "#e86a5c",
        pers: { aggression: 0.6, repair: 0.4, evade: 0.35, think: 650 },
        lines: {
            intro: ["Another challenger. Show me."],
            hit: ["Hit.", "The crowd roars."],
            miss: ["Miss.", "Boo!"],
            sunk: ["{ship} down!"],
            aiHit: ["Hit!", "Blood in the water."],
            aiSunk: ["Your {ship} is out!"],
            win: ["The arena salutes you."],
            lose: ["Next challenger!"]
        }
    },
    quick: {
        name: "Enemy Fleet", title: "AI Commander", icon: "fa-robot", color: "#e86a5c",
        pers: { aggression: 0.55, repair: 0.4, evade: 0.35, think: 650 },
        lines: {
            intro: ["Enemy fleet sighted. Battle stations."],
            hit: ["Hull breach!", "We're hit!"],
            miss: ["Missed us.", "Splash."],
            sunk: ["Our {ship} is going down!"],
            aiHit: ["Target hit.", "Direct hit."],
            aiSunk: ["Enemy {ship} destroyed."],
            win: ["Enemy fleet destroyed."],
            lose: ["Our fleet is lost."]
        }
    }
};

// Campaign: each mission adds a rule, so it doubles as a tutorial.
export const CAMPAIGN = [
    {
        id: "m1", title: "Harbor Drills", admiral: "drill",
        brief: "Classic rules. Sink all five ships. Hits flash red and misses splash white.",
        rules: { difficulty: "easy", abilities: false, islands: false, mines: false, fog: false, maneuver: false, salvo: false, noTouch: false },
        tip: "Once you score a hit, the rest of the ship is in a straight line next to it."
    },
    {
        id: "m2", title: "Reef Run", admiral: "reef",
        brief: "Islands now break up the sea. Nothing can be placed on them or fired at them.",
        rules: { difficulty: "easy", abilities: false, islands: true, mines: false, fog: false, maneuver: false, salvo: false, noTouch: false },
        tip: "Islands shrink the space ships can hide in. Use them to rule out cells."
    },
    {
        id: "m3", title: "Silent Service", admiral: "silent",
        brief: "Ship abilities are online. Each ship has a power that comes back after a cooldown.",
        rules: { difficulty: "normal", abilities: true, islands: true, mines: false, fog: false, maneuver: false, salvo: false, noTouch: false },
        tip: "Ping with sonar first, then fire at the amber contacts."
    },
    {
        id: "m4", title: "Minefield", admiral: "mines",
        brief: "Each side has hidden sea mines. Hit one and you lose your next turn.",
        rules: { difficulty: "normal", abilities: true, islands: true, mines: true, fog: false, maneuver: false, salvo: false, noTouch: false },
        tip: "Sonar shows ships, not mines. A torpedo that hits a mine clears it without a penalty."
    },
    {
        id: "m5", title: "Fog of War", admiral: "fog",
        brief: "Fog banks hide ships from sonar and recon. Only shells get through.",
        rules: { difficulty: "normal", abilities: true, islands: true, mines: true, fog: true, maneuver: false, salvo: false, noTouch: false },
        tip: "Hiding a ship inside your own fog bank is a strong defensive play."
    },
    {
        id: "m6", title: "Iron Tide", admiral: "iron",
        brief: "Salvo rules: fire one shot per ship you have afloat. Every loss weakens your volley.",
        rules: { difficulty: "hard", abilities: true, islands: true, mines: false, fog: false, maneuver: false, salvo: true, noTouch: false },
        tip: "Spread a salvo out to search, then focus it to finish ships."
    },
    {
        id: "m7", title: "Ghost Fleet", admiral: "ghost",
        brief: "Maneuver is enabled. Undamaged ships can slide one cell, so old sonar contacts may be stale.",
        rules: { difficulty: "hard", abilities: true, islands: true, mines: true, fog: false, maneuver: true, salvo: false, noTouch: false },
        tip: "Fire at fresh contacts quickly, before they move."
    },
    {
        id: "m8", title: "Leviathan", admiral: "leviathan",
        brief: "Everything at once. The Leviathan's carrier is armored and deflects the first hit.",
        rules: { difficulty: "hard", abilities: true, islands: true, mines: true, fog: true, maneuver: true, salvo: false, noTouch: true },
        tip: "Under no-touch rules, the cells around a sunk ship are always empty water."
    }
];

// Gauntlet (roguelite) — rounds escalate; between wins the player drafts an upgrade.
export const GAUNTLET_ROUNDS = [
    { difficulty: "easy", islands: true, mines: false, fog: false, maneuver: false, enemyMines: 0 },
    { difficulty: "normal", islands: true, mines: true, fog: false, maneuver: false, enemyMines: 0 },
    { difficulty: "normal", islands: true, mines: true, fog: true, maneuver: false, enemyMines: 1 },
    { difficulty: "hard", islands: true, mines: true, fog: true, maneuver: true, enemyMines: 1, enemyArmor: ["battleship"] },
    { difficulty: "hard", islands: true, mines: true, fog: true, maneuver: true, enemyMines: 2, enemyArmor: ["carrier", "battleship"] }
];

export const UPGRADES = [
    { id: "armorCarrier", name: "Carrier Armor", icon: "fa-shield-halved", desc: "Your Carrier shrugs off the first hit it takes." },
    { id: "armorBattleship", name: "Battleship Armor", icon: "fa-shield", desc: "Your Battleship shrugs off the first hit it takes." },
    { id: "quickCrew", name: "Quick Crews", icon: "fa-stopwatch", desc: "All ability cooldowns are 1 turn shorter." },
    { id: "wideSonar", name: "Deep Sonar", icon: "fa-satellite-dish", desc: "Sonar scans 5×5 instead of 3×3." },
    { id: "piercingTorpedo", name: "Twin Torpedo", icon: "fa-rocket", desc: "Torpedoes can strike two hulls before stopping." },
    { id: "extraMines", name: "Minelayer", icon: "fa-bomb", desc: "+2 sea mines in your waters." },
    { id: "openingVolley", name: "Opening Volley", icon: "fa-burst", desc: "Your first turn fires 3 shots." },
    { id: "readyStart", name: "Hot Start", icon: "fa-fire", desc: "Abilities start the battle ready (no warm-up)." },
    { id: "scoutPlane", name: "Scout Plane", icon: "fa-plane", desc: "Begin each battle with a free sonar sweep of the enemy center." }
];

export const ACHIEVEMENTS = [
    { id: "first_win", title: "Fleet Admiral", desc: "Win a v2 battle", icon: "fa-trophy" },
    { id: "hard_win", title: "Iron Captain", desc: "Win on Hard", icon: "fa-shield-halved" },
    { id: "flawless", title: "Untouchable", desc: "Win without losing a ship", icon: "fa-star" },
    { id: "comeback", title: "Last Stand", desc: "Win with only one ship left afloat", icon: "fa-heart-crack" },
    { id: "deadeye", title: "Deadeye", desc: "Win with 70%+ accuracy (10+ shots)", icon: "fa-crosshairs" },
    { id: "blitz", title: "Blitz", desc: "Win in under 3 minutes", icon: "fa-bolt" },
    { id: "torpedo_sink", title: "Fish in the Water", desc: "Sink a ship with a torpedo", icon: "fa-rocket" },
    { id: "barrage3", title: "Shock & Awe", desc: "Land 3+ hits with a single barrage", icon: "fa-burst" },
    { id: "repair3", title: "Damage Control", desc: "Repair 3 sections in one battle", icon: "fa-screwdriver-wrench" },
    { id: "minefield", title: "Minefield", desc: "The enemy hits 2 of your mines in one battle", icon: "fa-bomb" },
    { id: "phantom", title: "Phantom", desc: "Win after maneuvering 3+ times", icon: "fa-ghost" },
    { id: "daily_win", title: "Daily Orders", desc: "Win the daily challenge", icon: "fa-calendar-day" },
    { id: "campaign_clear", title: "Sea Legend", desc: "Defeat the Leviathan", icon: "fa-dragon" },
    { id: "gauntlet_clear", title: "Arena Champion", desc: "Survive all 5 Gauntlet rounds", icon: "fa-skull" },
    { id: "online_win", title: "Duelist", desc: "Win an online duel", icon: "fa-globe" },
    { id: "stars24", title: "Constellation", desc: "Earn all 24 campaign stars", icon: "fa-star-half-stroke" }
];

export const SHIP_BY_ID = Object.fromEntries(SHIPS.map((s) => [s.id, s]));
