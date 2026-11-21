/**
 * Reads the kill code out of a proof screenshot. The addon's stamp draws the code as a QR code
 * under the dark band, on the left (addon UI/Stamp.lua), so a screenshot alone is a complete
 * kill claim.
 *
 * Pixels come from resvg (already bundled for the wanted poster): the screenshot is embedded
 * in an SVG and rendered, which decodes PNG and JPG without another image library. The region
 * where the stamp puts the QR code is tried first, because scanning a whole 1440p screenshot
 * costs about ten times more CPU; the whole picture is the fallback.
 */
import { Resvg } from "@resvg/resvg-wasm";
import jsQR from "jsqr";
import { initResvg } from "./poster-image";

/** Bigger files are not scanned (a 4K PNG screenshot is well under this). */
export const MAX_QR_IMAGE_BYTES = 12 * 1024 * 1024;

const TYPES = new Set(["image/png", "image/jpeg"]);
export const qrImageType = (contentType: string | undefined): string | null => {
  const t = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return TYPES.has(t) ? t : null;
};

/** Width and height from a PNG or JPG header, or null if it isn't one. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1]!;
      // SOF0..SOF15 hold the size, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Where the stamp puts the QR code, as fractions of the screenshot: lower left, under the band. */
const REGION = { x: 0, y: 0.5, w: 0.35, h: 0.42 } as const;
/** Rendered regions are scaled down to this width at most; QR modules stay several pixels wide. */
const MAX_SCAN_WIDTH = 1280;

/**
 * Returns the text of the QR code in the image, or null if none can be read.
 * wasm: the resvg module, the same one the poster uses.
 */
export async function readQr(image: Uint8Array, contentType: string, wasm: WebAssembly.Module | ArrayBuffer | Uint8Array): Promise<string | null> {
  const type = qrImageType(contentType);
  const size = imageSize(image);
  if (!type || !size || size.width < 64 || size.height < 64 || size.width > 8192 || size.height > 8192) return null;
  await initResvg(wasm);

  const href = `data:${type};base64,${base64(image)}`;
  const scan = (x: number, y: number, w: number, h: number): string | null => {
    const outWidth = Math.min(w, MAX_SCAN_WIDTH);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
      `<image xlink:href="${href}" x="0" y="0" width="${size.width}" height="${size.height}"/></svg>`;
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: outWidth }, font: { loadSystemFonts: false } });
    try {
      const rendered = resvg.render();
      try {
        const px = rendered.pixels;
        const found = jsQR(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), rendered.width, rendered.height);
        return found?.data || null;
      } finally {
        rendered.free();
      }
    } finally {
      resvg.free();
    }
  };

  const { width: W, height: H } = size;
  return (
    scan(Math.floor(W * REGION.x), Math.floor(H * REGION.y), Math.floor(W * REGION.w), Math.floor(H * REGION.h)) ?? scan(0, 0, W, H)
  );
}
