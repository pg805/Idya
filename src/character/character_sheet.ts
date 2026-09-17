// The character sheet's authored content: the forces you can take a stance
// toward, the goals you can be here for, and names you can pick from.
//
// One module because the creation screen, the character sheet and the GM's
// review all have to agree about what exists. The client renders from
// /api/character/options rather than carrying its own copy.

// ---- the five forces (docs/lore/apolis.md) ------------------------------
// Player-facing, so each one is what the force WANTS rather than what it is.
// Creation is the only moment you are guaranteed someone's attention, and a
// dropdown of names teaches nobody what siding with one costs.

export interface Force {
  key: string;
  name: string;
  want: string;
}

export const FORCES: readonly Force[] = [
  {
    key: 'crown',
    name: 'The Crown',
    want: 'The emperor is fighting a war on the old continent and he needs talamite for it. He owns this mine in name, and he means to own it in more than name.',
  },
  {
    key: 'keat_company',
    name: 'The Keat Company',
    want: 'Merchants, and they are running the expedition. They want what the mine is worth. They are happy to let the crown hold the title for as long as the Company holds the operation.',
  },
  {
    key: 'kolem_thetholven',
    name: 'The Kolem Thetholven',
    want: 'Scientists and arcanists. They want talamite because it conducts sidaev, and they want a say in where it goes, so that it does not all end up as weapons.',
  },
  {
    key: 'scathlan_states',
    name: 'The Scathlan States',
    want: 'Allies of the Chaevul, at war with the same country. They want the metal for themselves. They have people inside every other organization here, and some of those people are genuinely only here to help.',
  },
  {
    key: 'vidil_church',
    name: 'The Vidil Church',
    want: 'Named for Vidali, the Ketulvu god of life. They say the church should hold the resources so that the resources are shared fairly. They would also like the crown weakened.',
  },
];

// A stance is a relationship, not an allegiance. "Hiding from" is as much a
// reason for the GM to build you a thread as "backing".
export const STANCES: readonly { key: string; label: string; blurb: string }[] = [
  { key: 'backing',     label: 'Backing them',     blurb: 'You want them to win, and you act like it.' },
  { key: 'owing',       label: 'Owing them',       blurb: 'They did something for you, or you took something from them. Either way the debt is real.' },
  { key: 'hiding',      label: 'Hiding from them', blurb: 'You would rather they did not know your name, let alone where you are.' },
  { key: 'indifferent', label: 'Indifferent',      blurb: 'Their quarrel is not yours. You are here for your own reasons.' },
];

export const STANCE_KEYS = new Set(STANCES.map(s => s.key));
export const FORCE_KEYS = new Set(FORCES.map(f => f.key));

// ---- goals ---------------------------------------------------------------
// A goal is a gameplay feature, not a line of backstory. Each kind is something
// the world can track and hand back as accomplished, and a character who
// finishes one picks another. That is the whole reason the free-text option is
// NOT a goal: see OWN_PATH below.

export interface GoalVariant {
  key: string;
  label: string;
  blurb: string;
}

export interface GoalKind {
  key: string;
  label: string;
  blurb: string;
  // What choosing it commits you to. Absent means the kind stands on its own.
  variantLabel?: string;
  variants: readonly GoalVariant[];
  // Whether the player may add their own words alongside the choice.
  allowsDetail: boolean;
}

export const OWN_PATH = 'own_path';

export const GOAL_KINDS: readonly GoalKind[] = [
  {
    key: 'build',
    label: 'Build something that lasts',
    blurb: 'You want a thing standing here with your name on it, still standing in ten years.',
    variantLabel: 'What are you building?',
    variants: [
      { key: 'home', label: 'A home', blurb: 'Somewhere that is yours to come back to.' },
      { key: 'shop', label: 'A shop', blurb: 'A storefront, your prices, your stock.' },
    ],
    allowsDetail: true,
  },
  {
    key: 'debt',
    label: 'Settle a debt',
    blurb: 'Something is owed. You came here to square it.',
    variantLabel: 'What kind of debt?',
    variants: [
      { key: 'money',     label: 'Money owed', blurb: 'A sum, and you are here to pay it down.' },
      { key: 'vengeance', label: 'Vengeance',  blurb: 'A different kind of ledger, and it does not balance with korel.' },
    ],
    allowsDetail: true,
  },
  {
    key: 'serve',
    label: 'Serve a force',
    blurb: 'You came on behalf of somebody else, and they will keep asking you for things.',
    variantLabel: 'Whose work are you doing?',
    variants: FORCES.map(f => ({ key: f.key, label: f.name, blurb: f.want })),
    allowsDetail: true,
  },
  {
    key: 'master',
    label: 'Master a craft',
    blurb: 'You want to be the best on this continent at one thing.',
    variantLabel: 'Which craft?',
    variants: [
      { key: 'lumberjack', label: 'Lumberjack', blurb: 'Wood, and everything that starts as wood.' },
      { key: 'blacksmith', label: 'Blacksmith', blurb: 'Talamite, alloy, and the things they become.' },
      { key: 'enchanter',  label: 'Enchanter',  blurb: 'Sidaev, and what it does to a finished weapon.' },
    ],
    allowsDetail: true,
  },
  {
    key: 'buried',
    label: 'Learn what is buried here',
    blurb: 'The stories about Apolis are not all stories, and one of them brought you.',
    variantLabel: 'What are you looking for?',
    // DRAFT NAMES. These are meant to become real singleton items, one each,
    // findable once and never again. Rename freely, but do it before anybody
    // picks one: the keys are what the database stores.
    variants: [
      { key: 'sunken_bell', label: 'The sunken bell',     blurb: 'A bell that rings underground when nobody is near it.' },
      { key: 'first_vein',  label: 'The first vein',      blurb: 'The first talamite ever cut on Apolis, and whatever was made from it.' },
      { key: 'kolem_lens',  label: 'The lost lens',       blurb: 'A Kolem Thetholven instrument that went into the ground with the survey carrying it.' },
      { key: 'unnamed',     label: 'You do not know yet', blurb: 'Only that something is down there, and that you will know it when you see it.' },
    ],
    allowsDetail: true,
  },
  {
    key: 'magic',
    label: 'Make something new out of sidaev',
    blurb: 'Nobody has made the thing you have in mind. You intend to be the one who does.',
    variantLabel: 'What are you trying to make?',
    variants: [
      { key: 'spell',       label: 'A spell',        blurb: 'An effect that did not exist before you worked it out.' },
      { key: 'enchantment', label: 'An enchantment', blurb: 'Something that can be put on a weapon and stay there.' },
    ],
    allowsDetail: true,
  },
  {
    key: OWN_PATH,
    label: 'Your own path',
    blurb: 'None of these. Tell us what your character is here to do, and what it would take for the world to agree you had done it.',
    variants: [],
    allowsDetail: true,
  },
];

export const GOAL_KIND_KEYS = new Set(GOAL_KINDS.map(g => g.key));

/**
 * Whether a (kind, variant) pair is one this module actually offers.
 * own_path takes no variant; every other kind requires one of its own.
 */
export function goalIsValid(kind: string, variant?: string | null): boolean {
  const k = GOAL_KINDS.find(g => g.key === kind);
  if (!k) return false;
  if (k.key === OWN_PATH) return !variant;
  return !!variant && k.variants.some(v => v.key === variant);
}

/**
 * The status a freshly chosen goal starts in. Free text is a PROPOSAL rather
 * than a goal: the world cannot track "whatever you wrote", so it goes to the
 * GM as an application (docs/world.md section 5) and becomes a real kind only
 * if it gets built.
 */
export function initialGoalStatus(kind: string): 'active' | 'proposed' {
  return kind === OWN_PATH ? 'proposed' : 'active';
}

// ---- names ---------------------------------------------------------------
// Built from the phonetics already in the lore rather than invented fresh, so a
// picked name sits next to Sulku'it and Gustavus without sounding imported.
// A starting list; expect the author to tune it.

export const KETULVU_NAMES: readonly string[] = [
  'Kethev', 'Sulaen', 'Daevin', 'Tolmek', 'Vidrek', 'Golan', 'Lithek', 'Norvath',
  'Amek', 'Sedaev', 'Kolvu', 'Thenlok', 'Maeven', 'Kethra', 'Daela', 'Noka',
  'Ilvet', 'Serovu', 'Thessa', 'Oruit',
];

export const CHAE_NAMES: readonly string[] = [
  'Marcen', 'Avitus', 'Caelia', 'Lucreta', 'Tavian', 'Orsova', 'Velian', 'Castra',
  'Ruvia', 'Demetrian', 'Sabina', 'Corvus', 'Livara', 'Petronus', 'Aurelia',
  'Severin', 'Octavia', 'Valens',
];

// ---- canon ---------------------------------------------------------------
// draft -> submitted -> canon. Approval is the GM's alone and grants standing,
// not access: a character in every one of these states plays identically.
export type CanonStatus = 'draft' | 'submitted' | 'canon';
export const CANON_STATUSES: readonly CanonStatus[] = ['draft', 'submitted', 'canon'];

export function isCanon(status: string | null | undefined): boolean {
  return status === 'canon';
}
