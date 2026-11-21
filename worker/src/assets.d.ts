// Non-code modules bundled by wrangler (module rules in wrangler.template.jsonc) and
// loaded the same way in tests (vitest.config.ts).
declare module "*.png" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
