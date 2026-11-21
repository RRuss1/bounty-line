/** The wanted-poster art, fonts and renderer, bundled into the Worker. */
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import parchment from "../../art/poster/parchment.png";
import fell from "../assets/fonts/IMFeENrm28P.ttf";
import rye from "../assets/fonts/Rye-Regular.ttf";
import type { PosterAssets } from "./poster-image";

export const posterAssets: PosterAssets = { wasm, parchment, fonts: [rye, fell] };
