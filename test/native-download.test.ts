import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { FALLBACK_DMG_URL, latestMacDmg } from '../server/native-download.ts';

test('latestMacDmg includes prereleases, rejects drafts, and prefers arm64', () => {
  const selected = latestMacDmg([
    {
      draft: true,
      published_at: '2026-09-03T00:00:00Z',
      assets: [{ name: 'draft-arm64.dmg', browser_download_url: FALLBACK_DMG_URL }],
    },
    {
      prerelease: true,
      published_at: '2026-09-02T00:00:00Z',
      assets: [
        { name: 'Vibe-Curator-x64.dmg', browser_download_url: FALLBACK_DMG_URL.replace('arm64-', 'x64-') },
        { name: 'Vibe-Curator-arm64.dmg.sha256', browser_download_url: `${FALLBACK_DMG_URL}.sha256` },
        { name: 'Vibe-Curator-arm64.dmg', browser_download_url: FALLBACK_DMG_URL },
      ],
    },
    {
      draft: false,
      published_at: '2026-09-01T00:00:00Z',
      assets: [{ name: 'older-arm64.dmg', browser_download_url: FALLBACK_DMG_URL }],
    },
  ]);
  assert.equal(selected, FALLBACK_DMG_URL);
});

test('latestMacDmg rejects downloads outside the repository', () => {
  assert.equal(latestMacDmg([{
    published_at: '2026-09-02T00:00:00Z',
    assets: [{ name: 'malicious.dmg', browser_download_url: 'https://example.com/malicious.dmg' }],
  }]), undefined);
});
