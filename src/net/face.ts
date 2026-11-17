import { L } from '../core/i18n';
import * as THREE from 'three';

/**
 * Custom player faces.
 * A picked image is center-cropped to a square and shrunk to 96x96 JPEG
 * (a few KB), so it is cheap to send to the lobby over WebRTC. It is kept
 * on this device only (localStorage) and never uploaded to a server.
 */
const KEY = 'barangay-after-dark:face';
const SIZE = 96;
const MAX_LEN = 16000; // chars of data URL accepted from other players

/** Only small base64 JPEG / PNG / WebP data URLs are accepted. */
export function isValidFace(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_LEN && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
}

export function loadSavedFace(): string | null {
  try {
    const s = localStorage.getItem(KEY);
    return isValidFace(s) ? s : null;
  } catch {
    return null;
  }
}

export function saveFace(face: string | null): void {
  try {
    if (face) localStorage.setItem(KEY, face);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the face still works for this session */
  }
}

/** Read an image file, crop the center square, and return a small JPEG data URL. */
export function processFaceFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(L('Larawan lang ang pwede.', 'Only pictures are allowed.')));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      if (!s) {
        reject(new Error(L('Hindi mabasa ang larawan.', "Couldn't read that picture.")));
        return;
      }
      const c = document.createElement('canvas');
      c.width = c.height = SIZE;
      const g = c.getContext('2d')!;
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIZE, SIZE);
      // step the quality down until it is small enough to send
      for (const q of [0.8, 0.65, 0.5, 0.35]) {
        const out = c.toDataURL('image/jpeg', q);
        if (out.length <= MAX_LEN) {
          resolve(out);
          return;
        }
      }
      reject(new Error(L('Masyadong malaki ang larawan.', 'That picture is too large.')));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(L('Hindi mabasa ang larawan. Subukan ang JPG o PNG.', "Couldn't read that picture. Try a JPG or PNG.")));
    };
    img.src = url;
  });
}

const cache = new Map<string, THREE.Texture>();

/** Texture for a face data URL (cached, so the same face is decoded once). */
export function faceTexture(dataUrl: string): THREE.Texture {
  let t = cache.get(dataUrl);
  if (!t) {
    const img = new Image();
    t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    const tex = t;
    img.onload = () => (tex.needsUpdate = true);
    img.src = dataUrl;
    cache.set(dataUrl, t);
  }
  return t;
}
