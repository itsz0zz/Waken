import { fetchWithTimeout, HttpError, json } from './http';

/** What the Waken accounts give after signing in. The app keeps it in its secure storage. */
export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch: past this, the access token is refreshed first. */
  expiresAt: number;
}

/** What starts the Waken network on a new device, without any Tailscale page (server/Waken.Cloud, /network/join). */
export interface JoinTicket {
  controlUrl: string;
  /** Single-use, a few minutes: given straight to the tunnel, never stored. */
  authKey: string;
  expiresAt: string;
}

/** One of the account's notifications (the bell): new device, machine ready, end of a session. */
export interface CloudNotification {
  id: number;
  title: string;
  body: string;
  kind: 'device' | 'machine' | 'session' | string;
  createdAt: string;
  read: boolean;
}

/** What Sign in with Apple gives the app, sent as is to the Waken accounts. */
export interface AppleCredential {
  identityToken: string;
  /** One-time, lets the server revoke Apple's tokens when the account is deleted. */
  authorizationCode?: string | null;
}

export interface CloudDevice {
  id: string;
  name: string;
  online: boolean;
  lastSeen?: string;
  ip?: string;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** A refresh a minute early: a token that expires on the way is still refused. */
const EARLY_MS = 60_000;

/** ASP.NET Identity's error codes, in the app's words. */
const identityMessages: Record<string, string> = {
  DuplicateUserName: 'Un compte existe déjà avec cet e-mail.',
  DuplicateEmail: 'Un compte existe déjà avec cet e-mail.',
  InvalidEmail: "Cet e-mail n'est pas valide.",
  InvalidUserName: "Cet e-mail n'est pas valide.",
  PasswordTooShort: 'Le mot de passe doit faire au moins 10 caractères.',
};

/**
 * The Waken accounts: an e-mail and a password, then the network on every device without seeing Tailscale.
 * Sessions refresh on their own; onSession tells the app when to save (or forget) the new one.
 */
export class WakenCloud {
  private refreshing?: Promise<CloudSession>;

  constructor(
    private baseUrl: string,
    private session: CloudSession | null,
    private onSession: (session: CloudSession | null) => void,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get signedIn() {
    return this.session !== null;
  }

  async register(email: string, password: string) {
    const res = await fetchWithTimeout(`${this.baseUrl}/account/register`, post({ email: email.trim(), password }), 10_000);
    if (!res.ok) throw new HttpError(res.status, identityError(await res.text()) ?? `Inscription impossible (erreur ${res.status}).`);
    await this.signIn(email, password);
  }

  /** Sign in with Apple: a new Apple ID gets a new account, a known one its own. */
  async signInWithApple(credential: AppleCredential) {
    const res = await fetchWithTimeout(`${this.baseUrl}/account/apple`, post(credential), 15_000);
    if (res.status === 409) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail : connecte-toi avec ton mot de passe.');
    if (res.status === 401) throw new HttpError(401, 'Apple n’a pas confirmé ton identité, réessaie.');
    if (res.status === 429) throw new HttpError(429, 'Trop de tentatives, réessaie dans une minute.');
    if (!res.ok) throw new HttpError(res.status, `Connexion avec Apple impossible (erreur ${res.status}).`);
    this.use((await res.json()) as TokenResponse);
  }

  async signIn(email: string, password: string) {
    const res = await fetchWithTimeout(`${this.baseUrl}/account/login?useCookies=false`, post({ email: email.trim(), password }), 10_000);
    if (res.status === 401) throw new HttpError(401, 'E-mail ou mot de passe incorrect. Après 5 essais, le compte se bloque 5 minutes.');
    if (res.status === 429) throw new HttpError(429, 'Trop de tentatives, réessaie dans une minute.');
    if (!res.ok) throw new HttpError(res.status, `Connexion impossible (erreur ${res.status}).`);
    this.use((await res.json()) as TokenResponse);
  }

  signOut() {
    this.session = null;
    this.onSession(null);
  }

  /** A key for this device to join the account's network. */
  join() {
    return this.call<JoinTicket>('/network/join', { method: 'POST' });
  }

  devices() {
    return this.call<CloudDevice[]>('/network/devices');
  }

  removeDevice(id: string) {
    return this.call<void>(`/network/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** This device receives the account's notifications (an APNs token). */
  registerPush(token: string, platform: 'ios' | 'macos', name: string) {
    return this.call<void>('/push/register', post({ token, platform, name }));
  }

  unregisterPush(token: string) {
    return this.call<void>('/push/unregister', post({ token }));
  }

  /** A computer of the account says a game session ended: the recap goes to the account's devices. */
  sessionEnded(game: string, seconds: number, streakDays: number) {
    return this.call<void>('/events/session-ended', post({ game, seconds, streakDays }));
  }

  /** Every device off the network, then the account. Asks the password again. */
  notifications() {
    return this.call<CloudNotification[]>('/notifications');
  }

  markNotificationsRead() {
    return this.call<void>('/notifications/read', { method: 'POST' });
  }

  /** The password, or for an account made with Apple, a fresh Apple identity token. */
  async deleteAccount(confirm: { password?: string; appleIdentityToken?: string }) {
    await this.call<void>('/account/delete', post(confirm));
    this.signOut();
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    try {
      return await json<T>(`${this.baseUrl}${path}`, withAuth(init, token), 15_000);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e;
      // Signed out on the server's side (keys changed, account deleted elsewhere): one refresh, then give up.
      const fresh = await this.refresh();
      return json<T>(`${this.baseUrl}${path}`, withAuth(init, fresh.accessToken), 15_000);
    }
  }

  private async accessToken() {
    if (!this.session) throw new HttpError(401, 'Connecte-toi à ton compte Waken.');
    if (Date.now() < this.session.expiresAt - EARLY_MS) return this.session.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** One refresh at a time: two calls racing would spend the same refresh token twice. */
  private refresh() {
    if (this.refreshing) return this.refreshing;
    // Cleared after it settles, never before it is stored (a promise that rejects at once would stay forever).
    const pending = this.doRefresh().finally(() => {
      if (this.refreshing === pending) this.refreshing = undefined;
    });
    this.refreshing = pending;
    return pending;
  }

  private async doRefresh() {
    const session = this.session;
    if (!session) throw new HttpError(401, 'Connecte-toi à ton compte Waken.');
    const res = await fetchWithTimeout(`${this.baseUrl}/account/refresh`, post({ refreshToken: session.refreshToken }), 10_000);
    if (res.status === 401) {
      if (this.session === session) this.signOut();
      throw new HttpError(401, 'Ta session a expiré, reconnecte-toi.');
    }
    if (!res.ok) throw new HttpError(res.status, `Session non renouvelée (erreur ${res.status}).`);
    const tokens = (await res.json()) as TokenResponse;
    // Signed out (or in again) while this ran: the old session must not come back.
    if (this.session !== session) throw new HttpError(401, 'Session changée pendant le renouvellement.');
    return this.use(tokens);
  }

  private use(tokens: TokenResponse): CloudSession {
    this.session = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
    this.onSession(this.session);
    return this.session;
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const withAuth = (init: RequestInit, token: string): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
});

/** The first known message of an Identity validation problem ({ errors: { Code: [...] } }). */
export function identityError(body: string): string | undefined {
  try {
    const problem = JSON.parse(body) as { errors?: Record<string, string[]> };
    const codes = Object.keys(problem.errors ?? {});
    const known = codes.find((c) => identityMessages[c]);
    if (known) return identityMessages[known];
    if (codes.some((c) => c.startsWith('Password'))) return identityMessages.PasswordTooShort;
  } catch {
    // Not JSON: the caller says it with the status code.
  }
  return undefined;
}
