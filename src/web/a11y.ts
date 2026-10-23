/** A table wider than its box scrolls sideways; a keyboard user can only scroll it if the box can take focus.
 *  Tables are rendered in many places, so this marks every `.tbl-wrap` once, as it appears. */
export function watchScrollRegions(root: HTMLElement = document.body) {
  const mark = (el: Element) => {
    if (el.hasAttribute("tabindex")) return;
    el.setAttribute("tabindex", "0"); el.setAttribute("role", "region");
    if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", "Table (scrolls sideways on narrow screens)");
  };
  const scan = (n: ParentNode) => n.querySelectorAll(".tbl-wrap").forEach(mark);
  scan(root);
  new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) { if (n.matches(".tbl-wrap")) mark(n); scan(n); } }).observe(root, { childList: true, subtree: true });
}
