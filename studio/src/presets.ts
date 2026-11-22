import type { PresentationConfig } from '@hien-nha/core-config';
export const presets = [
  {
    id: 'journal',
    name: 'Hiên giấy',
    description: 'Ấm áp · chữ serif · nhật ký',
    colors: ['#faf7f0', '#29251f', '#765433', '#ffffff'],
    font: 'serif',
    layout: 'journal',
    banner: 'plain',
  },
  {
    id: 'garden',
    name: 'Vườn xanh',
    description: 'Tươi sáng · thẻ bài · cân giữa',
    colors: ['#f1f5ef', '#193b2d', '#326343', '#ffffff'],
    font: 'sans',
    layout: 'cards',
    banner: 'centered',
  },
  {
    id: 'night',
    name: 'Đêm yên',
    description: 'Trầm tối · chữ serif · chia đôi',
    colors: ['#15292d', '#e6ede7', '#edbc76', '#20383c'],
    font: 'serif',
    layout: 'journal',
    banner: 'split',
  },
] as const;
export function applyPreset(
  input: PresentationConfig,
  id: string,
): PresentationConfig {
  const preset = presets.find((p) => p.id === id);
  if (!preset) throw Error('Unknown preset');
  const [background, foreground, accent, surface] = preset.colors;
  return {
    ...structuredClone(input),
    theme: {
      schemaVersion: 1,
      palette: { background, foreground, accent, surface },
      font: preset.font,
      layout: preset.layout,
    },
    banner: { ...input.banner, layout: preset.banner },
  };
}
