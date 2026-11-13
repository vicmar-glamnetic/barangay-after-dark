/**
 * Device and URL-flag detection. Read once at startup.
 *
 * Debug flags (append to the URL):
 *   ?touch=1  force the touch HUD on desktop (handy in Chrome DevTools device mode)
 *   ?touch=0  force the mouse/keyboard HUD
 *   ?fps=1    show an FPS counter
 *   ?q=low|high  force a quality preset for this session
 */
const params = new URLSearchParams(location.search);
const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches;

const ua = navigator.userAgent;
const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const coarse = mq('(pointer: coarse)');
const fine = mq('(pointer: fine)');

const touchFlag = params.get('touch');
const qFlag = params.get('q');

export const device = {
  isIOS,
  isAndroid,
  /** Phones and tablets: used for performance caps (DPR, antialias). */
  isMobile: isIOS || isAndroid || (coarse && !fine),
  /** Which HUD to show first. Switches live when the other input type is used. */
  prefersTouch: touchFlag === '1' || (touchFlag !== '0' && (isIOS || isAndroid || (coarse && !fine))),
  showFps: params.has('fps'),
  forceQuality: (qFlag === 'low' || qFlag === 'high' ? qFlag : null) as 'low' | 'high' | null,
  isStandalone:
    mq('(display-mode: standalone)') ||
    mq('(display-mode: fullscreen)') ||
    (navigator as unknown as { standalone?: boolean }).standalone === true,
};
