import { L } from '../core/i18n';
import { device } from '../core/device';
import { copyText, el, onTap } from './dom';

const TRIED_KEY = 'hnk:escape-tried';

/** Android: an intent URL that opens this page in Chrome (falls back to the same URL). */
function chromeIntent(): string {
  const { host, pathname, search, hash } = location;
  return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
}

/** Android: let the system pick any browser (no package). */
function anyBrowserIntent(): string {
  const { host, pathname, search, hash } = location;
  return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
}

/**
 * Links opened from Facebook / Messenger / Instagram land in that app's own
 * browser, where fullscreen, sound and multiplayer often break.
 *  - Android: jump straight to Chrome with an intent:// link (once per tab;
 *    the overlay's button tries again, then offers any browser).
 *  - iPhone: apps cannot be forced out, so try Safari's x-safari-https://
 *    scheme and show how to use the app's own "Open in browser" menu.
 * The player can always choose to keep playing where they are.
 */
export function escapeInAppBrowser(parent: HTMLElement): void {
  if (!device.inApp) return;

  let tried = false;
  try {
    tried = sessionStorage.getItem(TRIED_KEY) === '1';
    sessionStorage.setItem(TRIED_KEY, '1');
  } catch {
    /* storage blocked */
  }
  if (device.isAndroid && !tried) {
    location.href = chromeIntent();
  }

  const app = device.inAppName === 'app na ito' ? L('app na ito', 'this app') : device.inAppName;
  const steps = device.isIOS
    ? L(`Pindutin ang <b>•••</b> o <b>⋯</b> sa ${app}, tapos <b>"Open in external browser"</b> o <b>"Buksan sa Safari"</b>.`,
        `Tap <b>•••</b> or <b>⋯</b> in ${app}, then <b>"Open in external browser"</b> or <b>"Open in Safari"</b>.`)
    : L(`Kung hindi bumukas, pindutin ang <b>⋮</b> sa itaas, tapos <b>"Open in Chrome"</b> o <b>"Open in browser"</b>.`,
        `If nothing opened, tap <b>⋮</b> at the top, then <b>"Open in Chrome"</b> or <b>"Open in browser"</b>.`);
  const openBtn = el('button.btn', { text: device.isIOS ? L('Buksan sa Safari', 'Open in Safari') : L('Buksan sa Chrome', 'Open in Chrome') });
  const otherBtn = el('button.btn.alt.small', { text: device.isIOS ? L('Kopyahin ang link', 'Copy the link') : L('Ibang browser', 'Another browser') });
  const stayBtn = el('button.btn.alt.small', { text: L('Dito na lang', 'Stay here') });
  const note = el('p.hint');
  const card = el(
    'div.card',
    {},
    el('h2', { text: L('Buksan sa browser', 'Open in your browser') }),
    el('p', { text: L(
      `Nasa loob ka ng ${app}. Mas maayos ang laro sa ${device.isIOS ? 'Safari' : 'Chrome'}: full screen, may tunog, at gumagana ang multiplayer.`,
      `You're inside ${app}. The game works much better in ${device.isIOS ? 'Safari' : 'Chrome'}: full screen, sound, and multiplayer.`,
    ) }),
    el('div.btns.col', {}, openBtn, otherBtn, stayBtn),
    el('p', { html: steps }),
    note,
  );
  const layer = el('div.screen.dim.interactive.escape', {}, card);
  layer.addEventListener('pointerdown', (e) => e.stopPropagation());
  parent.append(layer);

  onTap(openBtn, () => {
    if (device.isIOS) {
      // iOS 17+ honours this scheme from many in-app browsers; harmless if not
      location.href = 'x-safari-' + location.href;
      note.textContent = L('Kung walang nangyari, sundin ang mga hakbang sa ibaba.', 'If nothing happened, follow the steps below.');
    } else location.href = chromeIntent();
  });
  onTap(otherBtn, async () => {
    if (device.isIOS) {
      const ok = await copyText(location.href);
      note.textContent = ok ? L('Nakopya! I-paste sa Safari.', 'Copied! Paste it into Safari.') : location.href;
    } else location.href = anyBrowserIntent();
  });
  onTap(stayBtn, () => layer.remove());
}
