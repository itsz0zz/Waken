import { HttpError, fetchWithTimeout } from './http';

/**
 * PlayStation Network sign-in, as the official Remote Play app does it (chiaki-ng's way): the user signs in on
 * Sony's own page, Sony sends the browser to its redirect address with a one-time code, and that code becomes the
 * account id a PS5 is linked with. The password never goes through Waken.
 */
const CLIENT_ID = 'ba495a24-818c-472b-b12d-ff231c1b5745';
const CLIENT_SECRET = 'mvaiZkRsAsI1IBkY';
const SCOPE = 'psn:clientapp referenceDataService:countryConfig.read pushNotification:webSocket.desktop.connect sessionManager:remotePlaySession.system.update';
const REDIRECT = 'https://remoteplay.dl.playstation.net/remoteplay/redirect';
const TOKEN_URL = 'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token';

export const PSN_LOGIN_URL =
  'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?service_entity=urn:service-entity:psn&response_type=code' +
  `&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPE)}` +
  '&request_locale=fr_FR&ui=pr&service_logo=ps&layout_type=popup&smcid=remoteplay&prompt=always&PlatformPrivacyWs1=minimal';

export interface PsnAccount {
  /** The account id, 8 bytes little endian in base64: what a console is linked with. */
  accountId: string;
  /** For Remote Play over the Internet (Sony's servers), later. */
  refreshToken?: string;
}

/** The one-time code in the address Sony sent the browser to (or the code itself, pasted alone). */
export function psnCodeFrom(pasted: string): string | null {
  const text = pasted.trim();
  const match = /[?&]code=([^&#\s]+)/.exec(text);
  if (match) return decodeURIComponent(match[1]!);
  return /^[A-Za-z0-9_-]{4,}$/.test(text) ? text : null;
}

/** The account id as chiaki wants it: the user id's 8 bytes, little endian, in base64. */
export function accountIdFromUserId(userId: string): string {
  let value = BigInt(userId);
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : alphabet[c & 63]!;
  }
  return out;
}

const basic = () => {
  const raw = `${CLIENT_ID}:${CLIENT_SECRET}`;
  // btoa exists in React Native and in tests.
  return `Basic ${btoa(raw)}`;
};

/** Exchanges the code from Sony's redirect for the account id. */
export async function psnAccountFromCode(code: string): Promise<PsnAccount> {
  const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT)}`;
  const token = await fetchWithTimeout(TOKEN_URL, { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 15_000);
  if (!token.ok) throw new HttpError(token.status, 'Sony a refusé le code : reconnecte-toi, il ne sert qu’une fois et expire vite.');
  const tokens = (await token.json()) as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token) throw new Error('Sony n’a pas donné de jeton.');
  const info = await fetchWithTimeout(`${TOKEN_URL}/${encodeURIComponent(tokens.access_token)}`, { headers: { Authorization: basic() } }, 15_000);
  if (!info.ok) throw new HttpError(info.status, 'Compte PSN illisible.');
  const { user_id: userId } = (await info.json()) as { user_id?: string };
  if (!userId || !/^\d+$/.test(userId)) throw new Error('Compte PSN illisible.');
  return { accountId: accountIdFromUserId(userId), refreshToken: tokens.refresh_token };
}
