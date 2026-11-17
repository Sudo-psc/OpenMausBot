const MARKERS = Object.freeze([
  "1password", "bitwarden", "dashlane", "lastpass", "keepass", "enpass", "proton pass", "keychain", "authenticator",
  "password", "senha", "passcode", "2fa", "otp", "bank", "banco", "nubank", "itau", "bradesco", "santander",
  "paypal", "wallet", "carteira", "credit card", "cartao",
]);

const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** An app or window name that suggests passwords, banking or payment. Substring matching on purpose: a false match only
 * leaves some context out, while a miss would send a private title to the bot. A site inside a browser is not caught by
 * the app's name, only by a title that says so. */
export function isSensitiveName(name) {
  if (typeof name !== "string") return false;
  const text = normalize(name);
  return MARKERS.some(marker => text.includes(marker));
}
