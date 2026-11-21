// Non-code modules bundled by wrangler (module rules in wrangler.template.jsonc) and
// replaced in tests by test/helpers/setup.ts.
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
