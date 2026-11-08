import { chmod, cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

// Keep the checkout layout: Xcode's preparation phase regenerates www and SPM
// from these inputs, rather than merely consuming the last copied public folder.
export const IOS_PROJECT_INPUTS = [
  'sites/ffm/static',
  'sites/ffm/app/level_data.json',
  'sites/ffm/mobile/package.json',
  'sites/ffm/mobile/package-lock.json',
  'sites/ffm/mobile/capacitor.config.json',
  'sites/ffm/mobile/game',
  'sites/ffm/mobile/legal',
  'sites/ffm/mobile/scripts',
  'sites/ffm/mobile/ios',
  'sites/ffm/mobile/node_modules',
  'tools/ios/prepare-capacitor.sh',
];

// SwiftPM caches include absolute binary-artifact and local-package paths.
// Rebase those after extraction; Git object alternates can stay relative.
export async function relocateSwiftPackages(projectRoot) {
  const root = resolve(projectRoot);
  const cache = join(root, 'swift-packages');
  const stateFile = join(cache, 'workspace-state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  for (const artifact of state.object?.artifacts ?? []) {
    const offset = artifact.path.lastIndexOf('/artifacts/');
    if (offset < 0) throw new Error(`Unsupported Swift artifact path: ${artifact.path}`);
    artifact.path = join(cache, artifact.path.slice(offset + 1));
    await stat(artifact.path);
  }
  for (const dependency of state.object?.dependencies ?? []) {
    if (dependency.packageRef.kind !== 'fileSystem') continue;
    const location = dependency.packageRef.location;
    const offset = location.lastIndexOf('/sites/ffm/mobile/');
    if (offset < 0) throw new Error(`Unsupported local Swift dependency: ${location}`);
    const path = join(root, location.slice(offset + 1));
    await stat(path);
    dependency.packageRef.location = path;
    dependency.state.path = path;
  }
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  for (const entry of await readdir(join(cache, 'checkouts'))) {
    const objects = join(cache, 'checkouts', entry, '.git', 'objects');
    const alternatesFile = join(objects, 'info', 'alternates');
    const alternates = await readFile(alternatesFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!alternates) continue;
    const rebased = [];
    for (const path of alternates.trim().split('\n')) {
      const offset = path.lastIndexOf('/repositories/');
      if (isAbsolute(path) && offset < 0) throw new Error(`External Git objects are not self-contained: ${path}`);
      const target = isAbsolute(path) ? join(cache, path.slice(offset + 1)) : resolve(objects, path);
      const rel = relative(cache, target);
      if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`External Git objects: ${path}`);
      await stat(target);
      rebased.push(relative(objects, target));
    }
    await chmod(alternatesFile, 0o644);
    await writeFile(alternatesFile, `${rebased.join('\n')}\n`);
  }
}

export async function stageIosProject({
  repositoryRoot = repository,
  stagingParent = repositoryRoot,
  swiftPackagesDirectory,
} = {}) {
  if (!swiftPackagesDirectory) throw new Error('A resolved Xcode Swift package cache is required');
  const root = resolve(repositoryRoot);
  const parent = resolve(stagingParent);
  const assets = join(root, 'sites/ffm/mobile/assets');
  const hasAssets = (await stat(assets).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }))?.isDirectory();
  const sources = [
    ...IOS_PROJECT_INPUTS.map((input) => join(root, input)),
    resolve(swiftPackagesDirectory),
    ...(hasAssets ? [assets] : []),
  ];
  // Never stage inside an input tree (recursive cp could otherwise copy itself).
  for (const source of sources) {
    const rel = relative(source, parent);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
      throw new Error(`Staging parent must be outside build inputs: ${source}`);
    }
    await stat(source);
  }
  await stat(join(root, 'sites/ffm/mobile/node_modules/.bin/cap'));
  await stat(join(root, 'sites/ffm/mobile/ios/App/CapApp-SPM/Package.swift'));
  await stat(join(root, 'sites/ffm/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'));
  for (const entry of ['checkouts', 'repositories', 'workspace-state.json']) {
    await stat(join(swiftPackagesDirectory, entry));
  }

  const stage = await mkdtemp(join(parent, '.ffm-ios-stage-'));
  for (const input of IOS_PROJECT_INPUTS) {
    const source = join(root, input);
    const dest = join(stage, input);
    await mkdir(dirname(dest), { recursive: true });
    const isIos = input === 'sites/ffm/mobile/ios';
    await cp(source, dest, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => basename(path) !== '.DS_Store' && (!isIos ||
        !/^(?:xcuserdata|build|config \d+\.xml)$/.test(basename(path))),
    });
  }
  // SPM dependencies are remote even though Capacitor plugins live in npm.
  // Retain the whole cache, including repositories and artifacts, for offline
  // resolution with xcodebuild's explicit clonedSourcePackagesDirPath.
  await cp(swiftPackagesDirectory, join(stage, 'swift-packages'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  if (hasAssets) {
    await cp(assets, join(stage, 'sites/ffm/mobile/assets'), { recursive: true, verbatimSymlinks: true });
  }
  await relocateSwiftPackages(stage);
  return stage;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--relocate') await relocateSwiftPackages(process.argv[3] ?? repository);
  else console.log(await stageIosProject({ swiftPackagesDirectory: process.argv[2] }));
}
