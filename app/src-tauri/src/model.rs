use serde::{Deserialize, Serialize};

/// Text encodings Inkpen detects and round-trips. Whatever a file arrives as, it
/// leaves as, unless the user explicitly changes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

impl Default for Encoding {
    fn default() -> Self {
        Encoding::Utf8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
}

impl Default for LineEnding {
    fn default() -> Self {
        LineEnding::Crlf
    }
}

impl LineEnding {
    /// What to actually write. `Mixed` normalises to CRLF on Windows rather than
    /// preserving the mess.
    pub fn sequence(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::Crlf | LineEnding::Mixed => "\r\n",
        }
    }
}

/// Everything the frontend needs to mount a document. `content` is always
/// LF-normalised — the editor never sees a carriage return.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpen {
    pub path: String,
    pub name: String,
    pub content: String,
    pub encoding: Encoding,
    pub line_ending: LineEnding,
    pub size: u64,
    pub mtime: i64,
    pub read_only: bool,
    pub fast_mode: bool,
    pub language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub name: String,
    pub mtime: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub mtime: i64,
    pub size: u64,
    pub read_only: bool,
}

/// Resolved from the file extension. Drives both syntax highlighting and whether
/// the Markdown decoration layer runs at all.
pub fn language_for(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "md" | "markdown" | "mdown" | "mkd" | "mdx" => "markdown",
        "json" | "jsonc" | "webmanifest" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "ini" | "cfg" | "conf" | "properties" | "editorconfig" => "ini",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" | "tsx" => "typescript",
        "rs" => "rust",
        "py" | "pyw" => "python",
        "html" | "htm" | "xhtml" => "html",
        "css" | "scss" | "less" => "css",
        "xml" | "svg" | "xaml" | "csproj" => "xml",
        "sh" | "bash" | "zsh" => "shell",
        "ps1" | "psm1" => "powershell",
        "sql" => "sql",
        _ => "text",
    }
    .to_string()
}
