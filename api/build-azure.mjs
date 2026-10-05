import { build } from 'esbuild';
import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';

const root = resolve(import.meta.dirname);
const out = join(root, 'dist-azure');
const localRequire = createRequire(join(root, '../package.json'));
await mkdir(out, { recursive: true });
// Keep build output ignored without changing the parent's root ignore file.
await writeFile(join(out, '.gitignore'), '*\n');
const sdkVersion = JSON.parse(await readFile(join(root, '../node_modules/@azure/functions/package.json'), 'utf8')).version;
if (sdkVersion !== '4.16.5') throw new Error('Install the locked Azure Functions SDK before packaging');

async function packageDirectory(name, importer) {
  let current = dirname(importer.resolve(name));
  for (;;) {
    const metadata = join(current, 'package.json');
    if (existsSync(metadata)) {
      const pkg = JSON.parse(await readFile(metadata, 'utf8'));
      if (pkg.name === name) return { directory: current, pkg };
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Unable to resolve installed SDK dependency');
    current = parent;
  }
}
async function copyRuntime(name, importer, target, copied) {
  const { directory, pkg } = await packageDirectory(name, importer);
  if (copied.has(name)) {
    if (copied.get(name) !== pkg.version) throw new Error('Conflicting SDK dependency versions');
    return;
  }
  copied.set(name, pkg.version);
  const destination = join(target, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  await cp(directory, destination, { recursive: true, filter: path => path !== join(directory, 'node_modules') });
  const requireFromPackage = createRequire(join(directory, 'package.json'));
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await copyRuntime(dependency, requireFromPackage, target, copied);
}

const manifest = { runtime: 'node22', sdk: sdkVersion, provider: 'azure', artifacts: {} };
for (const [name, timeout] of [['api', '00:00:10'], ['housekeeping', '00:00:20'], ['migration', '00:00:30'], ['verification', '00:00:30']]) {
  const directory = join(out, name);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await build({ absWorkingDir: root, entryPoints: [`azure/${name}.ts`], bundle: true, platform: 'node', format: 'cjs',
    target: 'node22', outfile: join(directory, 'index.js'), external: ['pg-native', '@azure/functions'],
    tsconfigRaw: { compilerOptions: {} }, logLevel: 'warning' });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `melzi-research-${name}`, version: '1.0.0', private: true,
    type: 'commonjs', main: 'index.js', engines: { node: '>=22' }, dependencies: { '@azure/functions': sdkVersion } }, null, 2) + '\n');
  await writeFile(join(directory, 'host.json'), JSON.stringify({ version: '2.0', functionTimeout: timeout,
    extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle', version: '[4.*, 5.0.0)' },
    extensions: { http: { routePrefix: 'api' } },
    logging: { logLevel: { default: 'Warning', 'Host.Results': 'None', 'Host.Aggregator': 'None', Function: 'Error' } }
  }, null, 2) + '\n');
  const copied = new Map();
  await copyRuntime('@azure/functions', localRequire, directory, copied);
  // Resolve the SDK from the artifact itself, not accidentally from project deps.
  const artifactRequire = createRequire(join(directory, 'package.json'));
  if (!artifactRequire.resolve('@azure/functions').startsWith(directory + '/node_modules/')) throw new Error('Missing packaged Functions SDK');
  const zip = join(out, `${name}.zip`);
  await rm(zip, { force: true });
  execFileSync('zip', ['-q', '-r', zip, 'host.json', 'index.js', 'package.json', 'node_modules'], { cwd: directory });
  const bytes = await readFile(zip);
  manifest.artifacts[name] = { file: zip, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    functionTimeout: timeout, dependencies: Object.fromEntries(copied) };
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built four Azure Functions ZIPs with locally resolved, locked SDK dependencies; no deployment performed.');
