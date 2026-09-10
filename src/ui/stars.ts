/**
 * Live star count for the repository.
 *
 * The number is fetched rather than typed into the markup, because a hand-written
 * count is wrong the day after it is written and there is no way for a visitor to
 * tell. If the request fails the element simply stays hidden, so the button still
 * works and nothing on the sheet claims a figure it does not have.
 *
 * Cached in `localStorage` for an hour. The unauthenticated GitHub API allows 60
 * requests an hour per address, and a shared address behind one network could burn
 * that on page loads alone. An hour-old count is accurate enough for a figure that
 * moves a few times a day.
 */

const TTL_MS = 60 * 60 * 1000;

interface CachedCount {
  readonly count: number;
  readonly at: number;
}

function readCache(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCount;
    if (typeof parsed.count !== "number" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return parsed.count;
  } catch {
    // Private mode, disabled storage, or corrupt entry. Fetching still works.
    return null;
  }
}

function writeCache(key: string, count: number): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ count, at: Date.now() }));
  } catch {
    // Storage being unavailable is not worth telling anybody about.
  }
}

/**
 * Fill `target` with the repository's star count.
 *
 * `repo` is `owner/name`. Resolves once the element is either populated or left
 * hidden, and never throws.
 */
export async function showStarCount(
  target: HTMLElement,
  repo: string,
): Promise<void> {
  const key = `roadwright.stars.${repo}`;

  const show = (count: number): void => {
    // A zero is a true number and still worth leaving off. Showing nothing makes no
    // claim at all, whereas a printed 0 reads as a broken widget on a new repository.
    if (count <= 0) return;
    target.textContent = count.toLocaleString();
    target.hidden = false;
    const label = target.closest("a");
    if (label) {
      label.setAttribute(
        "aria-label",
        `Star Roadwright on GitHub. ${count.toLocaleString()} ${count === 1 ? "star" : "stars"} so far.`,
      );
    }
  };

  const cached = readCache(key);
  if (cached !== null) show(cached);

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { stargazers_count?: unknown };
    const count = body.stargazers_count;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return;
    writeCache(key, count);
    show(count);
  } catch {
    // Offline, blocked, or rate limited. The cached value stands if there was one.
  }
}
