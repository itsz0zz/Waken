import { describe, expect, it } from 'vitest';
import { fitToWindow, qualities } from '../../app/src/quality';

describe('fitToWindow', () => {
  const max = qualities.max.settings; // 2560x1440
  const balanced = qualities.balanced.settings; // 1920x1080

  it('keeps a 16:9 window at the chosen quality', () => {
    expect(fitToWindow(max, 1920, 1080)).toMatchObject({ width: 2560, height: 1440 });
  });

  it('gives a 16:10 Mac window a 16:10 standard size of about the same pixels', () => {
    expect(fitToWindow(max, 1512, 945)).toMatchObject({ width: 2560, height: 1600 });
    expect(fitToWindow(balanced, 1440, 900)).toMatchObject({ width: 1920, height: 1200 });
  });

  it('gives an ultrawide window a 21:9 size', () => {
    expect(fitToWindow(max, 3440, 1440)).toMatchObject({ width: 3440, height: 1440 });
  });

  it('keeps the frame rate, bitrate and codec', () => {
    const fitted = fitToWindow(max, 1512, 945);
    expect(fitted).toMatchObject({ fps: max.fps, bitrate: max.bitrate, codec: max.codec });
  });

  it('leaves the settings alone without a window', () => {
    expect(fitToWindow(max, 0, 0)).toEqual(max);
  });
});
