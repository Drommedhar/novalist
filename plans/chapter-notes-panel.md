# Chapter Notes Panel — Implementation Plan

## Overview

A **left-side panel** in the CodeMirror editor that displays per-chapter and per-scene notes/outlines. Notes are anchored to their corresponding headings (`# Chapter` / `## Scene`) and scroll in sync with the document. Content supports Markdown rendering with inline editing.

---

## User-Facing Behavior

### Panel Layout

- Fixed-width panel (280 px) on the **left** side of the editor, mirroring the annotation panel's right-side architecture.
- One **chapter note card** anchored to the `# Chapter` heading.
- One **scene note card** per `## Scene` heading, each anchored to its heading.
- Cards scroll in sync with the editor via `translateY(-scrollTop)`, identical to the annotation panel.
- Overlapping cards are pushed down with an 8 px gap (same relayout algorithm as annotations).
- Cards are only rendered for chapter files; the panel hides itself for non-chapter files.

### Card Design

- Each card has:
  - A **header row**: icon (chapter = `book-open`, scene = `align-left`) + heading name (truncated).
  - A **body**: rendered Markdown (read mode) or a `<textarea>` (edit mode).
  - A **toolbar**: Edit / Save / Cancel buttons; a collapse/expand toggle.
- Empty cards show a subtle placeholder: *"Click to add notes…"*.
- Cards are collapsible individually; collapsed state is remembered per session (not persisted).

### Editing

- Click the card body or the edit button → switches to a `<textarea>` with the raw Markdown.
- Save (button or `Ctrl+Enter`) → re-renders Markdown, persists to plugin data.
- Cancel (button or `Escape`) → discards changes, returns to rendered view.
- Auto-save on blur (switching to another card or clicking outside).

### Toggle Visibility

- **Command**: `Novalist: Toggle chapter notes panel` (palette command).
- **Toolbar**: A toggle button in the **Views** panel of the ribbon toolbar (icon: `notebook-pen`).
- **Setting**: `enableChapterNotes` (boolean, default `true`). When disabled, the panel never renders regardless of toggle state.
- Toggle state is stored on the plugin instance (not persisted — panel defaults to visible on reload when enabled).

### Move Content to Notes

A destructive action that **extracts** all body content from the chapter file into the notes panel and leaves only the skeleton (frontmatter + headings).

**Trigger:**
- **Command**: `Novalist: Move chapter content to notes` (palette command, only active on chapter files).
- **Button**: A toolbar-style button in the chapter note card header (icon: `arrow-left-from-line`).

**Behavior:**

1. Parse the active chapter file into sections:
   - **Chapter section**: everything between `# Heading` and the first `## Scene` (excluding frontmatter).
   - **Scene sections**: everything between each `## Scene` heading and the next `##` heading (or EOF).
2. For each section, extract the **body text** (everything below the heading line itself).
3. **Overwrite** the corresponding note (`chapterNote` / `sceneNotes[sceneName]`) with the extracted body text.
4. **Rewrite** the chapter file to contain only:
   - The original frontmatter (unchanged).
   - `# Chapter Name` followed by a blank line.
   - `## Scene Name` for each scene, each followed by a blank line.
5. Persist the updated notes via `saveSettings()`.

**Safety:**
- Show a **confirmation modal** before executing: *"This will move all chapter content into notes and leave only headings. This cannot be undone. Continue?"*
- Recommend taking a **snapshot** first (the modal can include a "Create snapshot first" checkbox, checked by default, that auto-creates a snapshot before proceeding).

**Edge cases:**
- If notes already exist for this chapter, they are **overwritten** (the confirmation modal warns about this).
- Empty sections (heading with no body) produce an empty note string.
- Frontmatter is preserved exactly as-is.

### Move All Chapters to Notes

A bulk variant that applies the same extraction to **every chapter file** in the active project.

**Trigger:**
- **Command**: `Novalist: Move all chapter content to notes` (palette command).

**Behavior:**

1. Collect all chapter files in the project (same logic as `getChapterDescriptionsSync()`).
2. Show a **confirmation modal**: *"This will move content from all N chapters into notes and leave only headings. This cannot be undone."*
   - "Create snapshots before moving" checkbox (checked by default) — creates a snapshot for **each** chapter before extraction.
3. Iterate every chapter file:
   - Parse into sections (same logic as single-chapter move).
   - Extract body text into `chapterNotes[guid]`.
   - Rewrite the file to frontmatter + headings only.
4. Persist all updated notes in one `saveSettings()` call at the end.
5. Show a notice: *"Moved content from N chapters to notes."*

**Edge cases:**
- Chapters that already have notes are overwritten (warned in modal).
- Chapters with no body content (only headings) are silently skipped.
- If snapshot creation fails for a chapter, log a warning but continue with the remaining chapters.

---

## Data Model

### Storage: `ProjectData`

Notes are stored in `ProjectData` alongside `commentThreads`, `plotBoard`, etc.:

```typescript
// types/index.ts — add to ProjectData
export interface ChapterNotes {
  /** Key = chapter GUID */
  [chapterGuid: string]: ChapterNoteData;
}

export interface ChapterNoteData {
  /** Note for the chapter heading itself */
  chapterNote: string;
  /** Key = scene name (H2 text), Value = note markdown */
  sceneNotes: Record<string, string>;
}
```

Add to `ProjectData`:

```typescript
export interface ProjectData {
  // ... existing fields ...
  chapterNotes: ChapterNotes;
}
```

Add to `NovalistSettings` (hydrated working copy):

```typescript
export interface NovalistSettings {
  // ... existing fields ...
  chapterNotes: ChapterNotes;
  enableChapterNotes: boolean;
}
```

### Hydration / Flush

Follow the existing pattern in `hydrateActiveProjectData()` / `flushActiveProjectData()`:

```typescript
// hydrate
this.settings.chapterNotes = pd.chapterNotes ?? {};

// flush
chapterNotes: this.settings.chapterNotes,
```

### Migration

In `loadSettings()`, add migration guards:

```typescript
if (!settings.chapterNotes) settings.chapterNotes = {};
if (settings.enableChapterNotes === undefined) settings.enableChapterNotes = true;

// Per-project migration
for (const pd of Object.values(settings.projectData)) {
  if (!pd.chapterNotes) pd.chapterNotes = {};
}
```

### Scene Rename Handling

When a scene heading (`## Name`) is renamed in the editor, the key in `sceneNotes` becomes stale. Two options:

1. **Lazy match** (recommended for v1): On render, if a scene name has no matching key, show an empty card. Old keys remain until the user manually cleans up or a future "manage notes" UI is added.
2. **Active tracking** (future): Detect heading renames via `docChanged` diffs and migrate keys automatically.

---

## Implementation — Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `src/cm/chapterNotesExtension.ts` | CodeMirror 6 extension (ViewPlugin + Facet) |

### Modified Files

| File | Changes |
|------|---------|
| `src/types/index.ts` | Add `ChapterNotes`, `ChapterNoteData` interfaces; add fields to `ProjectData` and `NovalistSettings` |
| `src/settings/NovalistSettings.ts` | Add `enableChapterNotes` default; add `chapterNotes` to `createDefaultProjectData()` and `DEFAULT_SETTINGS` |
| `src/settings/NovalistSettingTab.ts` | Add toggle setting for `enableChapterNotes` |
| `src/main.ts` | Add `setupChapterNotes()`, register extension, add command, hydrate/flush, migration |
| `src/utils/toolbarUtils.ts` | Add toggle button in Views panel; add `notebook-pen` icon to `createLucideIcon` |
| `src/i18n/en.ts` | Add `chapterNotes.*` translation keys |
| `src/i18n/de.ts` | Add `chapterNotes.*` translation keys (German) |
| `styles.css` | Add `.novalist-chapter-notes-*` styles |
| `README.md` | Document the feature |

---

## CodeMirror Extension Architecture

### `src/cm/chapterNotesExtension.ts`

Follows the annotation extension pattern exactly:

```
┌─────────────────────────────────────────────────────┐
│  view.dom.parentElement                             │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │ .novalist-chapter│  │ .cm-editor              │  │
│  │ -notes-wrapper   │  │  ┌───────────────────┐  │  │
│  │                  │  │  │ .cm-scroller       │  │  │
│  │  [Chapter Card]  │  │  │  (padding-left:    │  │  │
│  │                  │  │  │   288px)            │  │  │
│  │  [Scene Card 1]  │  │  │                    │  │  │
│  │                  │  │  │  # Chapter Heading  │  │  │
│  │  [Scene Card 2]  │  │  │  ...content...      │  │  │
│  │                  │  │  │  ## Scene 1          │  │  │
│  │                  │  │  │  ...content...      │  │  │
│  │                  │  │  │  ## Scene 2          │  │  │
│  │                  │  │  └───────────────────┘  │  │
│  └──────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Callbacks Facet

```typescript
export interface ChapterNotesCallbacks {
  isChapterFile(): boolean;
  getChapterGuid(): string | null;
  getChapterNote(guid: string): string;
  getSceneNote(guid: string, sceneName: string): string;
  saveChapterNote(guid: string, note: string): void;
  saveSceneNote(guid: string, sceneName: string, note: string): void;
  moveContentToNotes(): void;
  isEnabled(): boolean;
  t(key: string): string;
  renderMarkdown(markdown: string, container: HTMLElement): void;
}
```

### Heading Detection

Reuse the same pattern as `chapterDateExtension.ts`:

```typescript
function getHeadings(doc: Text): { type: 'chapter' | 'scene'; name: string; pos: number }[] {
  const headings = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.lineAt(i); // by line number
    const text = line.text;
    if (/^#\s+/.test(text) && !/^##/.test(text)) {
      headings.push({ type: 'chapter', name: text.replace(/^#\s+/, '').trim(), pos: line.from });
    } else if (/^##\s+/.test(text) && !/^###/.test(text)) {
      headings.push({ type: 'scene', name: text.replace(/^##\s+/, '').trim(), pos: line.from });
    }
  }
  return headings;
}
```

### ViewPlugin Lifecycle

| Event | Action |
|-------|--------|
| `constructor` | Create wrapper div, attach to `view.dom.parentElement`, add scroll listener, initial render |
| `update(vu)` | If `docChanged` or `viewportChanged` → re-scan headings, re-render cards |
| `destroy` | Remove wrapper, remove scroll listener, remove padding class |

### Render Cycle

1. Scan headings from document.
2. For each heading, create/reuse a card element.
3. Position each card using `view.coordsAtPos(heading.pos)` → compute top offset.
4. Schedule relayout to resolve overlaps (same algo as annotation panel).
5. Render Markdown content into card body via `callbacks.renderMarkdown()`.

### Markdown Rendering

Use Obsidian's `MarkdownRenderer.render()` via a callback from the plugin. This gives us proper Obsidian-flavored Markdown rendering (including links, formatting, etc.) without reimplementing a parser.

---

## CSS

```css
/* Wrapper */
.novalist-chapter-notes-wrapper {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 280px;
  overflow: hidden;
  pointer-events: none;
  z-index: 50;
}

/* Container (scroll-synced) */
.novalist-chapter-notes-container {
  position: absolute;
  top: 0; right: 0;
  width: 100%;
  pointer-events: none;
  padding-left: 8px;
}

/* Push editor content right */
.novalist-has-chapter-notes .cm-scroller {
  padding-left: 288px !important;
}

/* Card */
.novalist-chapter-note-card {
  position: absolute;
  left: 8px;
  width: calc(100% - 16px);
  pointer-events: auto;
  /* styling: border, background, radius, shadow */
}

/* Responsive: shrink at narrow widths */
@media (max-width: 700px) { ... }
```

---

## i18n Keys

```typescript
// en.ts additions
'chapterNotes.chapterLabel': 'Chapter Notes',
'chapterNotes.sceneLabel': 'Scene Notes',
'chapterNotes.placeholder': 'Click to add notes…',
'chapterNotes.save': 'Save',
'chapterNotes.cancel': 'Cancel',
'chapterNotes.edit': 'Edit',
'chapterNotes.collapse': 'Collapse',
'chapterNotes.expand': 'Expand',
'cmd.toggleChapterNotes': 'Toggle chapter notes panel',
'cmd.moveContentToNotes': 'Move chapter content to notes',
'chapterNotes.moveToNotes': 'Move content to notes',
'chapterNotes.moveConfirmTitle': 'Move Content to Notes',
'chapterNotes.moveConfirmMessage': 'This will overwrite existing notes with the current chapter content and leave only headings in the file. This cannot be undone.',
'chapterNotes.moveSnapshotCheckbox': 'Create a snapshot before moving',
'chapterNotes.moveSuccess': 'Chapter content moved to notes.',
'cmd.moveAllContentToNotes': 'Move all chapter content to notes',
'chapterNotes.moveAllConfirmTitle': 'Move All Content to Notes',
'chapterNotes.moveAllConfirmMessage': 'This will move content from all {count} chapters into notes and leave only headings. This cannot be undone.',
'chapterNotes.moveAllSnapshotCheckbox': 'Create snapshots before moving',
'chapterNotes.moveAllSuccess': 'Moved content from {count} chapters to notes.',
'settings.enableChapterNotes': 'Enable chapter notes panel',
'settings.enableChapterNotesDesc': 'Show a notes/outline panel on the left side of the editor for chapter files.',
'toolbar.chapterNotes': 'Chapter Notes',
```

---

## Settings

| Setting | Key | Type | Default | Description |
|---------|-----|------|---------|-------------|
| Enable chapter notes panel | `enableChapterNotes` | `boolean` | `true` | Show a notes/outline panel on the left side of the editor for chapter files. |

---

## Commands

| Command | ID | Description |
|---------|----|-------------|
| Toggle chapter notes panel | `novalist:toggle-chapter-notes` | Show or hide the chapter notes panel in the editor. |
| Move chapter content to notes | `novalist:move-content-to-notes` | Extract body text from the active chapter into notes, leaving only headings. |
| Move all chapter content to notes | `novalist:move-all-content-to-notes` | Extract body text from every chapter in the project into notes, leaving only headings. |

---

## Toolbar

Add to the **Views** panel in `toolbarUtils.ts`:

```typescript
this.createRibbonButton(viewsContent, 'notebook-pen', t('toolbar.chapterNotes'),
  t('toolbar.chapterNotes'), () => plugin.toggleChapterNotes());
```

Add `notebook-pen` and `arrow-left-from-line` SVG paths to the `createLucideIcon` icon map.

---

## Implementation Order

1. **Types & settings** — Add interfaces, defaults, migration guards.
2. **CM extension** — Create `chapterNotesExtension.ts` with facet, plugin, heading detection, card rendering, scroll sync.
3. **Main plugin wiring** — `setupChapterNotes()`, register extension, add commands (toggle + move), hydrate/flush, `moveContentToNotes()` method with confirmation modal + optional snapshot.
4. **CSS** — Panel wrapper, container, cards, edit mode, responsive.
5. **Toolbar** — Add toggle button and icon.
6. **i18n** — English and German translations.
7. **Settings tab** — Add toggle in settings UI.
8. **README** — Document the feature.
9. **Verify** — Run `npm run verify`, fix all errors and warnings.

---

## Future Extensions

- **Drag-to-reorder scenes** within the notes panel (reorder H2 headings in the document).
- **Scene status indicators** (e.g., checkbox per scene to mark "done").
- **AI-generated outline suggestions** via the existing Ollama integration.
- **Outline templates** — pre-fill scene notes from a configurable template.
- **Scene rename tracking** — auto-migrate `sceneNotes` keys when headings change.
- **Export notes** — include chapter/scene notes in export output.
- **Resizable panel** — drag-to-resize the panel width.
- **Notes search** — search/filter across all chapter notes from the sidebar.
