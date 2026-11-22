// Multi-step actions several UI tests share.

// Start a live workout with one exercise and fill its first set.
export async function logOneSet(page, { key = "bench_press", weight = "100", reps = "5" } = {}) {
  await page.click('[data-act="start"]');
  await page.waitFor("#editor");
  await page.click('[data-act="addex"]');
  await page.waitFor("#picker");
  await page.click(`.pkitem[data-key="${key}"]`);
  await page.click('[data-act="pkadd"]');
  await page.waitFor('#editor input[data-f="weight"]');
  await page.type('#editor input[data-f="weight"]', weight);
  await page.type('#editor input[data-f="reps"]', reps);
  await page.click('#editor [data-act="tick"]');
  await page.click('#editor [data-act="save"]');
  await page.waitFor(".cx-ask-box");
  await page.click(".cx-yes");
  await page.waitFor(() => document.getElementById("editor").hidden);
}
