import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

const require = createRequire(import.meta.url);
const PREFIX = "\0binary:";

/**
 * Mirrors wrangler's module rules: .png/.ttf as ArrayBuffer, .wasm as a compiled module.
 * Virtual ids keep Vitest from handing node_modules .wasm files straight to Node.
 */
const binaryModules: Plugin = {
  name: "binary-modules",
  enforce: "pre",
  resolveId(source, importer) {
    if (!/\.(png|ttf|wasm)$/.test(source)) return undefined;
    const file = source.startsWith(".") && importer ? resolve(dirname(importer), source) : require.resolve(source);
    return PREFIX + file;
  },
  load(id) {
    if (!id.startsWith(PREFIX)) return undefined;
    const file = JSON.stringify(id.slice(PREFIX.length));
    return file.endsWith('.wasm"')
      ? `import { readFileSync } from "node:fs";\nexport default new WebAssembly.Module(readFileSync(${file}));`
      : `import { readFileSync } from "node:fs";\nconst b = readFileSync(${file});\nexport default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);`;
  },
};

export default defineConfig({ plugins: [binaryModules] });
