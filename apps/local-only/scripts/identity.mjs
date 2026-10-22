/**
 * Identity and branding for the offline distribution, in one place.
 *
 * Upstream derives every command and view ID from the extension's own
 * package.json `name` (`src/registry.ts`), so renaming the product means
 * patching that file for the bundle *and* rewriting the contributed IDs. Both
 * build and package scripts import this module, which is what keeps the IDs the
 * code registers identical to the IDs the manifest declares — a mismatch would
 * silently drop context menus, keybindings and the webview view itself.
 *
 * `name` and `publisher` are the two lines to edit for a different product
 * name; nothing else has to change.
 */

export const IDENTITY = {
	name: "pline",
	publisher: "local",
	displayName: "Pline",
};

/**
 * The offline distribution versions itself. apps/local-only/package.json carries
 * the version of the other, hand-written local-only client, whose packaging
 * writes `cline-local-<version>.vsix`; sharing that number made the two tracks
 * overwrite each other's artifact in dist/release. This is also the version the
 * bundle reports through ExtensionRegistryInfo, so it must match the VSIX.
 */
export const OFFLINE_VERSION = "0.2.0";

/** Same rule as upstream: the built-in name keeps the short `cline` prefix. */
export const commandPrefix = IDENTITY.name === "claude-dev" ? "cline" : IDENTITY.name;

const pascal = IDENTITY.name.charAt(0).toUpperCase() + IDENTITY.name.slice(1);

const OLD_VIEW_CONTAINER = "claude-dev-ActivityBar";
const OLD_VIEW_ID = "claude-dev.SidebarProvider";

/** Upstream sites. Reaching any of them needs the internet, so they are removed
 * from the offline UI rather than left as links that open an external browser.
 * The `cline.bot` pattern is deliberately broad: the bundles contain
 * `docs.`, `app.`, `api.`, staging hosts and a `@cline.bot` e-mail check, and a
 * missed variant would silently keep a live link. Provider API base URLs
 * (openrouter.ai, api.groq.com, …) are *not* branding — they are configuration
 * defaults for cloud providers — so they stay. */
export const BRAND_PATTERNS = [
	{ label: "*.cline.bot", pattern: /[\w.-]*cline\.bot/gu },
	{ label: "github.com/cline", pattern: /https:\/\/github\.com\/cline\b/gu },
	{ label: "x.com|twitter.com/cline", pattern: /https:\/\/(?:x|twitter)\.com\/cline\b/gu },
];

/**
 * Rewrite the contributed IDs and titles. Strings are matched exactly where an
 * ID is involved and by substring inside `when` clauses, which quote the view ID.
 */
function rename(value, counts) {
	if (typeof value === "string") {
		let next = value;
		if (next === OLD_VIEW_CONTAINER) next = `${IDENTITY.name}-ActivityBar`;
		if (next === "ClineWalkthrough") next = `${pascal}Walkthrough`;
		if (next === "cline-icon") next = `${IDENTITY.name}-icon`;
		if (next.startsWith("cline.")) {
			next = `${commandPrefix}.${next.slice("cline.".length)}`;
			counts.commands += 1;
		}
		if (next.includes(OLD_VIEW_CONTAINER) || next.includes(OLD_VIEW_ID)) {
			next = next.split(OLD_VIEW_CONTAINER).join(`${IDENTITY.name}-ActivityBar`).split(OLD_VIEW_ID).join(`${IDENTITY.name}.SidebarProvider`);
			counts.views += 1;
		}
		return next;
	}
	if (Array.isArray(value)) return value.map((item) => rename(item, counts));
	if (value && typeof value === "object") {
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			// The activity bar container id is also used as a key in `views`.
			const nextKey = key === OLD_VIEW_CONTAINER ? `${IDENTITY.name}-ActivityBar` : key;
			out[nextKey] = rename(item, counts);
		}
		return out;
	}
	return value;
}

/**
 * Build the manifest for this distribution. `source` is apps/vscode/package.json
 * and `version` the offline distribution's version.
 */
export function patchManifest(source, version) {
	const counts = { commands: 0, views: 0 };
	const contributes = rename(source.contributes, counts);
	if (contributes?.viewsContainers?.activitybar) {
		for (const container of contributes.viewsContainers.activitybar) container.title = IDENTITY.displayName;
	}
	for (const list of Object.values(contributes?.views ?? {})) {
		for (const view of list) if (view.name) view.name = IDENTITY.displayName;
	}
	return { manifest: { ...source, ...IDENTITY, ...(version ? { version } : {}), contributes }, counts };
}

/**
 * Replace upstream site URLs with an inert `#` in already-built JavaScript.
 * Applied to the extension bundle and the webview bundle after the fact, so the
 * upstream source stays untouched.
 */
export function stripBrandUrls(code) {
	const counts = {};
	let next = code;
	for (const { label, pattern } of BRAND_PATTERNS) {
		const matches = next.match(pattern);
		counts[label] = matches ? matches.length : 0;
		if (matches) next = next.replace(pattern, "#");
	}
	return { code: next, counts };
}

/** Fail loudly if a brand URL survived, or if the product rename did not reach
 * the compiled code. Command and view IDs are built by concatenation upstream
 * (`prefix + ".plusButtonClicked"`), so they cannot be grepped as literals;
 * instead the inlined identity module is read back and compared. */
export function auditBrandUrls(code) {
	const problems = [];
	for (const { label, pattern } of BRAND_PATTERNS) {
		const left = code.match(pattern);
		if (left) problems.push(`${left.length} upstream link(s) of the form ${label} survived, e.g. ${left[0]}`);
	}
	return problems;
}

export function auditBranding(code) {
	const problems = auditBrandUrls(code);
	const identity = /package\.identity\.json"\(\) \{\s*name\d* = "([\w-]+)";[\s\S]{0,200}?publisher\d* = "([\w-]+)";/u.exec(code);
	if (!identity) {
		problems.push("the bundle does not inline package.identity.json; the rename would not apply");
	} else {
		if (identity[1] !== IDENTITY.name) problems.push(`bundled extension name is ${identity[1]}, expected ${IDENTITY.name}`);
		if (identity[2] !== IDENTITY.publisher) problems.push(`bundled publisher is ${identity[2]}, expected ${IDENTITY.publisher}`);
	}
	if (!code.includes('".SidebarProvider"')) problems.push("the view ID concatenation is missing; registry.ts did not compile as expected");
	return problems;
}
