/**
 * Contract check for the plugin's display metadata.
 *
 * The plugin manager reads a plugin's title and description from
 * `<specifier>/locale/<lang>.json` (key `meta`) and its icon from the `icon`
 * field of `<specifier>/package.json`. Both are resolved through the package's
 * own `exports` map, so a missing subpath export means an empty card, even when
 * the files exist. This test resolves exactly those specifiers and validates the
 * shapes the host expects.
 *
 *   node test/metadata-check.mjs
 */

import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const name = manifest.name;

const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail).slice(0, 160)}`}`);
}

// Self-reference resolves through the package's exports map, the same way the
// host's resource resolver does.
const require = createRequire(join(packageRoot, "package.json"));
function resolve(specifier) {
	try {
		return require.resolve(specifier);
	} catch (error) {
		return error;
	}
}

console.log("exports map");
const mainEntry = resolve(name);
check("the plugin entry resolves", typeof mainEntry === "string", mainEntry?.code ?? mainEntry?.message);
const manifestPath = resolve(`${name}/package.json`);
check("package.json is exported (the host reads the icon from it)", typeof manifestPath === "string", manifestPath?.code ?? manifestPath?.message);
const englishPath = resolve(`${name}/locale/en.json`);
check("locale/en.json is exported", typeof englishPath === "string", englishPath?.code ?? englishPath?.message);

console.log("icon");
const icon = manifest.icon;
check("the manifest declares an icon", typeof icon === "string" && icon.trim() !== "");
if (typeof icon === "string") {
	check("the icon is a relative path", !isAbsolute(icon) && !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon), icon);
	const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
	check("the icon has an allowed media type", allowed.includes(extname(icon).toLowerCase()), extname(icon));
	const iconPath = join(packageRoot, icon);
	let size = 0;
	try { size = statSync(iconPath).size; } catch { size = -1; }
	check("the icon exists", size >= 0, iconPath);
	check("the icon stays inside the package", !relative(packageRoot, iconPath).startsWith(".."), relative(packageRoot, iconPath));
	check("the icon is at most 256 KiB", size >= 0 && size <= 256 * 1024, `${size} bytes`);
}

console.log("locale files (the shape the host reads)");
const languages = [];
const localeDirectories = new Set();
if (typeof englishPath === "string") {
	const directory = dirname(englishPath);
	check("locale files live in one directory beside package.json", directory === join(packageRoot, "locale"), directory);
	for (const file of ["en.json", "ru.json"]) {
		const specifier = `${name}/locale/${file}`;
		const resolved = resolve(specifier);
		check(`${specifier} resolves`, typeof resolved === "string", resolved?.code ?? resolved?.message);
		if (typeof resolved !== "string") continue;
		localeDirectories.add(dirname(resolved));
		let parsed = null;
		try { parsed = JSON.parse(readFileSync(resolved, "utf8")); } catch (error) { parsed = error; }
		check(`${file} is valid JSON`, parsed !== null && !(parsed instanceof Error), parsed?.message);
		if (parsed === null || parsed instanceof Error) continue;
		const meta = parsed.meta;
		check(`${file} has a meta object`, meta !== undefined && typeof meta === "object", JSON.stringify(parsed).slice(0, 80));
		check(`${file} meta.title is a non-empty string`, typeof meta?.title === "string" && meta.title.trim() !== "", meta?.title);
		check(`${file} meta.description is a non-empty string`, typeof meta?.description === "string" && meta.description.trim() !== "", meta?.description);
		languages.push([file.slice(0, -5), meta]);
	}
	check("every locale shares the English directory", localeDirectories.size === 1, [...localeDirectories].join(" | "));
}

console.log("what the card would show");
const english = languages.find(([language]) => language === "en")?.[1];
check("the English title is the requested one", english?.title === "Voice Input by Alex Naletko", english?.title);
check("the description is longer than the title", (english?.description?.length ?? 0) > (english?.title?.length ?? 0));
check("a Russian translation ships too", languages.some(([language]) => language === "ru"));
check("the manifest description is a usable fallback", typeof manifest.description === "string" && manifest.description.trim() !== "");
check("the fork publishes under its own repository", String(manifest.repository?.url ?? "").includes("naletko/dsh-voice-input"), manifest.repository?.url);

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
