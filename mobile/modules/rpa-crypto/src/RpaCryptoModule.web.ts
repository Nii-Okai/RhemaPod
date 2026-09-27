import { registerWebModule, NativeModule } from 'expo';

/**
 * Web is not a target platform for offline downloads (plan W4.5 is a mobile-only,
 * audio-only feature — see `expo-module.config.json`'s `web` entry, kept only so the
 * module resolves for a web bundle at all, e.g. `dev-gallery`). Every operation rejects
 * clearly instead of silently no-op'ing, so a web code path that accidentally reaches
 * this module fails loudly in development rather than shipping a broken "download".
 */
class RpaCryptoModule extends NativeModule<Record<string, never>> {
  private unsupported(op: string): never {
    throw new Error(`rpa-crypto: "${op}" is not supported on web — offline downloads are mobile-only (plan W4.5).`);
  }

  generateInstallKeyBase64(): Promise<string> {
    return Promise.reject(this.unsupported('generateInstallKeyBase64'));
  }

  encryptFile(): Promise<never> {
    return Promise.reject(this.unsupported('encryptFile'));
  }

  decryptFile(): Promise<never> {
    return Promise.reject(this.unsupported('decryptFile'));
  }

  readHeaderInfo(): Promise<never> {
    return Promise.reject(this.unsupported('readHeaderInfo'));
  }

  excludeFromBackup(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export default registerWebModule(RpaCryptoModule);
