import type { Device, WakeProgress, WakeStepId, WakeStepState } from './types';
import { sendWakeSignal, type ConfirmPowerCut } from './wake';
import { probeAgent, probeSunshine } from './reachability';
import { sleep, throwIfAborted } from './http';

export interface WakeOptions {
  /** Give up after this long (default 3 min: a cold boot + Windows + Sunshine). */
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  /** Without it, a smart plug never cuts power. */
  confirmPowerCut?: ConfirmPowerCut;
  onProgress?: (p: WakeProgress) => void;
}

const initialStates = (): Record<WakeStepId, WakeStepState> => ({ signal: 'pending', ping: 'pending', service: 'pending', stream: 'pending' });

/**
 * Wake → wait for the machine → wait for Sunshine.
 * The 'stream' step is left 'running' for the caller, which starts the stream (V1: Moonlight; V2: StreamView).
 */
export async function wakeAndWait(device: Device, opts: WakeOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 2000;
  const start = Date.now();
  const states = initialStates();
  const emit = (step: WakeStepId, message?: string) => opts.onProgress?.({ step, states: { ...states }, elapsedMs: Date.now() - start, message });

  if (!device.stream) throw new Error(`${device.name} n'a pas de cible de stream configurée.`);
  const { host, sunshinePort } = device.stream;

  // Already up? Skip straight to the stream.
  const [sunshine, agent] = await Promise.all([probeSunshine(host, sunshinePort), probeAgent(device)]);
  throwIfAborted(opts.signal);
  if (sunshine) {
    states.signal = states.ping = states.service = 'done';
    states.stream = 'running';
    emit('stream', 'Déjà allumé');
    return;
  }

  if (agent) {
    // Windows runs: a signal is useless here, and with a smart plug it would be a hard power cut.
    states.signal = states.ping = 'done';
    states.service = 'running';
    emit('service');
  } else {
    states.signal = 'running';
    emit('signal');
    try {
      await sendWakeSignal(device, opts.signal, opts.confirmPowerCut);
    } catch (error) {
      states.signal = 'error';
      emit('signal', error instanceof Error ? error.message : undefined);
      throw error;
    }
    states.signal = 'done';
    states.ping = 'running';
    emit('ping');
  }

  while (Date.now() - start < timeoutMs) {
    throwIfAborted(opts.signal);
    await sleep(pollMs, opts.signal);

    if (states.ping === 'running' && (await probeAgent(device))) {
      states.ping = 'done';
      states.service = 'running';
      emit('service');
    }
    if (await probeSunshine(host, sunshinePort)) {
      states.ping = 'done';
      states.service = 'done';
      states.stream = 'running';
      emit('stream');
      return;
    }
    emit(states.service === 'running' ? 'service' : 'ping');
  }

  const failed: WakeStepId = states.service === 'running' ? 'service' : 'ping';
  states[failed] = 'error';
  emit(failed, failed === 'ping' ? 'Le PC ne répond pas. Vérifie le Wake-on-LAN / la prise et Tailscale (Run unattended).' : 'Le PC est allumé mais Sunshine ne répond pas.');
  throw new Error('Délai dépassé');
}
