const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PATCH_NOTES_URL,
  parsePatchNotes,
  createPatchNotesService,
} = require('../server/patch-notes');
const { createApp } = require('../server/app');

const post = (slug, publishedAt, title = `${slug} 패치 노트`) => ({
  title,
  publishedAt,
  action: { payload: { url: `/ko-kr/news/game-updates/${slug}/` } },
  tags: [{ machineName: 'patch_notes' }],
});
const html = (items) =>
  `<html><script nonce="test" type="application/json" id='__NEXT_DATA__'>${JSON.stringify({ props: { pageProps: { page: { blades: [{ type: 'articleCardGrid', items }] } } } })}</script></html>`;
const items = [
  post('older', '2026-09-22T18:00:00Z'),
  post('newest', '2026-10-20T18:00:00Z'),
  post('middle', '2026-10-06T18:00:00Z'),
  post('oldest', '2026-09-09T18:00:00Z'),
];

test('official page JSON yields the latest three unique titles, publish dates and direct links', () => {
  const patches = parsePatchNotes(html([...items, items[1]]));
  assert.deepEqual(
    patches.map((p) => p.title),
    ['newest 패치 노트', 'middle 패치 노트', 'older 패치 노트'],
  );
  assert.equal(patches[0].publishedAt, '2026-10-20T18:00:00.000Z');
  assert.equal(patches[0].url, 'https://www.leagueoflegends.com/ko-kr/news/game-updates/newest');
});

test('crawler ignores non-patch content, invalid dates and links outside official Korean articles', () => {
  const invalid = [
    {
      ...post('external', '2026-10-30'),
      action: { payload: { url: 'https://example.com/ko-kr/news/game-updates/external' } },
    },
    { ...post('script', '2026-10-30'), action: { payload: { url: 'javascript:alert(1)' } } },
    { ...post('news', '2026-10-30'), tags: [] },
    post('bad-date', 'not-a-date'),
  ];
  assert.deepEqual(parsePatchNotes(html([...invalid, ...items])), parsePatchNotes(html(items)));
  assert.throws(() => parsePatchNotes('<html>Layout changed</html>'));
  assert.throws(() => parsePatchNotes(html([])));
});

test('hourly cache and concurrent requests reuse one crawl; next request after expiry picks up a new patch', async () => {
  let clock = 1800000000000,
    calls = 0,
    current = items;
  const get = createPatchNotesService({
    now: () => clock,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, PATCH_NOTES_URL);
      assert.equal(options.headers, undefined);
      return new Response(html(current));
    },
  });
  const [first, second] = await Promise.all([get(), get()]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  clock += 3599999;
  await get();
  assert.equal(calls, 1);
  clock++;
  current = [post('next', '2026-11-03T18:00:00Z'), ...items];
  const refreshed = await get();
  assert.equal(calls, 2);
  assert.equal(refreshed.patches[0].title, 'next 패치 노트');
});

test('temporary failures keep the last real list and back off before retrying', async () => {
  let clock = 1800000000000,
    calls = 0,
    fail = false;
  const get = createPatchNotesService({
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return fail ? new Response('Unavailable', { status: 503 }) : new Response(html(items));
    },
  });
  const first = await get();
  clock += 3600000;
  fail = true;
  const stale = await get();
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.patches, first.patches);
  assert.equal(stale.updatedAt, first.updatedAt);
  await get();
  assert.equal(calls, 2);
  clock += 60000;
  fail = false;
  assert.equal((await get()).stale, false);
  assert.equal(calls, 3);
});

test('patch endpoint works without a Riot API key and reports first-fetch errors honestly', async () => {
  for (const fail of [false, true]) {
    const server = createApp({
      apiKey: '',
      fetchImpl: async () =>
        fail ? new Response('Error', { status: 503 }) : new Response(html(items)),
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/patch-notes`);
      const data = await response.json();
      assert.equal(response.status, fail ? 502 : 200);
      if (fail) assert.equal(data.code, 'PATCH_NOTES_UNAVAILABLE');
      else assert.equal(data.patches.length, 3);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('initial crawl failure also backs off instead of retrying on every visitor', async () => {
  let clock = 1800000000000,
    calls = 0;
  const get = createPatchNotesService({
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response('Error', { status: 503 }) : new Response(html(items));
    },
  });
  await assert.rejects(get());
  await assert.rejects(get());
  assert.equal(calls, 1);
  clock += 60000;
  assert.equal((await get()).patches.length, 3);
  assert.equal(calls, 2);
});
