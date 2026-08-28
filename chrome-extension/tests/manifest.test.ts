import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(resolve('public/manifest.json'), 'utf8'));
const newTab = readFileSync(resolve('src/newtab.html'), 'utf8');

describe('production manifest', () => {
  it('uses only the required permissions and exact website origin', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['storage', 'offscreen']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable.matches).toEqual(['https://vibe-curator-production.up.railway.app/*']);
  });

  it('declares the New Tab, popup, worker, and locked-down script policy', () => {
    expect(manifest.chrome_url_overrides.newtab).toBe('newtab.html');
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.background).toEqual({ service_worker: 'service_worker.js', type: 'module' });
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
    expect(manifest.content_security_policy.extension_pages).not.toMatch(/script-src[^;]*https:/);
  });

  it('restores the essential Google shortcuts without adding permissions', () => {
    expect(newTab).toContain('https://mail.google.com/mail/u/0/');
    expect(newTab).toContain('https://images.google.com/');
    expect(newTab).toContain('https://www.google.com/intl/en/about/products');
    expect(newTab).toContain('https://myaccount.google.com/');
    expect(newTab).not.toContain('id="customize"');
  });
});
