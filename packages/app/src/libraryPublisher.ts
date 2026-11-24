import { useEffect } from 'react';
import { AgentClient } from '@waken/core';
import { cloud, useAccount } from './account';
import { useNetwork } from './network';
import { useWaken } from './store';

/** How often this machine's library is compared with the one last sent: a new game, a session ended. */
const EVERY_MS = 60_000;

/**
 * The desktop app of a machine sends its games to the account's server, under its name on the Waken network:
 * every other device reads them there, even with this machine off. Only a change is sent.
 * Mounted once at the desktop app's root.
 */
export function useLibraryPublisher() {
  const signedIn = useAccount((s) => s.mode === 'account' && s.session !== null);
  const self = useNetwork((s) => s.status?.self?.name);
  const local = useWaken((s) => s.devices.find((d) => d.local && d.stream?.agentToken));
  const token = local?.stream?.agentToken;

  useEffect(() => {
    if (!signedIn || !self || !local) return;
    let last = '';
    let busy = false;
    const publish = async () => {
      // The first call after new games checks their pictures and can take a while: no second one meanwhile.
      if (busy) return;
      busy = true;
      try {
        const library = await new AgentClient(local).library();
        const body = JSON.stringify(library);
        if (body === last) return;
        await cloud().putLibrary(self, library);
        last = body;
        console.log(`[bibliothèque] ${library.games.length} jeu(x) envoyé(s) au serveur pour ${self}`);
      } catch (e) {
        console.log(`[bibliothèque] envoi impossible : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy = false;
      }
    };
    void publish();
    const timer = setInterval(() => void publish(), EVERY_MS);
    return () => clearInterval(timer);
  }, [signedIn, self, token]);
}
