import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dataLua, isBountyCode, isCode, parseSetupCode, readQr } from "../lib.mjs";

const vector = JSON.parse(readFileSync(new URL("../../shared/qr-vector.json", import.meta.url), "utf8"));
const TOKEN = `111111111111111111.${"a".repeat(43)}`;
const setup = (origin) => `BLR1.${Buffer.from(origin).toString("base64url")}.${TOKEN}`;

test("setup code gives the Bounty Board's address and the token", () => {
  assert.deepEqual(parseSetupCode(setup("https://bounty-board.example.workers.dev")), { url: "https://bounty-board.example.workers.dev", token: TOKEN });
  assert.deepEqual(parseSetupCode(`  ${setup("https://b.example")}\n`), { url: "https://b.example", token: TOKEN });
});

test("setup code refuses anything that isn't a plain https address and a token", () => {
  for (const bad of ["", "hello", TOKEN, setup("http://b.example"), setup("https://b.example/path"), setup("https://u:p@b.example"), setup("not a url"), "BLR1.!!!.x"]) {
    assert.equal(parseSetupCode(bad), null, bad);
  }
});

test("only plain codes count as codes", () => {
  assert.equal(isCode(vector.code), true);
  assert.equal(isBountyCode(vector.code), false); // the vector is a kill code
  assert.equal(isBountyCode("BL1-B-04R30C1G00-1AXA"), true);
  for (const bad of ['BL1-B-AB"; os.exit() --', "bl1-b-abc-1234", "BL1-B-ABC 1234", null, 42]) assert.equal(isCode(bad), false);
});

test("the game's data file holds only codes and a time", () => {
  const lua = dataLua(["BL1-P-AAAA-1111", "BL1-P-BBBB-2222"], 1795200000);
  assert.match(lua, /^BountyLine_RelayAlive = 1795200000$/m);
  assert.match(lua, /^BountyLine_RelayPack = "BL1-P-AAAA-1111 BL1-P-BBBB-2222"$/m);
  assert.match(dataLua(null, 5), /^BountyLine_RelayPack = nil$/m);
  assert.throws(() => dataLua(['BL1-P-AAAA-1111" os.exit() --'], 1));
  assert.throws(() => dataLua(["BL1-P-AAAA-1111"], "1; evil()"));
  assert.throws(() => dataLua(new Array(9).fill("BL1-P-AAAA-1111"), 1));
});

test("reads the QR code from a JPG screenshot, and nothing from other files", () => {
  const jpg = readFileSync(new URL("../../worker/test/fixtures/qr-stamp.jpg", import.meta.url));
  assert.equal(readQr(jpg, "WoWScrnShot_112126_182541.jpg"), vector.code);
  assert.equal(readQr(jpg, "notes.txt"), null);
  assert.equal(readQr(Buffer.from("not an image"), "broken.jpg"), null);
});
