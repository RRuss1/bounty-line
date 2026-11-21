/**
 * Wanted-poster image (spec 8.2): the bot's text drawn on art/poster/parchment.png.
 * The PNG is attached to the forum post, so it becomes the card's cover in Gallery view.
 *
 * Pure layout + rendering: assets are passed in, so the Worker (bundled imports), the
 * tests and `npm run poster-preview` (files from disk) share this code.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";

export type PosterStatus = "open" | "review" | "awaiting_payment" | "paid" | "expired" | "cancelled";

export interface PosterInput {
  name: string;
  /** "Night Elf Monk · Level 57 · Alliance" */
  subtitle: string;
  rewardGold: number;
  postedBy: string;
  zone: string;
  markedAt: number;
  bountyId: number;
  expiresAt: number;
  boardTag: string;
  status: PosterStatus;
}

export interface PosterAssets {
  wasm: WebAssembly.Module | ArrayBuffer | Uint8Array;
  parchment: ArrayBuffer | Uint8Array;
  fonts: (ArrayBuffer | Uint8Array)[];
}

/**
 * Canvas is 3:2 because Discord's gallery cards crop covers to 3:2; the 1376×768 parchment
 * sits centered on a dark band so the whole sheet, torn edges included, shows on the card.
 */
export const CANVAS = { width: 1376, height: 917 } as const;
const SHEET = { width: 1376, height: 768, top: Math.round((917 - 768) / 2) } as const;
const CX = 688;
const INK = "#2a1708";
const RED = "#8b1a1a";
const PAPER = "#e3cfa8";

const STAMPS: Record<PosterStatus, string> = {
  open: "OPEN",
  review: "CLAIMED",
  awaiting_payment: "CLAIMED",
  paid: "PAID",
  expired: "EXPIRED",
  cancelled: "CANCELLED",
};

const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const fmtGold = (n: number) => `${n.toLocaleString("en-US")}g`;
const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Rough advance widths (em) for the two faces; good enough to keep lines inside the sheet. */
const EM = { rye: 0.72, fell: 0.46 } as const;

function line(text: string, y: number, size: number, font: keyof typeof EM, maxWidth: number, extra = "") {
  const fitted = Math.min(size, Math.floor(maxWidth / Math.max(1, text.length * EM[font])));
  const family = font === "rye" ? "Rye" : "IM FELL English";
  return (
    `<text x="${CX}" y="${y}" font-family="${family}" font-size="${fitted}" fill="${INK}" text-anchor="middle" ` +
    `stroke="${PAPER}" stroke-width="${Math.max(3, Math.round(fitted / 12))}" stroke-opacity="0.55" stroke-linejoin="round" paint-order="stroke" ${extra}>` +
    `${xml(text)}</text>`
  );
}

export function posterSvg(p: PosterInput, parchmentHref = "https://bounty-line.invalid/parchment.png"): string {
  const t = SHEET.top;
  const stamp = STAMPS[p.status];
  const stampSize = stamp.length > 5 ? 44 : 58;
  const stampW = Math.round(stamp.length * stampSize * 0.74 + 50);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">`,
    `<defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140a04"/><stop offset="1" stop-color="#1e1108"/></linearGradient></defs>`,
    `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="url(#band)"/>`,
    `<image x="0" y="${t}" width="${SHEET.width}" height="${SHEET.height}" xlink:href="${parchmentHref}" href="${parchmentHref}"/>`,
    line("WANTED", t + 135, 128, "rye", 760, `letter-spacing="6"`),
    line(p.name.toUpperCase(), t + 240, 72, "rye", 1040),
    line(p.subtitle, t + 300, 44, "fell", 1000),
    line(`REWARD ${fmtGold(p.rewardGold)}`, t + 400, 92, "rye", 980),
    line(`paid by ${p.postedBy} · honor system`, t + 458, 38, "fell", 900),
    line(`Marked in ${p.zone} · ${fmtDate(p.markedAt)}`, t + 520, 34, "fell", 860),
    line(`Bounty #${p.bountyId} · Expires ${fmtDate(p.expiresAt)}`, t + 610, 40, "fell", 640),
    line(`Board ${p.boardTag}`, t + 660, 30, "fell", 400),
    // Status stamp, top right, clear of the seal and the blood spatter.
    `<g transform="translate(1135 ${t + 95}) rotate(11)" opacity="0.88">`,
    `<rect x="${-stampW / 2}" y="-48" width="${stampW}" height="96" rx="10" fill="none" stroke="${RED}" stroke-width="7"/>`,
    `<text x="0" y="${Math.round(stampSize * 0.36)}" font-family="Rye" font-size="${stampSize}" fill="${RED}" text-anchor="middle">${stamp}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

let ready: Promise<void> | null = null;
const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

export async function renderPosterPng(p: PosterInput, assets: PosterAssets): Promise<Uint8Array> {
  ready ??= initWasm(assets.wasm instanceof WebAssembly.Module ? assets.wasm : bytes(assets.wasm)).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  const r = new Resvg(posterSvg(p), {
    font: { fontBuffers: assets.fonts.map(bytes), loadSystemFonts: false, defaultFontFamily: "IM FELL English" } as never,
  });
  try {
    for (const href of r.imagesToResolve()) r.resolveImage(href as string, bytes(assets.parchment));
    return r.render().asPng();
  } finally {
    r.free();
  }
}
