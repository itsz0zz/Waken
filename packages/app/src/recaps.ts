import { useEffect } from 'react';
import { AgentClient, type Device } from '@waken/core';
import { cloud, useAccount } from './account';

const CHECK_MS = 30_000;

/**
 * On a computer that streams (the desktop apps): when a game session ends there, the account's other
 * devices get its recap. The agent knows when a session ends; this sends it once to the account.
 */
export function useSessionRecaps(device?: Device) {
  const signedIn = useAccount((s) => s.session !== null && s.mode === 'account');
  const token = device?.stream?.agentToken;
  useEffect(() => {
    if (!device || !token || !signedIn) return;
    // undefined: not looked yet. The first look only learns the last session: an old one is not news.
    let last: string | null | undefined;
    const check = async () => {
      try {
        const stats = await new AgentClient(device).stats();
        const ended = stats.lastSession ?? null;
        if (last === undefined) {
          last = ended?.endedAt ?? null;
          return;
        }
        if (!ended || ended.endedAt === last) return;
        last = ended.endedAt;
        await cloud().sessionEnded(ended.title, ended.seconds, stats.streakDays);
      } catch {
        // The agent restarting or the server away: this recap is skipped, the next ones still go.
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    return () => clearInterval(timer);
  }, [device?.id, token, signedIn]);
}
