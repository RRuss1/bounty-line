/** Display names for the numeric game IDs carried in codes. Unknown IDs fall back to "#N". */

const CLASSES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  10: "Monk",
  11: "Druid",
  12: "Demon Hunter",
  13: "Evoker",
};

const RACES: Record<number, string> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  9: "Goblin",
  10: "Blood Elf",
  11: "Draenei",
  22: "Worgen",
  24: "Pandaren",
  25: "Pandaren",
  26: "Pandaren",
  27: "Nightborne",
  28: "Highmountain Tauren",
  29: "Void Elf",
  30: "Lightforged Draenei",
  31: "Zandalari Troll",
  32: "Kul Tiran",
  34: "Dark Iron Dwarf",
  35: "Vulpera",
  36: "Mag'har Orc",
  37: "Mechagnome",
  52: "Dracthyr",
  70: "Dracthyr",
  84: "Earthen",
  85: "Earthen",
};

export const className = (id: number) => CLASSES[id] ?? `Class #${id}`;
export const raceName = (id: number) => RACES[id] ?? `Race #${id}`;
export const factionName = (id: number) => (id === 1 ? "Alliance" : id === 2 ? "Horde" : `Faction #${id}`);
/**
 * B codes carry only a uiMapID; names need a verified Forever map table (spec Section 23,
 * filled in from `/bl debug` in Phase 3). Unknown zones are left off rather than shown as numbers.
 */
/** Verified on Forever with /bl debug (uiMapID → name). Add more as players report them. */
const ZONES: Record<number, string> = {
  1437: "Wetlands",
};
export const zoneName = (mapId: number): string | null => ZONES[mapId] ?? null;

/** "Grief Bounty Board", or just "Bounty Board" before a name is set. */
export const boardName = (displayName: string) => `${displayName.trim()} Bounty Board`.trim();

/** Players far above the marker show "??" in game; codes carry 0 for that. */
export const level = (n: number) => (n > 0 ? String(n) : "??");

export const gold = (n: number) => `${n.toLocaleString("en-US")}g`;

/** Neutralizes Discord markdown and mentions in player-supplied text. */
export function escapeMd(s: string): string {
  return s.replace(/([\\*_~`|>[\]()#-])/g, "\\$1").replace(/@/g, "@\u200b");
}
