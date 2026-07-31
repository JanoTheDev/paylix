/**
 * Email normalization + disposable-domain filtering for the indexer.
 *
 * Mirror of apps/web/lib/email-normalize.ts. The indexer cannot import from
 * apps/web, and both sides must agree: checkout refuses a domain at signup, so
 * the recovery/trial mailers must refuse the same domain later. If you change
 * one file, change the other — the copies had drifted to 6 vs 148 domains, which
 * meant the abandonment mailer emailed addresses checkout itself rejects.
 *
 * Normalization rules:
 * - lowercase the whole address
 * - for @gmail.com / @googlemail.com only: strip dots and drop everything from
 *   the first '+' onward in the local part
 * - other providers are lowercased only — most don't treat dots/plus as aliases
 */
export function normalizeEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const noPlus = local.split("+", 1)[0];
    const noDots = noPlus.replace(/\./g, "");
    return `${noDots}@gmail.com`;
  }
  return trimmed;
}

export function normalizeEmailOrNull(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!trimmed) return null;
  return normalizeEmail(trimmed);
}

export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "tempinbox.com",
  "throwawaymail.com",
  "throwaway.email",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "fakemailgenerator.com",
  "fakemail.net",
  "trashmail.com",
  "trashmail.net",
  "trashmail.io",
  "trashmail.de",
  "maildrop.cc",
  "mintemail.com",
  "tempemail.net",
  "tempmailaddress.com",
  "spambog.com",
  "spambog.de",
  "spam4.me",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "moakt.com",
  "moakt.cc",
  "emailondeck.com",
  "fakeinbox.com",
  "mailcatch.com",
  "mailnesia.com",
  "mailnull.com",
  "anonbox.net",
  "boun.cr",
  "burnermail.io",
  "deadaddress.com",
  "easytrashmail.com",
  "fakeinbox.net",
  "filzmail.com",
  "harakirimail.com",
  "incognitomail.com",
  "jetable.org",
  "kasmail.com",
  "kurzepost.de",
  "letthemeatspam.com",
  "lookugly.com",
  "meltmail.com",
  "mt2014.com",
  "mt2015.com",
  "mytrashmail.com",
  "no-spam.ws",
  "nobulk.com",
  "noclickemail.com",
  "objectmail.com",
  "oneoffemail.com",
  "owlpic.com",
  "pookmail.com",
  "proxymail.eu",
  "punkass.com",
  "rcpt.at",
  "recode.me",
  "recursor.net",
  "rmqkr.net",
  "safe-mail.net",
  "selfdestructingmail.com",
  "sendspamhere.com",
  "shieldedmail.com",
  "shitmail.me",
  "shortmail.net",
  "smellfear.com",
  "snakemail.com",
  "sneakemail.com",
  "sofort-mail.de",
  "sogetthis.com",
  "spamavert.com",
  "spambox.us",
  "spamcero.com",
  "spamday.com",
  "spamex.com",
  "spamfree24.org",
  "spamgourmet.com",
  "spamhereplease.com",
  "spamhole.com",
  "spamify.com",
  "spaml.com",
  "spamspot.com",
  "spamthis.co.uk",
  "spamthisplease.com",
  "speed.1s.fr",
  "supergreatmail.com",
  "supermailer.jp",
  "suremail.info",
  "tempalias.com",
  "tempemail.biz",
  "tempemail.co.za",
  "tempinbox.co.uk",
  "tempymail.com",
  "thanksnospam.info",
  "thankyou2010.com",
  "thecloudindex.com",
  "tilien.com",
  "tmailinator.com",
  "tradermail.info",
  "tyldd.com",
  "uggsrock.com",
  "veryrealemail.com",
  "wegwerfadresse.de",
  "wegwerfemail.de",
  "wegwerfmail.de",
  "wegwerfmail.info",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "wh4f.org",
  "willhackforfood.biz",
  "willselfdestruct.com",
  "winemaven.info",
  "wronghead.com",
  "wuzup.net",
  "wuzupmail.net",
  "xagloo.com",
  "xemaps.com",
  "xents.com",
  "xmaily.com",
  "xoxy.net",
  "yapped.net",
  "yeah.net",
  "yourdomain.com",
  "ypmail.webarnak.fr.eu.org",
  "yuurok.com",
  "zehnminutenmail.de",
  "zetmail.com",
  "zippymail.info",
  "zoaxe.com",
  "zoemail.org",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
