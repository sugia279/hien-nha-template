import { uiText, t } from './i18n';
import {
  parseContentDocument,
  serializeContentDocument,
  type ContentDocument,
  type Post,
} from '@hien-nha/core-domain';
type DraftPost = Omit<Post, 'visibility'> & {
  visibility: Post['visibility'] | '';
};
type Draft = Omit<ContentDocument, 'posts'> & { posts: DraftPost[] };
export type ContentState = {
  content: ContentDocument;
  publication: { schemaVersion: 1; enabled: boolean };
  revision: string;
};
type GitState = {
  head: string;
  upstream: string;
  ahead: number;
  repository: string;
  publicationEnabled: boolean;
  actionsUrl: string;
  changes: { status: string; path: string }[];
};
export function createContentEditor(bridge: {
  state: () => ContentState;
  accept: (state: ContentState) => void;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  work: (action: () => Promise<void>) => Promise<void>;
  designDirty: () => boolean;
  message: (text: string) => void;
  refresh: () => void;
  preview: (url: string, message: string) => void;
}) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const input = (id: string) => el<HTMLInputElement>(id);
  let draft: Draft,
    selected = '',
    git: GitState | undefined;
  const dirty = () =>
    !!draft && JSON.stringify(draft) !== JSON.stringify(bridge.state().content);
  const active = () => draft.posts.find((p) => p.id === selected);
  function candidate() {
    return parseContentDocument(draft);
  }
  function renderList() {
    const list = el<HTMLSelectElement>('post-list');
    list.replaceChildren();
    if (!draft.posts.length) {
      const o = document.createElement('option');
      uiText(o, 'Chưa có bài viết');
      list.append(o);
    }
    for (const p of draft.posts) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent =
        (p.title || t('Bài chưa đặt tên')) +
        (p.published ? ' · ' + (p.visibility || '?') : t(' · Nháp'));
      list.append(o);
    }
    list.value = selected;
    uiText(
      el('content-state'),
      dirty() ? 'Có bài chỉnh sửa chưa lưu' : 'Nội dung đã lưu trong workspace',
    );
    el<HTMLButtonElement>('save-content').disabled = !dirty();
    el<HTMLButtonElement>('delete-post').disabled = !active();
    bridge.refresh();
  }
  function renderMedia() {
    const list = el('post-media');
    list.replaceChildren();
    const p = active();
    if (!p) return;
    p.media.forEach((m, index) => {
      const row = document.createElement('div'),
        img = document.createElement('img'),
        label = document.createElement('label'),
        alt = document.createElement('input'),
        remove = document.createElement('button');
      img.src = '/assets/' + m.path;
      img.alt = m.alt;
      uiText(label, 'Mô tả ảnh bài ' + (index + 1));
      alt.value = m.alt;
      alt.maxLength = 600;
      alt.required = true;
      label.append(alt);
      alt.addEventListener('input', () => {
        m.alt = alt.value;
        img.alt = alt.value;
        renderList();
      });
      remove.type = 'button';
      uiText(remove, 'Bỏ ảnh ' + (index + 1));
      remove.addEventListener('click', () => {
        p.media.splice(index, 1);
        renderMedia();
        renderList();
      });
      row.append(img, label, remove);
      list.append(row);
    });
  }
  function render() {
    renderList();
    const p = active();
    el<HTMLFormElement>('post-form').hidden = !p;
    if (p) {
      input('post-title').value = p.title;
      el<HTMLTextAreaElement>('post-body').value = p.body;
      el<HTMLSelectElement>('post-visibility').value = p.visibility;
      input('post-published').checked = p.published;
    }
    renderMedia();
  }
  function reset() {
    draft = structuredClone(bridge.state().content);
    selected = draft.posts[0]?.id || '';
    git = undefined;
    input('content-disclosure').checked = false;
    input('publication-enabled').checked = bridge.state().publication.enabled;
    render();
  }
  const ensureSaved = () => {
    if (dirty() || bridge.designDirty())
      throw Error('Lưu hoặc bỏ các thay đổi trước khi dùng Git/xuất bản.');
  };
  function showGit(s: GitState) {
    git = s;
    uiText(
      el('git-state'),
      s.repository +
        ' · main · ' +
        s.ahead +
        ' commit chưa push · ' +
        s.changes.length +
        ' file đã thay đổi',
    );
    el('git-files').replaceChildren();
    for (const c of s.changes) {
      const li = document.createElement('li');
      uiText(li, c.status + ' ' + c.path);
      el('git-files').append(li);
    }
    const link = el<HTMLAnchorElement>('actions-link');
    link.href = s.actionsUrl;
    link.hidden = false;
  }
  el<HTMLSelectElement>('post-list').addEventListener('change', (e) => {
    selected = (e.target as HTMLSelectElement).value;
    render();
  });
  el('new-post').addEventListener('click', () => {
    const p: DraftPost = {
      id: 'post-' + crypto.randomUUID(),
      title: '',
      body: '',
      visibility: '',
      published: false,
      media: [],
    };
    draft.posts.push(p);
    selected = p.id;
    render();
    input('post-title').focus();
  });
  el('delete-post').addEventListener('click', () => {
    if (
      !active() ||
      !confirm(
        t(
          'Xóa bài khỏi bản chỉnh sửa? File đã lưu chỉ đổi khi bạn bấm Lưu. Lịch sử Git/ảnh source không bị xóa.',
        ),
      )
    )
      return;
    draft.posts = draft.posts.filter((p) => p.id !== selected);
    selected = draft.posts[0]?.id || '';
    render();
  });
  const form = el<HTMLFormElement>('post-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => {
    const p = active();
    if (!p) return;
    p.title = input('post-title').value;
    p.body = el<HTMLTextAreaElement>('post-body').value;
    p.visibility = el<HTMLSelectElement>('post-visibility')
      .value as DraftPost['visibility'];
    p.published = input('post-published').checked;
    renderList();
  });
  el('save-content').addEventListener('click', () =>
    bridge.work(async () => {
      if (bridge.designDirty())
        throw Error('Lưu giao diện trước khi lưu bài viết.');
      const value = await bridge.api<ContentState>('content', {
        revision: bridge.state().revision,
        content: candidate(),
        acknowledgeGitDisclosure: input('content-disclosure').checked,
      });
      bridge.accept(value);
      draft = structuredClone(value.content);
      git = undefined;
      render();
      bridge.message(
        'Đã lưu nội dung vào workspace. Chưa commit/push hay deploy.',
      );
    }),
  );
  el('preview-post').addEventListener('click', () =>
    bridge.work(async () => {
      if (bridge.designDirty()) throw Error('Lưu giao diện trước khi xem bài.');
      const result = await bridge.api<{ url: string }>('preview-post', {
        revision: bridge.state().revision,
        content: candidate(),
        postId: selected,
      });
      bridge.preview(
        result.url,
        'Bản xem riêng của chủ nhà, kể cả ONLY_ME/nháp. Không thay đổi file hay website đã deploy.',
      );
    }),
  );
  input('post-image').addEventListener('change', (e) =>
    bridge.work(async () => {
      const p = active(),
        file = (e.target as HTMLInputElement).files?.[0];
      if (!p || !file) return;
      if (p.media.length >= 4 || file.size > 5_242_880)
        throw Error('Tối đa 4 ảnh/bài, mỗi ảnh tối đa 5 MiB.');
      let binary = '';
      for (const b of new Uint8Array(await file.arrayBuffer()))
        binary += String.fromCharCode(b);
      const uploaded = await bridge.api<{ path: string }>('upload', {
        extension: '.' + file.name.split('.').pop()?.toLowerCase(),
        base64: btoa(binary),
      });
      if (p.media.some((m) => m.path === uploaded.path))
        throw Error('Ảnh này đã có trong bài.');
      p.media.push({ path: uploaded.path, alt: '' });
      input('post-image').value = '';
      renderMedia();
      renderList();
      bridge.message(
        'Ảnh đã vào source. Thêm mô tả rồi lưu bài; chưa commit/push.',
      );
    }),
  );
  el('export-content').addEventListener('click', () =>
    bridge.work(async () => {
      if (
        !confirm(
          t(
            'Xuất JSON đã lưu có thể chứa ONLY_ME/nháp. File chỉ gồm tham chiếu ảnh, không phải backup đầy đủ. Tiếp tục?',
          ),
        )
      )
        return;
      const state = await bridge.api<ContentState>('state'),
        url = URL.createObjectURL(
          new Blob([serializeContentDocument(state.content)], {
            type: 'application/json',
          }),
        );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hien-nha-content.json';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      bridge.message(
        'Đã xuất JSON đã lưu; giữ file riêng và sao lưu ảnh source riêng.',
      );
    }),
  );
  el('import-content').addEventListener('click', () =>
    bridge.work(async () => {
      const file = input('import-file').files?.[0];
      if (!file || file.size > 2_000_000)
        throw Error('Chọn JSON tối đa 2 triệu byte.');
      const value = await bridge.api<{ content: ContentDocument }>('import', {
        revision: bridge.state().revision,
        format: el<HTMLSelectElement>('import-format').value,
        json: new TextDecoder('utf-8', { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      });
      if (
        !confirm(
          t(
            'Thay toàn bộ danh sách trong bản chỉnh sửa bằng nội dung vừa kiểm tra? File đã lưu chưa thay đổi.',
          ),
        )
      )
        return;
      draft = value.content;
      selected = draft.posts[0]?.id || '';
      input('content-disclosure').checked = false;
      render();
      bridge.message(
        'Đã kiểm tra và nạp bản chỉnh sửa. Xem lại visibility/cảnh báo rồi bấm Lưu.',
      );
    }),
  );
  el<HTMLFormElement>('publication-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void bridge.work(async () => {
      ensureSaved();
      const enabled = input('publication-enabled').checked;
      if (
        !confirm(
          t(
            enabled
              ? 'Cho phép workflow deploy sau push main trên đúng repo? GitHub Pages settings vẫn cần được thiết lập riêng.'
              : 'Tắt lần deploy tiếp theo? Thao tác này không gỡ website đang được host.',
          ),
        )
      )
        return;
      const value = await bridge.api<ContentState>('publication', {
        revision: bridge.state().revision,
        enabled,
        acknowledgePublication: true,
      });
      bridge.accept(value);
      git = undefined;
      bridge.message(
        'Đã lưu lựa chọn publication. Chưa commit/push; chưa xác nhận deploy.',
      );
    });
  });
  el<HTMLFormElement>('git-form').addEventListener('submit', (e) =>
    e.preventDefault(),
  );
  el('git-refresh').addEventListener('click', () =>
    bridge.work(async () => {
      showGit(await bridge.api<GitState>('git-status'));
      uiText(
        el('git-result'),
        'Trạng thái từ workspace; chưa truy vấn kết quả Actions/deploy.',
      );
    }),
  );
  el('git-commit').addEventListener('click', () =>
    bridge.work(async () => {
      ensureSaved();
      if (!git) throw Error('Kiểm tra trạng thái Git trước.');
      const value = await bridge.api<GitState>('git-commit', {
        revision: bridge.state().revision,
        head: git.head,
        message: input('commit-message').value,
        acknowledgeGitDisclosure: input('git-disclosure').checked,
      });
      showGit(value);
      uiText(
        el('git-result'),
        'Đã tạo commit ' +
          value.head.slice(0, 12) +
          ' trong workspace. Chưa push/deploy.',
      );
    }),
  );
  el('git-push').addEventListener('click', () =>
    bridge.work(async () => {
      ensureSaved();
      if (!git) throw Error('Kiểm tra trạng thái Git trước.');
      if (
        !confirm(
          t(
            'Push commit lên origin/main của ' +
              git.repository +
              '? Workflow có thể deploy nếu bạn đã bật publication.',
          ),
        )
      )
        return;
      const value = await bridge.api<GitState>('git-push', {
        revision: bridge.state().revision,
        head: git.head,
        upstream: git.upstream,
        acknowledgeGitDisclosure: input('git-disclosure').checked,
      });
      showGit(value);
      uiText(
        el('git-result'),
        'Đã push commit ' +
          value.head.slice(0, 12) +
          '. Kết quả Actions/deploy chưa được xác minh; mở liên kết để kiểm tra.',
      );
    }),
  );
  window.addEventListener('hien-nha-language', () => {
    if (draft) {
      render();
      if (git) showGit(git);
    }
  });
  return {
    reset,
    dirty,
    savedChanged: () => {
      git = undefined;
      renderList();
    },
  };
}
