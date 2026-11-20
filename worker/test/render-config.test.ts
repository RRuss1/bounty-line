import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnvFile, renderTemplate } from "../scripts/render-config";

const template = readFileSync(new URL("../wrangler.template.jsonc", import.meta.url), "utf8");
const required = { WORKER_NAME: "bounty-board-test", D1_NAME: "bb-test", D1_ID: "0000-id", R2_BUCKET: "bb-proofs", ALLOWED_GUILD_IDS: "1,2" };

describe("render-config", () => {
  it("fills required values and defaults", () => {
    const out = renderTemplate(template, required);
    expect(out).toContain('"name": "bounty-board-test"');
    expect(out).toContain('"database_id": "0000-id"');
    expect(out).toContain('"READ_CHAT": "true"');
    expect(out).toContain('"AI_DAILY_CAP": "200"');
    expect(out).not.toMatch(/\$\{/);
  });
  it("lets deployment values override defaults", () => {
    expect(renderTemplate(template, { ...required, READ_CHAT: "false" })).toContain('"READ_CHAT": "false"');
  });
  it("lists every missing required value", () => {
    expect(() => renderTemplate(template, { WORKER_NAME: "x" })).toThrow(/D1_NAME, D1_ID, R2_BUCKET, ALLOWED_GUILD_IDS/);
  });
  it("escapes values so they can't break out of JSON strings", () => {
    const out = renderTemplate('{"a": "${X}"}', { X: 'evil", "b": "1' });
    expect(JSON.parse(out)).toEqual({ a: 'evil", "b": "1' });
  });
  it("parses env files", () => {
    expect(parseEnvFile('# comment\nA=1\nB = "two"\n\nC=\'3\'\nbad line\n')).toEqual({ A: "1", B: "two", C: "3" });
  });
  it("the committed template holds no deployment values", () => {
    expect(template).not.toMatch(/[0-9]{17,20}/); // no Discord IDs
    expect(template).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no D1 database IDs
  });
});
