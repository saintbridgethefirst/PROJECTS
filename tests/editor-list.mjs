// Shared by browser suites (not a suite itself): these suites check what's inside every part of the
// task editor, so they show the editor as one list ("Show everything in one list") rather than tabs.
// The tabs themselves are tested in tests/editortabs.mjs.
export function editorAsOneList(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('tt_editor_layout', 'list'); } catch { /* private mode */ } });
    return ctx;
  };
  return browser;
}
