<p align="center">
  <img width="128" align="center" src="docs/assets/icon.png">
</p>
<h1 align="center">
  NotepadE
</h1>
<p align="center">
  A modern, lightweight, cross-platform text editor with a minimalist design.
</p>
<p align="center">
  <a style="text-decoration:none" href="https://github.com/Hoshino-Yumetsuki/NotepadE/releases">
    <img src="https://img.shields.io/github/release/Hoshino-Yumetsuki/NotepadE.svg?label=latest%20version&style=flat-square" alt="Releases" />
  </a>
  <a style="text-decoration:none">
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-yellow.svg?style=flat-square" alt="Platform" />
  </a>
  <a style="text-decoration:none">
    <img src="https://img.shields.io/badge/built%20with-Electron%20%2B%20React%20%2B%20Fluent%20UI-blue.svg?style=flat-square" alt="Stack" />
  </a>
</p>

## What is NotepadE and why do I care?

[Notepads](https://github.com/0x7c13/Notepads) is a wonderful modern notepad app, but it is a UWP application and only runs on Windows. NotepadE is a faithful, 1:1 rewrite of Notepads on top of web technology, so the same clean look and feel can run anywhere Electron does: Windows, macOS, and Linux.

The goal is simple: keep everything that made Notepads pleasant to use — the Fluent design, the built-in tab system, the blazingly fast feel — while making it cross-platform and easy to extend. If you liked Notepads but wished it ran on your Mac or your Linux box, this is for you.

* Fluent design with a built-in tab system.
* Lightweight and quick to launch.
* Multi-tab editing with drag-to-reorder.
* Built-in Markdown live preview (with a rich plugin set).
* Built-in diff viewer (preview your changes side by side).
* Line numbers, current-line highlight, and word wrap.
* Find & replace with a top-right search panel.
* Light, dark, and high-contrast themes.

![Screenshot Dark](docs/screenshots/dark.png?raw=true "Dark")
![Screenshot Markdown](docs/screenshots/markdown.png?raw=true "Markdown")
![Screenshot DiffViewer](docs/screenshots/diff.png?raw=true "DiffViewer")
![Screenshot Light](docs/screenshots/light.png?raw=true "Light")

## Shortcuts:

* Ctrl+N/T to create a new tab.
* Ctrl+(Shift)+Tab to switch between tabs.
* Ctrl+Num(1-9) to quickly switch to a specified tab.
* Ctrl+"+"/"-" for zooming. Ctrl+"0" to reset zooming to default.
* Ctrl+L/R to change text flow direction. (LTR/RTL)
* Ctrl+D to duplicate the current line or selection.
* Ctrl+J to join the selected lines.
* Ctrl+E to web-search the selection.
* Alt+Z to toggle word wrap.
* Alt+Up/Down to move the current line up or down.
* F5 to insert the current date and time.
* Alt+P to toggle Markdown preview split view.
* Alt+D to toggle the side-by-side diff viewer.

## Markdown preview:

The Markdown preview (Alt+P on a `.md` file) is powered by [markdown-it](https://github.com/markdown-it/markdown-it) and a curated set of plugins from the [mdit-plugins](https://mdit-plugins.github.io/) collection, so notes render the way you expect:

* Task lists, footnotes, definition lists, and admonition/alert blocks.
* Subscript, superscript, `==marks==`, `++inserts++`, and spoilers.
* Abbreviations, emoji shortcodes, figures with captions, and custom containers.
* Raw HTML rendering, sanitized with [DOMPurify](https://github.com/cure53/DOMPurify) before it ever hits the DOM.
* Remote images, fetched only after the URL and content type pass a safety check.

The preview scrolls in lock-step with the editor, so the rendered output always tracks the text you are editing.

## Building from source:

NotepadE is built with Electron, React, Fluent UI v9, TypeScript, CodeMirror 6, and Vite. You will need Node.js 20+ and [Yarn](https://yarnpkg.com/) 4.

```bash
# Install dependencies
yarn install

# Run the app in development
yarn dev

# Type-check, lint, and test
yarn typecheck
yarn lint
yarn test

# Build a distributable for the current platform
yarn dist
```

## Platform notes:

* NotepadE runs on Windows, macOS, and Linux via Electron.
* Some platform-specific niceties (jump lists, file associations) depend on the host OS and the packaged build.
* Very large files may affect responsiveness; the editor is tuned for everyday note-taking and config editing.

## Changelog:

* [NotepadE Releases](https://github.com/Hoshino-Yumetsuki/NotepadE/releases)

## Privacy statement:

To be 100% transparent:

* NotepadE does not and will never collect your personal information.
* It does not track your IP.
* It does not record your typings or read any of your files, including file names and file paths.
* No typings or files are sent to the authors or any third party.

NotepadE is 100% open source. Feel free to review the source code or build your own version.

## Acknowledgments:

* [0x7c13/Notepads](https://github.com/0x7c13/Notepads) — the original UWP app this project is a rewrite of, and the source of its design language.

## Dependencies and References:

* [Electron](https://www.electronjs.org/)
* [React](https://react.dev/)
* [Fluent UI](https://github.com/microsoft/fluentui)
* [CodeMirror 6](https://codemirror.net/)
* [markdown-it](https://github.com/markdown-it/markdown-it)
* [mdit-plugins](https://github.com/mdit-plugins/mdit-plugins)
* [DOMPurify](https://github.com/cure53/DOMPurify)
* [Vite](https://vite.dev/)
