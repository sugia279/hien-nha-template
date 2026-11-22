import { uiText, t, initializeLanguage } from './i18n';
import { contrast } from './contrast';
import {
  updatePresentation,
  type PresentationConfig,
  type SiteConfig,
  type HostingConfig,
} from '@hien-nha/core-config';
import { applyPreset } from './presets';
import { createContentEditor, type ContentState } from './content-client';
type State = ContentState & {
  site: SiteConfig;
  hosting: HostingConfig;
  revision: string;
  coreVersion: string;
};
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const form = element<HTMLFormElement>('design');
const field = (name: string) =>
  form.elements.namedItem(name) as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const nonce = (
  document.querySelector('meta[name="hien-nha-session"]') as HTMLMetaElement
).content;
let saved: State,
  draft: PresentationConfig,
  redo: PresentationConfig[] = [],
  busy = false;
const undo: PresentationConfig[] = [];
let contentEditor: ReturnType<typeof createContentEditor> | undefined;
const clone = <T>(v: T): T => structuredClone(v);
const designDirty = () =>
  saved && JSON.stringify(draft) !== JSON.stringify(saved.site.presentation);
const dirty = () => designDirty() || !!contentEditor?.dirty();
async function api(path: string, body?: unknown) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Hien-Nha-Session': nonce,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'Yêu cầu không thành công.');
  return value;
}
function message(text: string) {
  uiText(element('message'), text);
}
function refresh() {
  const result = saved && updatePresentation(saved.site, draft);
  if (result?.success) {
    const p = result.data.presentation.theme.palette;
    const minimum = Math.min(
      contrast(p.foreground, p.background),
      contrast(p.foreground, p.surface),
      contrast(p.accent, p.background),
      contrast(p.accent, p.surface),
    );
    uiText(
      element('contrast-note'),
      minimum < 4.5
        ? 'Màu đang chọn có cặp chữ/nền dưới 4.5:1. Cân nhắc tăng tương phản hoặc chọn lại một mẫu.'
        : 'Các cặp chữ/nền được kiểm tra đạt ít nhất 4.5:1. Đây không phải audit accessibility đầy đủ.',
    );
  } else uiText(element('contrast-note'), '');
  element<HTMLButtonElement>('save').disabled =
    busy || !designDirty() || !result?.success;
  element<HTMLButtonElement>('preview').disabled = busy || !result?.success;
  element<HTMLButtonElement>('undo').disabled = busy || undo.length === 0;
  element<HTMLButtonElement>('redo').disabled = busy || redo.length === 0;
  uiText(
    element('save-state'),
    busy
      ? 'Đang xử lý…'
      : dirty()
        ? 'Có thay đổi chưa lưu'
        : 'Đã lưu trong workspace',
  );
  if (result && !result.success)
    message('Kiểm tra các ô bắt buộc, mô tả ảnh và nhãn menu.');
}
function remember() {
  undo.push(clone(draft));
  if (undo.length > 20) undo.shift();
  redo = [];
}
function render() {
  const p = draft;
  const values: Record<string, string> = {
    name: p.name,
    tagline: p.tagline,
    profileName: p.profile.name,
    bio: p.profile.bio,
    initials: p.profile.initials,
    locale: p.locale,
    font: p.theme.font,
    layout: p.theme.layout,
    banner: p.banner.layout,
    ...p.theme.palette,
    homeLabel: p.menu.items.find((i) => i.module === 'home')?.label || '',
    profileLabel:
      p.menu.items.find((i) => i.module === 'profile')?.label ||
      (p.locale === 'vi' ? 'Về tôi' : 'About me'),
    avatarAlt: p.profile.avatar?.alt || '',
    bannerAlt: p.banner.image?.alt || '',
  };
  for (const [name, value] of Object.entries(values)) field(name).value = value;
  for (const module of ['profile', 'posts'] as const)
    (field(module + 'Enabled') as HTMLInputElement).checked =
      p.modules.includes(module);
  field('profileLabel').disabled = !p.modules.includes('profile');
  element('menu-summary').textContent = p.menu.items
    .map((i) => i.label)
    .join(' → ');
  uiText(
    element('avatar-state'),
    p.profile.avatar ? 'Đã chọn: ' + p.profile.avatar.path : 'Chưa chọn ảnh',
  );
  uiText(
    element('banner-state'),
    p.banner.image ? 'Đã chọn: ' + p.banner.image.path : 'Chưa chọn ảnh',
  );
  document
    .querySelectorAll<HTMLButtonElement>('[data-preset]')
    .forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String(
          (b.dataset.preset === 'journal' &&
            p.theme.palette.background === '#faf7f0') ||
            (b.dataset.preset === 'garden' &&
              p.theme.palette.background === '#f1f5ef') ||
            (b.dataset.preset === 'night' &&
              p.theme.palette.background === '#15292d'),
        ),
      ),
    );
  refresh();
}
function capture() {
  if (!saved || busy) return;
  remember();
  message('');
  const value = (n: string) => field(n).value;
  const p = draft;
  p.name = value('name');
  p.tagline = value('tagline');
  p.locale = value('locale') as 'vi' | 'en';
  p.profile.name = value('profileName');
  p.profile.bio = value('bio');
  p.profile.initials = value('initials');
  p.theme.font = value('font') as 'serif' | 'sans';
  p.theme.layout = value('layout') as 'journal' | 'cards';
  p.banner.layout = value('banner') as 'plain' | 'centered' | 'split';
  for (const key of ['background', 'foreground', 'accent', 'surface'] as const)
    p.theme.palette[key] = value(key);
  if (p.profile.avatar) p.profile.avatar.alt = value('avatarAlt');
  if (p.banner.image) p.banner.image.alt = value('bannerAlt');
  p.modules = [
    'home',
    ...((field('profileEnabled') as HTMLInputElement).checked
      ? ['profile' as const]
      : []),
    ...((field('postsEnabled') as HTMLInputElement).checked
      ? ['posts' as const]
      : []),
  ];
  p.menu.items = p.menu.items.filter((i) => p.modules.includes(i.module));
  if (
    p.modules.includes('profile') &&
    !p.menu.items.some((i) => i.module === 'profile')
  )
    p.menu.items.push({ module: 'profile', label: value('profileLabel') });
  for (const item of p.menu.items)
    item.label = value(item.module === 'home' ? 'homeLabel' : 'profileLabel');
  field('profileLabel').disabled = !p.modules.includes('profile');
  element('menu-summary').textContent = p.menu.items
    .map((i) => i.label)
    .join(' → ');
  refresh();
}
form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', capture);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-preset]',
))
  button.addEventListener('click', () => {
    if (!saved || busy) return;
    remember();
    draft = applyPreset(draft, button.dataset.preset!);
    message('');
    render();
  });
element('undo').addEventListener('click', () => {
  if (!undo.length) return;
  redo.push(clone(draft));
  draft = undo.pop()!;
  message('');
  render();
});
element('redo').addEventListener('click', () => {
  if (!redo.length) return;
  undo.push(clone(draft));
  draft = redo.pop()!;
  message('');
  render();
});
element('menu-order').addEventListener('click', () => {
  if (!saved || busy) return;
  remember();
  draft.menu.items.reverse();
  render();
});
async function work(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  message('');
  refresh();
  document
    .querySelectorAll<HTMLFormElement>('form')
    .forEach((f) => (f.inert = true));
  for (const id of ['content-editor', 'git-editor']) element(id).inert = true;
  try {
    await action();
  } catch (error) {
    message((error as Error).message + ' Bản chỉnh sửa vẫn được giữ ở đây.');
  } finally {
    busy = false;
    document
      .querySelectorAll<HTMLFormElement>('form')
      .forEach((f) => (f.inert = false));
    for (const id of ['content-editor', 'git-editor'])
      element(id).inert = false;
    refresh();
  }
}
element('save').addEventListener('click', () =>
  work(async () => {
    saved = await api('presentation', {
      revision: saved.revision,
      presentation: draft,
    });
    draft = clone(saved.site.presentation);
    contentEditor?.savedChanged();
    message('Đã lưu giao diện. Chưa commit/push hay xuất bản.');
    render();
  }),
);
element('reload').addEventListener('click', () => {
  if (
    busy ||
    (dirty() &&
      !window.confirm(
        t(
          'Bỏ giao diện/nội dung chưa lưu và mở lại file đã lưu? Bạn có thể hủy để giữ bản chỉnh sửa.',
        ),
      ))
  )
    return;
  void work(async () => {
    saved = await api('state');
    draft = clone(saved.site.presentation);
    undo.length = 0;
    redo = [];
    contentEditor?.reset();
    message('Đã mở lại file đã lưu.');
    render();
  });
});
element('preview').addEventListener('click', () =>
  work(async () => {
    uiText(element('preview-state'), 'Đang build bản xem trước…');
    try {
      const value = await api('preview', {
        revision: saved.revision,
        presentation: draft,
      });
      const frame = element<HTMLIFrameElement>('site-preview');
      frame.src = value.url;
      frame.hidden = false;
      element('preview-empty').hidden = true;
      uiText(
        element('preview-state'),
        'Bản xem trước vừa tạo · file đã lưu không thay đổi.',
      );
    } catch (error) {
      uiText(
        element('preview-state'),
        'Build chưa thành công. Bản xem trước cũ được giữ lại.',
      );
      throw error;
    }
  }),
);
element<HTMLSelectElement>('viewport').addEventListener('change', (event) => {
  element('site-preview').style.width = (
    event.target as HTMLSelectElement
  ).value;
});
for (const kind of ['avatar', 'banner'] as const) {
  element('remove-' + kind).addEventListener('click', () => {
    if (!saved || busy) return;
    remember();
    if (kind === 'avatar') draft.profile.avatar = null;
    else draft.banner.image = null;
    render();
  });
  element<HTMLInputElement>(kind + '-file').addEventListener(
    'change',
    (event) =>
      work(async () => {
        const input = event.target as HTMLInputElement,
          file = input.files?.[0];
        if (!file) return;
        if (file.size > 5_242_880) throw Error('Chọn ảnh tối đa 5 MiB.');
        const extension = '.' + file.name.split('.').pop()?.toLowerCase();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const value = await api('upload', { extension, base64: btoa(binary) });
        remember();
        const image = {
          path: value.path,
          alt: kind === 'avatar' ? draft.profile.name : draft.name,
        };
        if (kind === 'avatar') draft.profile.avatar = image;
        else draft.banner.image = image;
        input.value = '';
        message('Ảnh đã lưu trong source; lưu giao diện để sử dụng.');
        render();
      }),
  );
}
const hostingForm = element<HTMLFormElement>('hosting');
function hostingCandidate(): HostingConfig {
  const owner = (hostingForm.elements.namedItem('owner') as HTMLInputElement)
      .value,
    repo = (hostingForm.elements.namedItem('repo') as HTMLInputElement).value;
  if (
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(owner) ||
    (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(repo) &&
      repo !== owner.toLowerCase() + '.github.io')
  )
    throw Error(
      'Dùng tài khoản GitHub và tên repo viết thường, chữ/số/gạch nối.',
    );
  return {
    schemaVersion: 1,
    origin: 'https://' + owner.toLowerCase() + '.github.io',
    base: repo === owner.toLowerCase() + '.github.io' ? '/' : '/' + repo + '/',
  };
}
hostingForm.addEventListener('input', () => {
  try {
    const h = hostingCandidate();
    uiText(element('hosting-url'), h.origin + h.base);
  } catch {
    uiText(element('hosting-url'), 'Nhập tài khoản và repository của bạn.');
  }
});
hostingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (dirty()) {
    message('Lưu hoặc hoàn tác giao diện trước khi đổi địa chỉ.');
    return;
  }
  void work(async () => {
    saved = await api('hosting', {
      revision: saved.revision,
      hosting: hostingCandidate(),
    });
    message(
      'Đã lưu địa chỉ riêng. Publication vẫn giữ nguyên; chưa thay đổi GitHub Pages.',
    );
    render();
  });
});
window.addEventListener('beforeunload', (event) => {
  if (dirty()) {
    event.preventDefault();
  }
});
initializeLanguage();
window.addEventListener('hien-nha-language', () => {
  if (saved) render();
});
void (async () => {
  try {
    saved = await api('state');
    draft = clone(saved.site.presentation);
    contentEditor = createContentEditor({
      state: () => saved,
      accept: (state) => {
        saved = state as State;
        render();
      },
      api,
      work,
      designDirty,
      message,
      refresh,
      preview: (url, text) => {
        const frame = element<HTMLIFrameElement>('site-preview');
        frame.src = url;
        frame.hidden = false;
        element('preview-empty').hidden = true;
        uiText(element('preview-state'), text);
      },
    });
    contentEditor.reset();
    uiText(
      element('core-version'),
      'Core ' + saved.coreVersion + ' · Static Only',
    );
    uiText(element('hosting-url'), saved.hosting.origin + saved.hosting.base);
    render();
  } catch (error) {
    message((error as Error).message);
  }
})();
