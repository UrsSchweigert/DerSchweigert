import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const site = new URL('../', import.meta.url);

test('iOS Debug and Release targets support both iPhone and iPad', async () => {
  const project = await readFile(new URL('ios/App/App.xcodeproj/project.pbxproj', site), 'utf8');
  const targetConfigurations = [...project.matchAll(/buildSettings = \{([^}]*PRODUCT_BUNDLE_IDENTIFIER[^}]*)\};\s*name = (Debug|Release);/g)];
  assert.equal(targetConfigurations.length, 2);
  for (const [, settings, name] of targetConfigurations) {
    assert.match(settings, /TARGETED_DEVICE_FAMILY = "1,2";/, name);
  }
});

test('iOS explicitly supports all iPad orientations without changing iPhone orientations', async () => {
  const plist = await readFile(new URL('ios/App/App/Info.plist', site), 'utf8');
  const orientations = key => {
    const array = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
    assert.ok(array, `${key} must be present`);
    return [...array[1].matchAll(/<string>([^<]+)<\/string>/g)].map(match => match[1]);
  };
  const phone = [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ];
  assert.deepEqual(orientations('UISupportedInterfaceOrientations'), phone);
  assert.deepEqual(orientations('UISupportedInterfaceOrientations~ipad'), [
    phone[0],
    'UIInterfaceOrientationPortraitUpsideDown',
    ...phone.slice(1),
  ]);
});
