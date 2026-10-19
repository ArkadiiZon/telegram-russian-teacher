import { build } from 'esbuild';
import { builtinModules } from 'node:module';
// Nest's unused HTTP/microservice adapters are optional dynamic imports.
// A standalone application never loads them. Fail explicitly if accidentally used.
await build({
  entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', bundle: true,
  format: 'esm', platform: 'neutral', target: 'es2022',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');" },
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*'], sourcemap: true,
  plugins: [{ name: 'node-builtins', setup(b) {
    b.onResolve({filter: /^[a-z_]+(?:\/[a-z_]+)?$/}, args => builtinModules.includes(args.path) ? {path: `node:${args.path}`, external: true} : undefined);
  }}, { name: 'nest-optional-adapters', setup(b) {
    b.onResolve({ filter: /^(@nestjs\/(microservices|websockets|platform-express)|class-validator|class-transformer|load-esm)(\/.*)?$/ }, args => ({ path: args.path, namespace: 'unused-adapter' }));
    b.onLoad({ filter: /.*/, namespace: 'unused-adapter' }, args => ({
      contents: args.path === 'load-esm' ? 'exports.loadEsm = async () => { throw new Error("File validation is unavailable in this standalone Worker"); };' : `throw new Error(${JSON.stringify(`Optional Nest adapter ${args.path} is unavailable in this standalone Worker`)});`, loader: 'js'
    }));
  }}]
});
