// Runs on `git commit` (via .husky/pre-commit) against staged files only.
// Windows caps a command line at ~8k characters, so a big commit (e.g. a bulk
// reformat) checks the whole project instead of listing every file.
const MAX_FILES = 40;
const quote = (files) => files.map((f) => `"${f}"`).join(" ");

export default {
  "*.{ts,tsx,js,mjs}": (files) =>
    files.length > MAX_FILES
      ? ["eslint --fix", "prettier --write ."]
      : [`eslint --fix ${quote(files)}`, `prettier --write ${quote(files)}`],
  "*.{css,json,yml,yaml}": (files) =>
    files.length > MAX_FILES ? "prettier --write ." : `prettier --write ${quote(files)}`,
};
