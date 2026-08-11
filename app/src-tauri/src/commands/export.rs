//! Markdown → HTML export.
//!
//! Produces a single self-contained file: styles inlined, no external requests,
//! no fonts to fetch. It should open identically on a machine that has never
//! heard of Inkpen, including offline.

use pulldown_cmark::{html, Options, Parser};

use crate::error::Result;

/// Print-first stylesheet. Deliberately close to the editor's own type scale so
/// an exported document reads like what was on screen, without dragging the
/// editor chrome along with it.
const STYLE: &str = r#"
:root {
  --fg: #24292f; --muted: #57606a; --border: #d0d7de;
  --code-bg: #f6f8fa; --accent: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6edf3; --muted: #8b949e; --border: #30363d; --code-bg: #161b22; --accent: #4493f8; }
  body { background: #0d1117; }
}
* { box-sizing: border-box; }
body {
  max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 6rem;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  font-size: 16px; line-height: 1.65; color: var(--fg);
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 1rem; font-weight: 650; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
h1, h2 { padding-bottom: .3em; border-bottom: 1px solid var(--border); }
p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
a { color: var(--accent); }
code {
  font-family: "Cascadia Code", Consolas, ui-monospace, monospace;
  font-size: .9em; background: var(--code-bg); padding: .15em .35em; border-radius: 4px;
}
pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: .875em; }
blockquote {
  margin-left: 0; padding: 0 1rem; color: var(--muted);
  border-left: .25em solid var(--border);
}
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--border); padding: .4rem .7rem; text-align: left; }
th { background: var(--code-bg); }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }
ul.contains-task-list { list-style: none; padding-left: 1.2rem; }
input[type=checkbox] { margin-right: .4rem; }
@media print {
  body { max-width: none; padding: 0; font-size: 11pt; }
  a { color: inherit; text-decoration: underline; }
  h1, h2, h3, h4 { break-after: avoid; }
  pre, blockquote, table { break-inside: avoid; }
}
"#;

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Splits a leading YAML front-matter block off the document.
///
/// Without this, CommonMark reads `title: Sample` followed by `---` as a setext
/// heading, so the metadata renders as a visible heading in the exported file.
/// Front matter is metadata about the document, not part of it.
///
/// Returns `(body, title_from_front_matter)`.
fn split_front_matter(markdown: &str) -> (&str, Option<String>) {
    let rest = match markdown.strip_prefix("---\n").or_else(|| markdown.strip_prefix("---\r\n")) {
        Some(rest) => rest,
        None => return (markdown, None),
    };

    // Find the closing fence at the start of a line.
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            let block = &rest[..offset];
            let body = &rest[offset + line.len()..];
            let title = block.lines().find_map(|l| {
                let (key, value) = l.split_once(':')?;
                if key.trim().eq_ignore_ascii_case("title") {
                    let v = value.trim().trim_matches(['"', '\'']).to_string();
                    if v.is_empty() { None } else { Some(v) }
                } else {
                    None
                }
            });
            return (body.trim_start_matches(['\r', '\n']), title);
        }
        offset += line.len();
    }

    // No closing fence: it was never front matter, so leave the text alone.
    (markdown, None)
}

/// GFM: tables, task lists, strikethrough, footnotes, autolinks — matching what
/// the editor highlights, so export holds no surprises.
pub fn markdown_to_html(markdown: &str, title: &str) -> String {
    let (body_md, front_title) = split_front_matter(markdown);
    // A `title:` in the front matter is the author's own name for the document,
    // so it beats the filename we were handed.
    let title = front_title.as_deref().unwrap_or(title);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let mut body = String::with_capacity(body_md.len() * 3 / 2);
    html::push_html(&mut body, Parser::new_ext(body_md, options));

    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{}</title>\n<style>{}</style>\n</head>\n<body>\n{}</body>\n</html>\n",
        escape(title),
        STYLE,
        body
    )
}

/// Renders without writing, for the print preview path.
#[tauri::command]
pub fn render_html(markdown: String, title: String) -> Result<String> {
    Ok(markdown_to_html(&markdown, &title))
}

#[tauri::command]
pub fn export_html(markdown: String, title: String, path: String) -> Result<String> {
    std::fs::write(&path, markdown_to_html(&markdown, &title))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_features() {
        let md = "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~\n";
        let out = markdown_to_html(md, "T");
        assert!(out.contains("<h1"), "heading");
        assert!(out.contains("<table>"), "table");
        assert!(out.contains("type=\"checkbox\""), "task list");
        assert!(out.contains("<del>"), "strikethrough");
    }

    #[test]
    fn is_self_contained() {
        let out = markdown_to_html("# Hi", "T");
        assert!(out.contains("<style>"), "styles inlined");
        // No external fetches: the file must render offline, anywhere.
        assert!(!out.contains("<link"), "no external stylesheet");
        assert!(!out.contains("<script"), "no scripts");
        assert!(!out.contains("http://"), "no external http references");
    }

    #[test]
    fn escapes_the_title() {
        let out = markdown_to_html("x", "<script>alert(1)</script>");
        assert!(!out.contains("<title><script>"), "title must not inject markup");
        assert!(out.contains("&lt;script&gt;"));
    }

    #[test]
    fn handles_empty_input() {
        let out = markdown_to_html("", "Empty");
        assert!(out.contains("<body>"));
    }

    /// CommonMark reads `title: X` followed by `---` as a setext heading, so
    /// unstripped front matter renders as a visible heading in the export.
    #[test]
    fn strips_front_matter_from_output() {
        let md = "---\ntitle: Sample\nstatus: draft\n---\n\n# Real heading\n\nBody.\n";
        let out = markdown_to_html(md, "fallback");
        assert!(!out.contains("status: draft"), "front matter leaked into the body");
        assert!(!out.contains(">title: Sample<"), "front matter rendered as a heading");
        assert!(out.contains("Real heading"), "actual content survived");
    }

    #[test]
    fn front_matter_title_beats_the_filename() {
        let out = markdown_to_html("---\ntitle: From Front Matter\n---\n\nBody\n", "filename");
        assert!(out.contains("<title>From Front Matter</title>"));
    }

    #[test]
    fn quoted_front_matter_title_is_unquoted() {
        let out = markdown_to_html("---\ntitle: \"Quoted\"\n---\n\nx\n", "fallback");
        assert!(out.contains("<title>Quoted</title>"), "got: {out}");
    }

    #[test]
    fn falls_back_when_front_matter_has_no_title() {
        let out = markdown_to_html("---\nstatus: draft\n---\n\nx\n", "filename");
        assert!(out.contains("<title>filename</title>"));
    }

    #[test]
    fn an_unclosed_fence_is_not_front_matter() {
        // A document that merely opens with a rule must not lose its content.
        let md = "---\n\n# Heading after a rule\n\nBody.\n";
        let out = markdown_to_html(md, "t");
        assert!(out.contains("Heading after a rule"));
        assert!(out.contains("Body."));
    }

    #[test]
    fn a_leading_rule_alone_is_preserved() {
        let out = markdown_to_html("---\n\ntext\n", "t");
        assert!(out.contains("text"));
    }

    #[test]
    fn crlf_front_matter_is_stripped() {
        let out = markdown_to_html("---\r\ntitle: CRLF\r\n---\r\n\r\n# Body\r\n", "f");
        assert!(!out.contains("title: CRLF"), "got: {out}");
        assert!(out.contains("<title>CRLF</title>"));
    }

    /// Writes a real export so it can be opened in a browser and looked at.
    /// Run explicitly: `cargo test write_sample_export -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn write_sample_export() {
        let md = r#"---
title: Sample
---

# Export sample

A **minimalist**, *lightning-fast* editor. Here is `inline code`, a
[link](https://example.com) and some ~~struck text~~.

## Lists

- plain bullet
- [x] a finished task
- [ ] an unfinished one

1. first
2. second

> A blockquote, for the left bar and the muted colour.

## Code

```rust
fn save(p: &Path) -> Result<()> {
    let tmp = temp_beside(p)?;
    ReplaceFileW(p, &tmp)
}
```

## Table

| Metric        | Budget  | Measured |
| ------------- | ------- | -------- |
| Cold start    | 400 ms  | 220 ms   |
| Keystroke     | 4 ms    | 0.90 ms  |

---

Final paragraph after a rule.
"#;
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("sample-export.html");
        std::fs::write(&out, markdown_to_html(md, "Export sample")).unwrap();
        println!("wrote {}", out.display());
    }
}
