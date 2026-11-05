import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/deploy.yml', root), 'utf8');
const main = await readFile(new URL('infra/terraform/sites/lesen/main.tf', root), 'utf8');
const outputs = await readFile(new URL('infra/terraform/sites/lesen/outputs.tf', root), 'utf8');
const deploy = workflow.slice(workflow.indexOf('\n  deploy-lesen:'));
const assets = [
  'images/buchstabenzeit-logo.png',
  'favicon.png',
  'fonts/andika-latin-regular.woff2',
  'fonts/andika-latin-bold.woff2',
  'fonts/OFL.txt',
];

function step(name) {
  const marker = `      - name: ${name}\n        run: |\n`;
  const start = deploy.indexOf(marker);
  assert.notEqual(start, -1, `Missing deployment step: ${name}`);
  return deploy.slice(start + marker.length).split('\n      - ')[0]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
}

function runMocked(script) {
  const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', `
terraform() {
  [ "$1" = "-chdir=infra/terraform/sites/lesen" ] || return 90
  [ "$2" = output ] && [ "$3" = -raw ] || return 91
  case "$4" in
    site_bucket) echo app-bucket ;;
    cloudfront_distribution_id) echo APP-DIST ;;
    marketing_site_bucket) echo marketing-bucket ;;
    marketing_cloudfront_distribution_id) echo MARKETING-DIST ;;
    *) return 92 ;;
  esac
}
aws() { printf 'AWS %s\\n' "$*"; }
curl() {
  printf 'CURL %s\\n' "$*" >&2
  printf '<title>Buchstabenzeit</title>\\n'
}
sleep() { :; }
test() {
  if [ "$1" = -s ]; then
    [ "$2" = sites/lesen/marketing/index.html ]
  else
    builtin test "$@"
  fi
}
${script}
`], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

test('marketing has a separate static site and prefixed outputs without changing app identity', () => {
  assert.match(main, /app_name = "derschweigert-lesen"/);
  assert.match(main, /domain\s+= "lesen\.derschweigert\.de"/);
  const marketing = main.slice(main.indexOf('module "marketing"'));
  assert.match(marketing, /source = "\.\.\/\.\.\/modules\/static_site"/);
  assert.match(marketing, /app_name\s+= "derschweigert-buchstabenzeit"/);
  assert.match(marketing, /domain\s+= "buchstabenzeit\.derschweigert\.de"/);
  assert.match(marketing, /default_root_object\s+= "index\.html"/);
  assert.match(marketing, /route53_zone_id\s+= var\.route53_zone_id/);
  assert.match(marketing, /aws\.us_east_1 = aws\.us_east_1/);
  assert.doesNotMatch(main, /additional_aliases/);
  for (const name of ['site_bucket', 'cloudfront_distribution_id', 'cloudfront_domain_name']) {
    assert.match(outputs, new RegExp(`output "${name}" \\{\\s+value = module\\.site\\.${name}`));
    assert.match(outputs, new RegExp(`output "marketing_${name}" \\{\\s+value = module\\.marketing\\.${name}`));
  }
});

test('marketing CSP permits its existing app-hosted images and fonts', () => {
  const marketing = main.slice(main.indexOf('module "marketing"'));
  assert.match(marketing, /img-src 'self' data: https:\/\/lesen\.derschweigert\.de;/);
  assert.match(marketing, /font-src 'self' https:\/\/lesen\.derschweigert\.de;/);
  assert.match(marketing, /style-src 'self' 'unsafe-inline'/);
});

test('both site bundles are uploaded to their own bucket root', () => {
  const app = runMocked(step('Upload static site files')).stdout;
  assert.match(app, /AWS s3 sync sites\/lesen\/static\/ s3:\/\/app-bucket\//);
  assert.match(app, /AWS s3 cp sites\/lesen\/static\/index.html s3:\/\/app-bucket\/index.html/);
  assert.doesNotMatch(app, /marketing/);
  const marketingScript = step('Upload marketing site files');
  assert.match(marketingScript, /test -s sites\/lesen\/marketing\/index\.html/);
  const marketing = runMocked(marketingScript).stdout;
  assert.match(marketing, /AWS s3 sync sites\/lesen\/marketing\/ s3:\/\/marketing-bucket\/ --delete/);
  assert.match(marketing, /--exclude index\.html/);
  assert.match(marketing, /AWS s3 cp sites\/lesen\/marketing\/index\.html s3:\/\/marketing-bucket\/index\.html --cache-control no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(marketing, /app-bucket/);
});

test('English language module is included in the marketing site bundle', async () => {
  const uploaded = runMocked(step('Upload marketing site files')).stdout;
  assert.ok(uploaded.includes('AWS s3 sync sites/lesen/marketing/ s3://marketing-bucket/'));
  const languageModule = await readFile(new URL('sites/lesen/marketing/language.mjs', root));
  assert.ok(languageModule.length > 0);
});

test('marketing copies the existing logo, favicon, fonts and licence to its own root', async () => {
  const uploaded = runMocked(step('Upload marketing site files')).stdout;
  for (const asset of assets) {
    const source = await readFile(new URL(`sites/lesen/static/${asset}`, root));
    assert.ok(source.length > 0, `Missing source asset: ${asset}`);
    const command = `AWS s3 cp sites/lesen/static/${asset} s3://marketing-bucket/${asset} --cache-control no-cache, must-revalidate`;
    assert.ok(uploaded.includes(command), `Missing marketing asset upload: ${asset}`);
    assert.ok(uploaded.indexOf(command) < uploaded.indexOf('AWS s3 cp sites/lesen/marketing/index.html'));
  }
});

test('cache invalidations use separate distributions and marketing waits for completion', () => {
  const app = runMocked(step('Invalidate CloudFront cache')).stdout;
  assert.match(app, /AWS cloudfront create-invalidation --distribution-id APP-DIST --paths \/\*/);
  const marketing = runMocked(step('Invalidate marketing CloudFront cache')).stdout;
  assert.match(marketing, /AWS cloudfront wait invalidation-completed --distribution-id MARKETING-DIST/);
  assert.match(marketing, /cloudfront create-invalidation --distribution-id MARKETING-DIST --paths \/\*/);
  assert.doesNotMatch(marketing, /--distribution-id APP-DIST/);
});

test('smoke tests request both exact production root URLs without redirect following', () => {
  const app = runMocked(step('Smoke test')).stderr;
  assert.match(app, /CURL -sf https:\/\/lesen\.derschweigert\.de\/\n/);
  const marketing = runMocked(step('Smoke test marketing site')).stderr;
  assert.match(marketing, /CURL --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 10 https:\/\/buchstabenzeit\.derschweigert\.de\/\n/);
  assert.doesNotMatch(marketing, /--location| -L /);
});

test('CI runs deployment regression tests for lesen infrastructure changes', () => {
  assert.match(workflow, /sites\/lesen\/\*\|infra\/terraform\/sites\/lesen\/\*\) lesen_tests=true/);
  assert.match(workflow, /node --test sites\/lesen\/tests\/\*\.test\.mjs/);
  assert.match(deploy, /needs: \[test, check-secrets, changes\]/);
  assert.match(deploy, /needs\.changes\.outputs\.lesen == 'true'/);
});
