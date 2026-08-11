import { LanguageDescription } from '@codemirror/language'

/**
 * The grammars Inkpen ships, and nothing more.
 *
 * These exist to highlight fenced code inside Markdown, so the bar for keeping
 * one is "someone will paste this into a code fence". `@codemirror/language-data`
 * offers about 130; importing it pulled in every one of them, because Vite emits
 * a chunk for each `import()` in that module's body whether or not the list is
 * filtered afterwards. Declaring the wanted ones by hand is the only way to
 * leave the rest out of the build — it cut roughly a third of the payload.
 *
 * Adding one back is deliberately easy: copy an entry, name the package.
 */
export const languages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx', 'node'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py', 'pyw', 'pyi'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rs'],
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: 'Go',
    alias: ['golang'],
    extensions: ['go'],
    load: () => import('@codemirror/lang-go').then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['c', 'cpp', 'c++', 'h', 'hpp'],
    extensions: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'Java',
    extensions: ['java'],
    load: () => import('@codemirror/lang-java').then((m) => m.java()),
  }),
  LanguageDescription.of({
    name: 'C#',
    alias: ['csharp', 'cs'],
    extensions: ['cs'],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { csharp }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/clike'),
      ])
      return new LanguageSupport(StreamLanguage.define(csharp))
    },
  }),
  LanguageDescription.of({
    name: 'PHP',
    extensions: ['php'],
    load: () => import('@codemirror/lang-php').then((m) => m.php()),
  }),
  LanguageDescription.of({
    name: 'SQL',
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh', 'console'],
    extensions: ['sh', 'bash', 'zsh'],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { shell }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/shell'),
      ])
      return new LanguageSupport(StreamLanguage.define(shell))
    },
  }),
  LanguageDescription.of({
    name: 'PowerShell',
    alias: ['ps1', 'pwsh'],
    extensions: ['ps1', 'psm1', 'psd1'],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { powerShell }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/powershell'),
      ])
      return new LanguageSupport(StreamLanguage.define(powerShell))
    },
  }),
  LanguageDescription.of({
    name: 'JSON',
    extensions: ['json', 'jsonc', 'map'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: 'TOML',
    extensions: ['toml'],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { toml }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/toml'),
      ])
      return new LanguageSupport(StreamLanguage.define(toml))
    },
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'XML',
    alias: ['svg', 'xhtml'],
    extensions: ['xml', 'svg', 'xsl', 'xsd'],
    load: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  }),
]
