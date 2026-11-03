import {installReader} from './content/reader.js';

// 从扩展弹窗重复注入时，不得重复创建观察器或控件。
if (!globalThis.__mangaLiveTranslatorReader) {
  globalThis.__mangaLiveTranslatorReader = installReader();
}
