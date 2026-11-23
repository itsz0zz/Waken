import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * A linear gradient drawn with react-native-svg, which runs on every platform Waken targets
 * (expo-linear-gradient does not exist on Mac and Windows). `angle` follows CSS: 180 is top to bottom.
 */
export function Gradient({
  colors,
  locations,
  angle = 180,
  style,
}: {
  colors: readonly string[];
  locations?: readonly number[];
  angle?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [x1, y1, x2, y2] = endpoints(angle);
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
            {colors.map((color, i) => (
              <Stop key={i} offset={locations?.[i] ?? i / Math.max(1, colors.length - 1)} stopColor={rgb(color)} stopOpacity={alpha(color)} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** CSS angle to SVG gradient endpoints, in the box's own 0..1 space (y grows downwards). */
export function endpoints(angle: number): [number, number, number, number] {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [r(0.5 - dx), r(0.5 - dy), r(0.5 + dx), r(0.5 + dy)];
}

/** SVG stops take the opacity apart: "rgba(7,8,12,0.9)" becomes rgb(7,8,12) at 0.9. */
function rgb(color: string) {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/.exec(color);
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : color;
}

function alpha(color: string) {
  const m = /^rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)$/.exec(color);
  return m ? Number(m[1]) : 1;
}

export const fill = StyleSheet.absoluteFill;
