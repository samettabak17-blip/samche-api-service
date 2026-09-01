export function setSamCheFavicon(href: string) {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) return;
  favicon.dataset.normalHref = href;
  favicon.href = href;
}
