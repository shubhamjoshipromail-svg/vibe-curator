import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(resolve('public/manifest.json'), 'utf8'));
const newTab = readFileSync(resolve('src/newtab.html'), 'utf8');

describe('production manifest', () => {
  it('uses only the required permissions and exact website origin', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['storage', 'offscreen', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['https://www.google.com/*']);
    expect(manifest.externally_connectable.matches).toEqual(['https://vibe-curator-production.up.railway.app/*']);
  });

  it('declares the New Tab, popup, worker, and locked-down script policy', () => {
    // 0.2.0: the master Vibe switch and opt-in Google Search background. Store
    // versions may only increase, and 0.2.0 > the published 0.1.1 and 0.1.2.
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.chrome_url_overrides.newtab).toBe('newtab.html');
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.background).toEqual({ service_worker: 'service_worker.js', type: 'module' });
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
    expect(manifest.content_security_policy.extension_pages).not.toMatch(/script-src[^;]*https:/);
    expect(manifest.version).toBe('0.2.0');
  });

  it('restores the essential Google shortcuts without adding permissions', () => {
    expect(newTab).toContain('https://mail.google.com/mail/u/0/');
    expect(newTab).toContain('https://images.google.com/');
    expect(newTab).toContain('https://www.google.com/intl/en/about/products');
    expect(newTab).toContain('https://myaccount.google.com/');
    expect(newTab).not.toContain('id="customize"');
  });

  it('keeps branding out of the background and volume controls in the page', () => {
    expect(newTab).toContain('<title>New Tab</title>');
    expect(newTab).not.toContain('class="brand"');
    expect(newTab).toContain('id="vibe-volume"');
  });
});
