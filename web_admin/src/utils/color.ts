/**
 * 颜色工具：把主色派生成 Element Plus 需要的色阶。
 *
 * 为什么在 JS 里算，而不是用 CSS color-mix() 或 Sass：
 * - EP 的规则是「light-3/5/7/8/9 分别混入 30/50/70/80/90% 白色，dark-2 混入 20% 黑色」，
 *   在 JS 里复刻一遍最直观，也不用引入 Sass。
 * - color-mix() 要 Chrome 111+ / Safari 16.2+；校内可能还有老浏览器，
 *   一旦不支持，按钮会退化成透明/黑色块 —— 比不换肤更糟。
 */

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

/** 归一成 #rrggbb；非法值返回 null（调用方决定兜底） */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  const full = HEX6.exec(value);
  if (full) return ('#' + (full[1] as string)).toLowerCase();
  const short = HEX3.exec(value);
  if (short) {
    const raw = short[1] as string;
    const r = raw.charAt(0);
    const g = raw.charAt(1);
    const b = raw.charAt(2);
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }
  return null;
}

function toRgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex) ?? '#000000';
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return '#' + part(r) + part(g) + part(b);
}

/**
 * 把 base 向 toward 混合。
 * @param weight toward 的占比（0 = 全 base，1 = 全 toward）
 */
export function mixHex(base: string, toward: string, weight: number): string {
  const [r1, g1, b1] = toRgb(base);
  const [r2, g2, b2] = toRgb(toward);
  const w = Math.max(0, Math.min(1, weight));
  return toHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w);
}

/** 转成 rgba()，用于半透明悬停底色（比再算一个实色更稳） */
export function hexToRgba(hex: string, alphaValue: number): string {
  const [r, g, b] = toRgb(hex);
  const a = Math.max(0, Math.min(1, alphaValue));
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
}
