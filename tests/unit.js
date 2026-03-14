#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  Daily Reader — Unit Tests
//  Run with:  node tests/unit.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── Minimal test framework ────────────────────────────────────────────────────
let passed = 0, failed = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
  console.log('  ' + '─'.repeat(name.length));
}

function test(name, fn) {
  try {
    fn();
    console.log(`    ✅  ${name}`);
    passed++;
  } catch (e) {
    console.log(`    ❌  ${name}`);
    console.log(`        → ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}
function eq(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function includes(str, substr) {
  if (!str.includes(substr))
    throw new Error(`Expected "${str}" to include "${substr}"`);
}

// ── App constants (mirrors index.html) ───────────────────────────────────────
const DAILY_QUOTA = 5;

// ── Pure logic (mirrors index.html, decoupled from DOM/localStorage) ─────────

function blankState(overrides = {}) {
  return {
    currentPage: 1,
    todayStartPage: 1,
    pagesCompletedToday: 0,
    highWaterPageToday: 0,
    todayCompleted: false,
    doneForToday: false,
    totalPagesRead: 0,
    streak: 0,
    lastCompletedDate: null,
    today: null,
    totalPages: 100,
    bookName: 'Test Book',
    notifiedToday: false,
    zoomIdx: 1,
    dailyQuota: DAILY_QUOTA,
    habitLog: {},
    ...overrides,
  };
}

function quota(state) { return state.dailyQuota || DAILY_QUOTA; }

function dayBefore(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function dayAfter(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
function today() {
  return new Date().toISOString().split('T')[0];
}

/** Mirrors handleDayTransition(). Takes explicit `now` for testability. */
function handleDayTransition(state, now) {
  if (state.today === now) return { ...state };           // same day — no change
  const s = { ...state };
  if (s.today !== null) {
    // Log yesterday's habit result
    const log = { ...(s.habitLog || {}) };
    log[s.today] = s.todayCompleted;
    const cutoff = (() => {
      const d = new Date(now + 'T12:00:00'); d.setDate(d.getDate() - 14);
      return d.toISOString().split('T')[0];
    })();
    Object.keys(log).forEach(k => { if (k < cutoff) delete log[k]; });
    s.habitLog = log;

    const wasYesterday = dayBefore(now) === s.today;
    s.streak = (wasYesterday && s.todayCompleted) ? s.streak + 1 : 0;
  }
  const nextBookmark    = s.todayStartPage + s.pagesCompletedToday;
  s.today               = now;
  s.todayStartPage      = nextBookmark;
  s.currentPage         = nextBookmark;
  s.pagesCompletedToday = 0;
  s.highWaterPageToday  = nextBookmark - 1;
  s.todayCompleted      = false;
  s.doneForToday        = false;
  s.notifiedToday       = false;
  return s;
}

/** Mirrors nextPage() logic (sans renderPage / DOM). */
function nextPage(state) {
  const s         = { ...state };
  const highWater = s.highWaterPageToday || (s.todayStartPage - 1);

  // FREE NAVIGATION — already-seen page
  if (s.currentPage < highWater) {
    s.currentPage++;
    return { state: s, action: 'free_nav' };
  }

  // NEW PAGE
  s.currentPage++;
  s.pagesCompletedToday++;
  s.totalPagesRead++;
  if (!s.todayCompleted && s.pagesCompletedToday >= quota(s)) {
    s.todayCompleted = true;
  }

  if (s.currentPage > s.totalPages) {
    s.streak++;
    return { state: s, action: 'book_done' };
  }
  return { state: s, action: 'new_page' };
}

/** Mirrors prevPage() logic. */
function prevPage(state) {
  if (state.currentPage <= state.todayStartPage)
    return { state: { ...state }, action: 'blocked' };
  const s = { ...state, currentPage: state.currentPage - 1 };
  return { state: s, action: 'prev' };
}

/** Mirrors onDoneTap() message logic. */
function getDoneMessage(state) {
  const remaining = DAILY_QUOTA - state.pagesCompletedToday;
  if (state.pagesCompletedToday === 0)
    return `📖 You haven't started yet — ${DAILY_QUOTA} pages is all it takes!`;
  if (remaining > 0)
    return `📖 ${remaining} more page${remaining > 1 ? 's' : ''} to hit your daily goal`;
  if (state.pagesCompletedToday === DAILY_QUOTA)
    return `🎉 Daily goal complete! Keep reading if you like`;
  const bonus = state.pagesCompletedToday - DAILY_QUOTA;
  return `⭐ ${bonus} bonus page${bonus > 1 ? 's' : ''} today — fantastic!`;
}

/** Helper: simulate reading N pages (also updates highWater as renderPage does). */
function readNPages(state, n) {
  let s = { ...state };
  for (let i = 0; i < n; i++) {
    const r = nextPage(s);
    s = r.state;
    if (s.currentPage > (s.highWaterPageToday || 0))
      s.highWaterPageToday = s.currentPage;  // mirrors renderPage() highWater update
  }
  return s;
}

/** Helper: simulate pressing ← N times. */
function pressBack(state, n = 1) {
  let s = { ...state };
  for (let i = 0; i < n; i++) {
    const r = prevPage(s);
    s = r.state;
  }
  return s;
}


// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITES
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. Day transition — same day ─────────────────────────────────────────────
suite('1 · Day transition — same day');

test('No change when today === stored date', () => {
  const now = today();
  const s0  = blankState({ today: now, todayStartPage: 5, pagesCompletedToday: 3, streak: 2 });
  const s1  = handleDayTransition(s0, now);
  eq(s1.todayStartPage,      5, 'todayStartPage unchanged');
  eq(s1.pagesCompletedToday, 3, 'pagesCompletedToday unchanged');
  eq(s1.streak,              2, 'streak unchanged');
  eq(s1.currentPage,         s0.currentPage, 'currentPage unchanged');
});


// ── 2. Day transition — next day, bookmark accuracy ──────────────────────────
suite('2 · Day transition — next day bookmark');

test('Bookmark = todayStartPage + pagesCompletedToday', () => {
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({ today: yesterday, todayStartPage: 1, pagesCompletedToday: 24,
                           currentPage: 3, todayCompleted: true });
  const s1 = handleDayTransition(s0, now);
  eq(s1.todayStartPage, 25, 'starts at page 25');
  eq(s1.currentPage,    25, 'currentPage set to 25');
});

test('Bookmark unaffected by currentPage (user backed up)', () => {
  // Read to page 25, backed to page 3 — bookmark must still be 25
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({
    today: yesterday, todayStartPage: 1, pagesCompletedToday: 24,
    currentPage: 3,   // backed up
    highWaterPageToday: 25, todayCompleted: true,
  });
  const s1 = handleDayTransition(s0, now);
  eq(s1.todayStartPage, 25);
  eq(s1.currentPage,    25);
});

test('Day-2 bookmark chains correctly from day-1', () => {
  // Day 1: pages 1-5 (todayStartPage=1, pagesCompleted=4 → nextBookmark=5)
  // Day 2: pages 5-9 (todayStartPage=5, pagesCompleted=4 → nextBookmark=9)
  // Day 3: should start at page 9
  const d1 = '2026-01-10';
  const d2 = dayAfter(d1);
  const d3 = dayAfter(d2);

  let s = blankState({ today: d1, todayStartPage: 1 });
  s = readNPages(s, 4);                       // read 4 new pages → page 5
  s = handleDayTransition(s, d2);             // next day
  eq(s.todayStartPage, 5, 'day-2 starts at 5');

  s = readNPages(s, 4);                       // read 4 more
  s = handleDayTransition(s, d3);
  eq(s.todayStartPage, 9, 'day-3 starts at 9');
});

test('pagesCompletedToday resets to 0 on new day', () => {
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({ today: yesterday, pagesCompletedToday: 24, todayCompleted: true });
  const s1 = handleDayTransition(s0, now);
  eq(s1.pagesCompletedToday, 0);
  eq(s1.todayCompleted,      false);
  eq(s1.doneForToday,        false);
});

test('highWaterPageToday reset to bookmark-1 on new day', () => {
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({ today: yesterday, todayStartPage: 1, pagesCompletedToday: 4,
                           highWaterPageToday: 5 });
  const s1 = handleDayTransition(s0, now);
  // nextBookmark = 1+4 = 5, highWater = 5-1 = 4 (no pages rendered yet today)
  eq(s1.highWaterPageToday, 4);
});


// ── 3. Streak logic ───────────────────────────────────────────────────────────
suite('3 · Streak logic');

test('Streak increments on consecutive day with quota met', () => {
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({ today: yesterday, streak: 3, todayCompleted: true });
  const s1 = handleDayTransition(s0, now);
  eq(s1.streak, 4);
});

test('Streak resets if yesterday quota was NOT met', () => {
  const yesterday = '2026-01-10';
  const now       = dayAfter(yesterday);
  const s0 = blankState({ today: yesterday, streak: 5, todayCompleted: false });
  const s1 = handleDayTransition(s0, now);
  eq(s1.streak, 0);
});

test('Streak resets if a day was skipped', () => {
  const twoDaysAgo = '2026-01-09';
  const now        = '2026-01-11';
  const s0 = blankState({ today: twoDaysAgo, streak: 10, todayCompleted: true });
  const s1 = handleDayTransition(s0, now);
  eq(s1.streak, 0);
});

test('Streak stays 0 on very first day transition (today was null)', () => {
  const now = today();
  const s0  = blankState({ today: null, streak: 0 });
  const s1  = handleDayTransition(s0, now);
  eq(s1.streak, 0);
});


// ── 4. Navigation — nextPage ──────────────────────────────────────────────────
suite('4 · nextPage — free navigation vs new page');

test('New page increments pagesCompletedToday and totalPagesRead', () => {
  const s0 = blankState({ currentPage: 1, highWaterPageToday: 1 });
  const { state: s1, action } = nextPage(s0);
  eq(action,                   'new_page');
  eq(s1.currentPage,           2);
  eq(s1.pagesCompletedToday,   1);
  eq(s1.totalPagesRead,        1);
});

test('Free navigation does NOT increment counters', () => {
  // highWater=10, currentPage=5 → tapping → is free nav
  const s0 = blankState({ currentPage: 5, highWaterPageToday: 10, pagesCompletedToday: 9 });
  const { state: s1, action } = nextPage(s0);
  eq(action,                  'free_nav');
  eq(s1.currentPage,          6);
  eq(s1.pagesCompletedToday,  9,  'counter unchanged');
  eq(s1.totalPagesRead,       0,  'totalPagesRead unchanged');
});

test('Quota flag set when pagesCompletedToday reaches DAILY_QUOTA', () => {
  let s = blankState({ currentPage: 1 });
  s = readNPages(s, DAILY_QUOTA - 1);
  eq(s.todayCompleted, false, 'not yet at quota');
  s = readNPages(s, 1);                         // exactly hits quota
  eq(s.todayCompleted, true,  'quota reached');
  eq(s.pagesCompletedToday, DAILY_QUOTA);
});

test('Can read beyond quota without todayCompleted flipping back', () => {
  let s = blankState({ currentPage: 1 });
  s = readNPages(s, DAILY_QUOTA + 3);
  eq(s.todayCompleted,     true);
  eq(s.pagesCompletedToday, DAILY_QUOTA + 3);
});

test('End of book triggers book_done and increments streak', () => {
  // User is ON the last page (100) and presses Next → currentPage becomes 101 > totalPages
  const s0 = blankState({ currentPage: 100, totalPages: 100,
                           highWaterPageToday: 100, streak: 2 });
  const { state: s1, action } = nextPage(s0);
  eq(action,         'book_done');
  eq(s1.streak,      3);
  eq(s1.currentPage, 101);  // overshoots — app catches this with > totalPages check
});

test('Back-and-forward: free nav through already-read pages doesn\'t inflate counters', () => {
  // Read 10 pages (start at 1, end at page 11)
  let s = blankState({ currentPage: 1 });
  s = readNPages(s, 10);
  eq(s.pagesCompletedToday, 10);

  // Go back 5 pages
  s = pressBack(s, 5);
  eq(s.currentPage,         6);
  eq(s.pagesCompletedToday, 10, 'backing up should not change counter');

  // Press → 5 times (all free nav — already seen)
  const before = s.pagesCompletedToday;
  s = readNPages(s, 5); // these should all be free_nav since highWater=11
  eq(s.pagesCompletedToday, before, 'free nav: counter still 10');
  eq(s.currentPage, 11);
});


// ── 5. Navigation — prevPage ──────────────────────────────────────────────────
suite('5 · prevPage');

test('Blocked at todayStartPage', () => {
  const s0 = blankState({ currentPage: 5, todayStartPage: 5 });
  const { action } = prevPage(s0);
  eq(action, 'blocked');
});

test('Blocked if currentPage < todayStartPage (safety)', () => {
  const s0 = blankState({ currentPage: 3, todayStartPage: 5 });
  const { action } = prevPage(s0);
  eq(action, 'blocked');
});

test('Decrements currentPage correctly', () => {
  const s0 = blankState({ currentPage: 8, todayStartPage: 1 });
  const { state: s1, action } = prevPage(s0);
  eq(action,          'prev');
  eq(s1.currentPage,  7);
});

test('prevPage does not change pagesCompletedToday', () => {
  const s0 = blankState({ currentPage: 8, todayStartPage: 1, pagesCompletedToday: 7 });
  const { state: s1 } = prevPage(s0);
  eq(s1.pagesCompletedToday, 7);
});


// ── 6. Done button message ────────────────────────────────────────────────────
suite('6 · Done button — contextual message');

test('0 pages read → "haven\'t started" message', () => {
  const s = blankState({ pagesCompletedToday: 0 });
  includes(getDoneMessage(s), "haven't started");
});

test('1 page read (4 remaining) → "4 more pages"', () => {
  const s = blankState({ pagesCompletedToday: 1 });
  const msg = getDoneMessage(s);
  includes(msg, '4 more pages');
});

test('4 pages read (1 remaining) → singular "1 more page"', () => {
  const s = blankState({ pagesCompletedToday: 4 });
  const msg = getDoneMessage(s);
  includes(msg, '1 more page');
  assert(!msg.includes('pages'), 'should be singular');
});

test('Exactly DAILY_QUOTA pages → "Daily goal complete"', () => {
  const s = blankState({ pagesCompletedToday: DAILY_QUOTA, todayCompleted: true });
  includes(getDoneMessage(s), 'Daily goal complete');
});

test('1 bonus page → singular "1 bonus page"', () => {
  const s = blankState({ pagesCompletedToday: DAILY_QUOTA + 1, todayCompleted: true });
  const msg = getDoneMessage(s);
  includes(msg, '1 bonus page');
  assert(!msg.includes('pages'), 'should be singular');
});

test('3 bonus pages → plural "3 bonus pages"', () => {
  const s = blankState({ pagesCompletedToday: DAILY_QUOTA + 3, todayCompleted: true });
  includes(getDoneMessage(s), '3 bonus pages');
});


// ── 7. Key user scenario: read to 25, back to 3, Done / close ────────────────
suite('7 · Scenario: read to page 25, back to page 3');

function buildScenarioState() {
  // todayStartPage = 1, read to page 25 (24 Next taps)
  let s = blankState({ today: '2026-01-10', todayStartPage: 1, currentPage: 1 });
  s = readNPages(s, 24);
  // Sanity checks
  eq(s.currentPage,          25);
  eq(s.pagesCompletedToday,  24);
  eq(s.highWaterPageToday,   25);
  eq(s.todayCompleted,       true);
  return s;
}

test('Baseline: reading 24 pages gives correct state', () => {
  buildScenarioState(); // assertions inside
});

test('Back to page 3 does NOT change pagesCompletedToday', () => {
  let s = buildScenarioState();
  s = pressBack(s, 22);             // 25 → 3
  eq(s.currentPage,         3);
  eq(s.pagesCompletedToday, 24);
  eq(s.highWaterPageToday,  25);
});

test('Done at page 3 → next-day bookmark is still page 25', () => {
  let s = buildScenarioState();
  s = pressBack(s, 22);
  s = { ...s, doneForToday: true }; // onDoneTap() effect
  const nextDay = dayAfter(s.today);
  const s2 = handleDayTransition(s, nextDay);
  eq(s2.todayStartPage, 25, 'starts at 25');
  eq(s2.currentPage,    25);
});

test('Close at page 3 (no Done tap) → next-day bookmark is still page 25', () => {
  let s = buildScenarioState();
  s = pressBack(s, 22);
  // No Done tap — just "closed tab" — state is as-is
  const nextDay = dayAfter(s.today);
  const s2 = handleDayTransition(s, nextDay);
  eq(s2.todayStartPage, 25, 'starts at 25 regardless of Done tap');
  eq(s2.currentPage,    25);
});

test('Same-day reopen at page 3: free nav still works up to highWater', () => {
  let s = buildScenarioState();
  s = pressBack(s, 22);              // at page 3, highWater=25
  // Simulate reopening same day: no day transition
  // Tap → 5 times from page 3 — should be free nav (no counter change)
  const before = s.pagesCompletedToday;
  for (let i = 0; i < 5; i++) {
    const r = nextPage(s);
    eq(r.action, 'free_nav', `tap ${i + 1} should be free nav`);
    s = r.state;
  }
  eq(s.currentPage,         8);
  eq(s.pagesCompletedToday, before, 'counter unchanged during free nav');
});

test('Continuing to page 26 (new territory) increments counter', () => {
  let s = buildScenarioState();     // highWater=25, page=25
  const r = nextPage(s);
  eq(r.action,                   'new_page');
  eq(r.state.currentPage,        26);
  eq(r.state.pagesCompletedToday, 25);
});


// ── 8. Multi-day streak scenario ──────────────────────────────────────────────
suite('8 · Multi-day streak scenario');

test('7-day reading streak builds correctly', () => {
  const BASE = '2026-01-10';
  let s = blankState({ today: BASE, todayStartPage: 1 });

  for (let day = 0; day < 7; day++) {
    const dateStr = (() => {
      const d = new Date(BASE + 'T12:00:00');
      d.setDate(d.getDate() + day);
      return d.toISOString().split('T')[0];
    })();

    if (day > 0) s = handleDayTransition(s, dateStr);
    s = readNPages(s, DAILY_QUOTA);
    eq(s.todayCompleted, true, `day ${day + 1} quota met`);
  }

  // Trigger day 8 transition to finalise streak
  const day8 = (() => {
    const d = new Date(BASE + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  })();
  s = handleDayTransition(s, day8);
  eq(s.streak, 7, '7-day streak');
});

test('Missing one day resets streak to 0', () => {
  const d1 = '2026-01-10';
  const d3 = '2026-01-12'; // skip d2
  let s = blankState({ today: d1, streak: 5, todayCompleted: true });
  s = handleDayTransition(s, d3);
  eq(s.streak, 0);
});


// ── 9. Book progress calculation ─────────────────────────────────────────────
suite('9 · Book progress — always based on furthest page reached');

/** Mirrors the fixed openStats() calculation. */
function bookProgressPct(state) {
  const tp   = state.totalPages || 1;
  const done = (state.todayStartPage - 1) + state.pagesCompletedToday;
  return Math.round((done / tp) * 100);
}

test('Progress reflects pages read, not currentPage', () => {
  // Read to page 16 (15 Next taps from page 1), then back up to page 10
  let s = blankState({ currentPage: 1, todayStartPage: 1, totalPages: 940 });
  s = readNPages(s, 15);          // now on page 16, pagesCompletedToday=15
  const pctAtPage16 = bookProgressPct(s);

  s = pressBack(s, 6);            // back to page 10
  eq(s.currentPage, 10);
  const pctAtPage10 = bookProgressPct(s);

  eq(pctAtPage16,  pctAtPage10, 'progress unchanged after scrolling back');
});

test('Progress increases only when reading new pages', () => {
  let s = blankState({ currentPage: 1, todayStartPage: 1, totalPages: 100 });
  s = readNPages(s, 10);
  const pct1 = bookProgressPct(s);   // 10%
  s = readNPages(s, 5);
  const pct2 = bookProgressPct(s);   // 15%
  assert(pct2 > pct1, 'progress should grow when reading forward');
  eq(pct2, 15);
});

test('Progress carries over across days correctly', () => {
  const d1 = '2026-01-10';
  const d2 = dayAfter(d1);
  let s = blankState({ today: d1, todayStartPage: 1, totalPages: 200 });
  s = readNPages(s, 10);                    // day 1: pages 1-10
  s = handleDayTransition(s, d2);           // next day
  s = readNPages(s, 10);                    // day 2: pages 11-20
  eq(bookProgressPct(s), 10);              // 20/200 = 10%
});

// ── 10. Edge cases ─────────────────────────────────────────────────────────────
suite('10 · Edge cases');

test('Reading exactly to last page marks book_done', () => {
  // book_done fires when pressing Next FROM the last page (currentPage > totalPages)
  const s0 = blankState({ currentPage: 100, totalPages: 100, highWaterPageToday: 100 });
  const { action } = nextPage(s0);
  eq(action, 'book_done');
});

test('Single-page book: reading page 1 → book_done', () => {
  const s0 = blankState({ currentPage: 1, totalPages: 1, highWaterPageToday: 0,
                           todayStartPage: 1 });
  const { action, state: s1 } = nextPage(s0);
  eq(action,        'book_done');
  eq(s1.currentPage, 2);  // currentPage overshoots to 2, > totalPages
});

test('highWater stays at max even after backing up', () => {
  let s = blankState({ currentPage: 1 });
  s = readNPages(s, 9);              // read to page 10, highWater=10
  eq(s.highWaterPageToday, 10);
  s = pressBack(s, 5);               // go back to page 5
  eq(s.highWaterPageToday, 10, 'highWater unchanged by prevPage');
});

test('Pressing Done at 0 pages does not crash and shows correct message', () => {
  const s = blankState({ pagesCompletedToday: 0 });
  const msg = getDoneMessage(s);
  assert(msg.length > 0, 'message should not be empty');
  includes(msg, 'pages is all it takes');
});

test('todayStartPage > 1 (returning reader): free nav works within session', () => {
  // Day 2 user starts at page 26
  let s = blankState({ currentPage: 26, todayStartPage: 26, highWaterPageToday: 25 });
  // Reading page 26 is new territory
  const { action: a1, state: s1 } = nextPage(s);
  eq(a1, 'new_page');
  eq(s1.currentPage, 27);
  eq(s1.pagesCompletedToday, 1);
});


// ── 11. Configurable daily quota ─────────────────────────────────────────────
suite('11 · Configurable daily quota');

test('quota() returns dailyQuota from state when set', () => {
  const s = blankState({ dailyQuota: 10 });
  eq(quota(s), 10);
});

test('quota() falls back to DAILY_QUOTA when unset', () => {
  const s = blankState({ dailyQuota: undefined });
  eq(quota(s), DAILY_QUOTA);
});

test('todayCompleted triggers at custom quota of 10', () => {
  let s = blankState({ currentPage: 1, dailyQuota: 10 });
  s = readNPages(s, 9);
  eq(s.todayCompleted, false, 'not yet at 10');
  s = readNPages(s, 1);
  eq(s.todayCompleted, true, 'hit 10-page quota');
  eq(s.pagesCompletedToday, 10);
});

test('todayCompleted triggers at custom quota of 3', () => {
  let s = blankState({ currentPage: 1, dailyQuota: 3 });
  s = readNPages(s, 2);
  eq(s.todayCompleted, false);
  s = readNPages(s, 1);
  eq(s.todayCompleted, true);
});

test('Changing quota mid-session does not corrupt pagesCompletedToday', () => {
  let s = blankState({ currentPage: 1, dailyQuota: 5 });
  s = readNPages(s, 3);
  eq(s.pagesCompletedToday, 3);
  // User changes quota to 10
  s = { ...s, dailyQuota: 10 };
  eq(quota(s), 10, 'quota updated');
  eq(s.pagesCompletedToday, 3, 'pages read unchanged');
  eq(s.todayCompleted, false, 'not complete yet under new quota');
});


// ── 12. Habit log ─────────────────────────────────────────────────────────────
suite('12 · Habit log — day transition writes correct entries');

test('Completed day is logged as true', () => {
  const d1 = '2026-01-10';
  const d2 = dayAfter(d1);
  let s = blankState({ today: d1, todayCompleted: true });
  s = handleDayTransition(s, d2);
  eq(s.habitLog[d1], true, 'd1 logged as completed');
});

test('Missed day is logged as false', () => {
  const d1 = '2026-01-10';
  const d2 = dayAfter(d1);
  let s = blankState({ today: d1, todayCompleted: false });
  s = handleDayTransition(s, d2);
  eq(s.habitLog[d1], false, 'd1 logged as missed');
});

test('Habit log accumulates over multiple days', () => {
  const base = '2026-01-10';
  let s = blankState({ today: base, todayStartPage: 1 });

  // Day 1: complete
  s = readNPages(s, 5);
  s = handleDayTransition(s, dayAfter(base));
  eq(s.habitLog[base], true, 'day 1 complete');

  // Day 2: don't complete
  s = handleDayTransition(s, '2026-01-12');
  eq(s.habitLog['2026-01-11'], false, 'day 2 missed');
});

test('Old entries (>14 days) are pruned from habit log', () => {
  const old   = '2025-12-01';
  const now   = '2026-01-10';
  let s = blankState({ today: old, todayCompleted: true, habitLog: { [old]: true } });
  s = handleDayTransition(s, now);
  assert(!(old in s.habitLog), 'old entry pruned');
});

test('Recent entries are kept after pruning', () => {
  const d1  = '2026-01-08';
  const d2  = '2026-01-09';
  const now = '2026-01-10';
  let s = blankState({ today: d2, todayCompleted: true, habitLog: { [d1]: false } });
  s = handleDayTransition(s, now);
  assert(d1 in s.habitLog, 'd1 kept');
  assert(d2 in s.habitLog, 'd2 logged');
});

test('First-ever transition does not write habitLog (today was null)', () => {
  const now = '2026-01-10';
  let s = blankState({ today: null, habitLog: {} });
  s = handleDayTransition(s, now);
  eq(Object.keys(s.habitLog).length, 0, 'no entry written when today was null');
});


// ═════════════════════════════════════════════════════════════════════════════
//  Summary
// ═════════════════════════════════════════════════════════════════════════════
const total = passed + failed;
console.log(`\n${'═'.repeat(50)}`);
if (failed === 0) {
  console.log(`  ✅  All ${total} tests passed`);
} else {
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${total}`);
  process.exit(1);
}
console.log(`${'═'.repeat(50)}\n`);
