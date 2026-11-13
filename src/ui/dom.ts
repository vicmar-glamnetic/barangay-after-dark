/** Tiny DOM helper: el('div.card.big', {text}, children...) */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  props: { text?: string; html?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag as K);
  if (classes.length) node.className = classes.join(' ');
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/** Click/tap handler that works for both mouse and touch, without the 300ms delay. */
export function onTap(node: HTMLElement, fn: (e: Event) => void): void {
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    fn(e);
  });
}

/** Copy text to the clipboard with a fallback for older Safari. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
