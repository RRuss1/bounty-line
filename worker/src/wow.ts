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
  // WoW: Forever only: the Skyborne of Zephras Isle, one ID per faction.
  95: "High Order Skyborne", // Alliance
  96: "Windshaper Skyborne", // Horde
};

export const className = (id: number) => CLASSES[id] ?? `Class #${id}`;
export const raceName = (id: number) => RACES[id] ?? `Race #${id}`;
export const factionName = (id: number) => (id === 1 ? "Alliance" : id === 2 ? "Horde" : `Faction #${id}`);
/**
 * B codes carry only a uiMapID (spec Section 23 item 11). This table was read from C_Map on the
 * Forever client (1.60.1, 2026-11-21). Unknown zones are left off rather than shown as numbers.
 */
const ZONES: Record<number, string> = {
  1411: "Durotar",
  1412: "Mulgore",
  1413: "The Barrens",
  1416: "Alterac Mountains",
  1417: "Arathi Highlands",
  1418: "Badlands",
  1419: "Blasted Lands",
  1420: "Tirisfal Glades",
  1421: "Silverpine Forest",
  1422: "Western Plaguelands",
  1423: "Eastern Plaguelands",
  1424: "Hillsbrad Foothills",
  1425: "The Hinterlands",
  1426: "Dun Morogh",
  1427: "Searing Gorge",
  1428: "Burning Steppes",
  1429: "Elwynn Forest",
  1430: "Deadwind Pass",
  1431: "Duskwood",
  1432: "Loch Modan",
  1433: "Redridge Mountains",
  1434: "Stranglethorn Vale",
  1435: "Swamp of Sorrows",
  1436: "Westfall",
  1437: "Wetlands",
  1438: "Teldrassil",
  1439: "Darkshore",
  1440: "Ashenvale",
  1441: "Thousand Needles",
  1442: "Stonetalon Mountains",
  1443: "Desolace",
  1444: "Feralas",
  1445: "Dustwallow Marsh",
  1446: "Tanaris",
  1447: "Azshara",
  1448: "Felwood",
  1449: "Un'Goro Crater",
  1450: "Moonglade",
  1451: "Silithus",
  1452: "Winterspring",
  1453: "Stormwind City",
  1454: "Orgrimmar",
  1455: "Ironforge",
  1456: "Thunder Bluff",
  1457: "Darnassus",
  1458: "Undercity",
  2482: "Mount Hyjal",
  2521: "Zephras Isle",
  2548: "Riverglades",
  2652: "Shen'dralas",
  2665: "Zephras Isle",
};
export const zoneName = (mapId: number): string | null => ZONES[mapId] ?? null;

/**
 * Bounties are open world only (spec Section 10). The addon makes no kill code inside a
 * battleground, arena, dungeon, raid or scenario; this is the Bounty Board's backstop for the
 * code's mapID. Every zone in the verified table is open world. Anything else isn't refused
 * (instance map IDs on Forever aren't verified, and some caves have their own map), but it
 * can't be auto-approved: an officer looks at the screenshot.
 */
export function openWorldCheck(mapId: number): { ok: boolean; line: string } {
  const zone = zoneName(mapId);
  return zone
    ? { ok: true, line: `✅ Killed in ${zone} (open world)` }
    : {
        ok: false,
        line: `⚠️ Not a known open-world zone (map ${mapId}). Bounties don't count in battlegrounds, arenas or dungeons: check the screenshot.`,
      };
}

/** "Grief Bounty Board", or just "Bounty Board" before a name is set. */
export const boardName = (displayName: string) => `${displayName.trim()} Bounty Board`.trim();

/** Players far above the marker show "??" in game; codes carry 0 for that. */
export const level = (n: number) => (n > 0 ? String(n) : "??");

export const gold = (n: number) => `${n.toLocaleString("en-US")}g`;

/** Neutralizes Discord markdown and mentions in player-supplied text. */
export function escapeMd(s: string): string {
  return s.replace(/([\\*_~`|>[\]()#-])/g, "\\$1").replace(/@/g, "@\u200b");
}
