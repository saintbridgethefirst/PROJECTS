// Opens one of the in-app sample teams (drone, corporate, satellite, formula) the way a signed-in person
// does: sign in on the home page (demo mode), then a sample card on the home screen. Penteint Projects
// has no public /demo page, so suites use this instead.
export async function openSample(p, base, kind = 'drone', name = 'Sam') {
  await p.goto(base); await p.waitForSelector('#auth-screen:not([hidden]) #auth-actions input[type=email]', { timeout: 20000 });
  await p.fill('#auth-actions input[placeholder="Your name"]', name);
  await p.fill('#auth-actions input[type=email]', name.toLowerCase() + '@penteint-demo.com');
  await p.click('#auth-actions button:has-text("Sign in to demo")');
  await p.waitForSelector('#home-screen:not([hidden])', { timeout: 20000 });
  await p.click(`.sample-card[data-sample="${kind}"]`);
  await p.waitForSelector('.task-card', { timeout: 20000 });
}
