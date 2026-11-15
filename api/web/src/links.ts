// Links Path of Building asks the page to open come from build text, which anyone can write.
// Only http and https may leave the page.
export function safeExternalUrl(url: string | URL | undefined): string | null {
  const href = String(url ?? "");
  return /^https?:\/\//i.test(href) ? href : null;
}
