import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Railway mounts persistent volumes at runtime, never during build. */
export const DATA_DIR = process.env.VIBE_DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || join(process.cwd(), '.vibe-data');

if ((process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN)
  && !process.env.VIBE_DATA_DIR
  && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  throw new Error('A Railway volume is required. Set VIBE_DATA_DIR or attach a volume that provides RAILWAY_VOLUME_MOUNT_PATH.');
}

export function ownerDir(ownerId: string): string {
  return join(DATA_DIR, 'users', ownerId.replace(/[^a-zA-Z0-9_-]/g, '_'));
}

export function ownerAssetDir(ownerId: string): string {
  return join(ownerDir(ownerId), 'assets');
}

export async function ensureOwnerStorage(ownerId: string): Promise<void> {
  await mkdir(ownerAssetDir(ownerId), { recursive: true });
}

export async function deleteOwnerStorage(ownerId: string): Promise<void> {
  await rm(ownerDir(ownerId), { recursive: true, force: true });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/**
 * Better Auth replaces the anonymous user id when a guest links an account.
 * Move volume-backed assets with the database ownership transfer so saved
 * projects do not lose their media after Google sign-in.
 */
export async function transferOwnerStorage(fromOwnerId: string, toOwnerId: string): Promise<void> {
  if (fromOwnerId === toOwnerId) return;
  const source = ownerDir(fromOwnerId);
  const destination = ownerDir(toOwnerId);
  if (!(await exists(source))) return;
  await mkdir(join(DATA_DIR, 'users'), { recursive: true });
  if (!(await exists(destination))) {
    await rename(source, destination);
    return;
  }

  // A returning account can already have files. Merge only missing paths and
  // keep the permanent account's existing copies when ids collide.
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (!(await exists(to))) {
      await rename(from, to);
      continue;
    }
    if (entry.isDirectory()) {
      await cp(from, to, { recursive: true, errorOnExist: false, force: false });
    }
  }
  await rm(source, { recursive: true, force: true });
}
