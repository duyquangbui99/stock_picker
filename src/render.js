const COLOR = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (COLOR ? `[${code}m${s}[0m` : s);

export const dim = paint("2");
export const bold = paint("1");
export const cyan = paint("36");
export const yellow = paint("33");

/**
 * Progress goes to stderr, the report goes to stdout — so `pick > report.md`
 * captures the analysis and nothing else.
 */
export function createReporter({ verbose = false } = {}) {
  const note = (s) => process.stderr.write(`${s}\n`);
  let searches = 0;
  let writing = false;

  return (event) => {
    switch (event.type) {
      case "searching":
        searches += 1;
        note(`${cyan("  search")} ${dim(`${searches}.`)} ${event.query}`);
        break;
      case "fetching":
        note(`${cyan("  fetch  ")} ${dim(event.url)}`);
        break;
      case "note":
        if (verbose) note(dim(`  ${event.text.trim().replace(/\n+/g, " ").slice(0, 160)}`));
        break;
      case "thinking":
        if (event.text) {
          if (verbose) process.stderr.write(dim(event.text));
        } else note(dim("  thinking…"));
        break;
      case "writing":
        if (!writing) {
          writing = true;
          note(`\n${dim("─".repeat(60))}\n`);
        }
        break;
      case "text":
        process.stdout.write(event.text);
        break;
      case "notice":
        note(yellow(`  ! ${event.text}`));
        break;
    }
  };
}

/** Part of the report itself, so: plain markdown, no escape codes. */
export function renderSources(sources) {
  if (sources.length === 0) return "";
  const lines = sources.map(
    (s, i) => `${i + 1}. [${s.title}](${s.url})${s.age ? ` — ${s.age}` : ""}`,
  );
  return `\n\nSOURCES\n${lines.join("\n")}\n`;
}

/** Run metadata — stderr, never part of the saved report. */
export function renderFooter({ usage, seconds, sources }) {
  const cost =
    usage.cost == null ? "" : ` · ~$${usage.cost.toFixed(2)} equivalent`;
  return dim(
    `\n${sources} sources · ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out tokens · ${seconds}s${cost}\n`,
  ); // `sources` may be a count or a "N cited / M seen" summary
}
