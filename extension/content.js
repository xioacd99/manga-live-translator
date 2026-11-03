import {installReader} from './content/reader.js';

// Re-injecting from the action popup must not duplicate observers or controls.
if (!globalThis.__mangaLiveTranslatorReader) {
  globalThis.__mangaLiveTranslatorReader = installReader();
}
