/**
 * Prints a valid bounty (B) code for testing the Bounty Board before the addon exists.
 *
 *   npm run test-code -- --tag MT8H --reward 500 --name "Grimlok Ashveil"
 *
 * Options (all optional):
 *   --tag XXXX          board tag (default 0000 = "no board yet", accepted by any board)
 *   --reward N          gold (default 1)
 *   --name "First Last" target name (default: a random one)
 *   --target horde|alliance   target faction (default horde); the poster is the other one
 *   --same-faction      make an invalid same-faction code (to test the FACTION reply)
 *   --note "text"       note (max 80 bytes)
 *   --poster "Name"     poster character name (default "Test Poster")
 *
 * The target GUID is random each time, so each code is a new bounty.
 */
import { encode, FACTION } from "../src/codec";
import { _unsafe } from "../src/codec";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const FIRST = ["Grimlok", "Mograth", "Zul'gor", "Vexa", "Thrall'ka", "Rokhan", "Sylvra", "Draxx"];
const LAST = ["Ashveil", "Skullsplitter", "Bloodfang", "Nightwhisper", "Ironjaw", "Dreadmane"];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const hex8 = () => Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0");

const target = (opt("target") ?? "horde").toLowerCase() === "alliance" ? FACTION.Alliance : FACTION.Horde;
const poster = flag("same-faction") ? target : target === FACTION.Horde ? FACTION.Alliance : FACTION.Horde;

const fields = {
  schema: 1,
  boardTag: (opt("tag") ?? "0000").toUpperCase(),
  targetGUID: `Player-4395-${hex8()}`,
  targetName: opt("name") ?? `${pick(FIRST)} ${pick(LAST)}`,
  targetClassID: 1 + Math.floor(Math.random() * 11),
  targetRaceID: target === FACTION.Horde ? pick([2, 5, 6, 8]) : pick([1, 3, 4, 7]),
  targetLevel: 30 + Math.floor(Math.random() * 31),
  targetFaction: target,
  posterFaction: poster,
  rewardGold: Number(opt("reward") ?? 1),
  posterGUID: `Player-4395-${hex8()}`,
  posterName: opt("poster") ?? "Test Poster",
  mapID: 1434,
  createdAt: Math.floor(Date.now() / 1000),
  nonce: Math.floor(Math.random() * 65536),
  note: opt("note") ?? "",
  mode: 0,
  existingBountyId: 0,
};

// The real encoder refuses same-faction codes, so the test for that case writes the bytes directly.
const code = flag("same-faction") ? _unsafe.wrapBytes("B", _unsafe.payload("B", fields)) : encode("B", fields);
console.log(code);
