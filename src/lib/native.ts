import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNativeAndroid = Capacitor.getPlatform() === 'android';

export type NativePhotoStatus = {
  connected: boolean;
  hasSession: boolean;
  sessionExpiresAt: string | null;
  lastSyncAt: string | null;
  pickedCount: number;
  cachedCount: number;
  cacheBytes: number;
};

export type NativePhoto = {
  id: string;
  filename: string | null;
  uri: string;
};

type AtriumNativePlugin = {
  getPhotoStatus(options?: { sync?: boolean }): Promise<NativePhotoStatus>;
  syncPhotos(): Promise<NativePhotoStatus>;
  authorizePhotos(): Promise<{ connected: boolean }>;
  startPhotoPicker(): Promise<{ pickerUri: string; sessionId: string; expiresAt: string | null }>;
  listPhotos(): Promise<{ items: NativePhoto[] }>;
  signOutPhotos(): Promise<{ ok: boolean; revoked: boolean }>;
  disconnectPhotos(): Promise<{ ok: boolean }>;
  openAccountSettings(): Promise<void>;
};

export const AtriumNative = registerPlugin<AtriumNativePlugin>('AtriumNative');
