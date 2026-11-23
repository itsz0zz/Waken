import Svg, { G, Path, Rect } from 'react-native-svg';
import { colors } from './tokens';

/** The WAKEN wordmark, drawn from the Arcade mockups' vector (no font needed). */
export function Wordmark({ height = 26, color = colors.ink }: { height?: number; color?: string }) {
  return (
    <Svg width={(height * 274) / 86} height={height} viewBox="0 0 274 86" accessibilityLabel="Waken">
      <Path
        transform="translate(0 85.9)"
        fill={color}
        d="M10.546875 0.0 1.318359375 -85.9375H18.115234375L22.8515625 -31.689453125L27.685546875 -85.9375H43.701171875L48.291015625 -31.689453125L52.880859375 -85.9375H69.873046875L60.498046875 0.0H39.892578125L35.595703125 -41.357421875L31.494140625 0.0Z M76.65625 0.0 84.95703125 -85.9375H114.107421875L122.26171875 0.0H106.001953125L104.78125 -13.8671875H94.4296875L93.35546875 0.0ZM95.650390625 -27.587890625H103.462890625L99.703125 -71.2890625H98.921875Z M131.53515625 0.0V-85.9375H148.52734375V-51.513671875L156.53515625 -85.9375H173.8203125L164.201171875 -46.58203125L175.822265625 0.0H158.0L148.625 -41.6015625V0.0Z M182.751953125 0.0V-85.9375H217.126953125V-69.3359375H200.232421875V-52.587890625H216.443359375V-36.42578125H200.232421875V-16.748046875H218.25V0.0Z M227.9140625 0.0V-85.9375H245.58984375L253.5 -44.775390625V-85.9375H270.1015625V0.0H253.3046875L244.7109375 -42.96875V0.0Z"
      />
    </Svg>
  );
}

const W =
  'M8.2265625 0.0 1.0283203125 -67.03125H14.1298828125L17.82421875 -24.7177734375L21.5947265625 -67.03125H34.0869140625L37.6669921875 -24.7177734375L41.2470703125 -67.03125H54.5009765625L47.1884765625 0.0H31.1162109375L27.7646484375 -32.2587890625L24.5654296875 0.0Z';

/** The app icon: a blue W, white outline and lime shadow, on a black tile. Also the "sticker" of the mockups. */
export function AppMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128" accessibilityLabel="Waken">
      <Rect width="128" height="128" rx="34" fill={colors.white} />
      <Rect x="6" y="6" width="116" height="116" rx="29" fill={colors.ink} />
      <G transform="rotate(-6 64 64)">
        <Path d={W} transform="translate(41.2 103.5)" fill={colors.lime} stroke={colors.lime} strokeWidth={10} strokeLinejoin="round" />
        <Path d={W} transform="translate(36.2 97.5)" fill={colors.white} stroke={colors.white} strokeWidth={10} strokeLinejoin="round" />
        <Path d={W} transform="translate(36.2 97.5)" fill={colors.blue} />
      </G>
    </Svg>
  );
}
