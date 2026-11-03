const PATCH_NOTES_URL = 'https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/';
const ORIGIN = new URL(PATCH_NOTES_URL).origin;

function parsePatchNotes(html) {
  // 공식 페이지에 포함된 JSON만 읽고 스크립트는 실행하지 않습니다.
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find((match) =>
    /\bid\s*=\s*["']__NEXT_DATA__["']/i.test(match[1]),
  );
  if (!script) throw new Error('PATCH_NOTES_FORMAT');
  const blades = JSON.parse(script[2]).props?.pageProps?.page?.blades;
  if (!Array.isArray(blades)) throw new Error('PATCH_NOTES_FORMAT');
  const posts = new Map();
  for (const blade of blades) {
    for (const item of Array.isArray(blade.items) ? blade.items : []) {
      if (
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        !item.tags?.some((tag) => tag.machineName === 'patch_notes')
      )
        continue;
      const publishedAt = Date.parse(item.publishedAt);
      if (!Number.isFinite(publishedAt) || typeof item.action?.payload?.url !== 'string') continue;
      let url;
      try {
        url = new URL(item.action.payload.url, ORIGIN);
      } catch {
        continue;
      }
      if (url.origin !== ORIGIN || !url.pathname.startsWith('/ko-kr/news/game-updates/')) continue;
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      const post = {
        title: item.title.trim(),
        url: url.href,
        publishedAt: new Date(publishedAt).toISOString(),
      };
      if (!posts.has(post.url) || post.publishedAt > posts.get(post.url).publishedAt)
        posts.set(post.url, post);
    }
  }
  const patches = [...posts.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 3);
  if (!patches.length) throw new Error('PATCH_NOTES_EMPTY');
  return patches;
}

function createPatchNotesService({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null,
    expires = 0,
    inFlight = null,
    lastError = null;
  return async function getPatchNotes() {
    if (cached && now() < expires) return cached;
    if (lastError && now() < expires) throw lastError;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(PATCH_NOTES_URL, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('PATCH_NOTES_UNAVAILABLE');
        const patches = parsePatchNotes(await response.text());
        cached = { patches, sourceUrl: PATCH_NOTES_URL, updatedAt: now(), stale: false };
        lastError = null;
        expires = now() + 3600000;
        return cached;
      } catch (error) {
        lastError = error;
        expires = now() + 60000;
        // 일시적인 장애나 구조 변경 시 마지막으로 확인한 실제 목록을 유지합니다.
        if (!cached) throw error;
        cached = { ...cached, stale: true };
        return cached;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

module.exports = { PATCH_NOTES_URL, parsePatchNotes, createPatchNotesService };
