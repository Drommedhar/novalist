# Novalist for Obsidian

<img src="images/novalist.png" alt="Novalist Logo" width="400"/>

A comprehensive novel writing environment for Obsidian. Novalist turns your vault into a full-featured writing workspace with structured character and location management, an interactive relationship map, a plot board, inline annotations, real-time statistics, and multi-format export — all without leaving Obsidian.

## Getting Started

On first launch Novalist opens a **Startup Wizard** that walks you through project setup. Pick a project folder name, choose your preferred dialogue language (for smart-quote auto-replacement), and Novalist creates the folder structure for you: `Characters/`, `Locations/`, `Chapters/`, `Images/`, and `Templates/` with ready-to-use template files.

You can re-run the wizard at any time from the command palette with **Novalist: Initialize novel project structure**.

## Features

### Toolbar

An always-visible toolbar is injected into every editor tab header. It provides one-click access to all major actions:

- **Create group** — Add Character, Add Location, Add Chapter
- **Views group** — Explorer, Context Sidebar, Character Map, Plot Board, Export
- **Chapter status dropdown** — Visible on chapter files. Change between Outline (○), First Draft (◔), Revised (◑), Edited (◕), and Final (●). The status is stored in the chapter's frontmatter and reflected in the explorer.

### Project Explorer

A specialized file explorer in the left panel with three tabs:

- **Chapters** — Listed in order. Drag and drop to reorder (updates frontmatter automatically). Status icons indicate progress. Right-click to delete.
- **Characters** — Grouped by role with collapsible sections. Drag characters between groups to reassign roles. Multi-select with Ctrl/Shift+click. Gender badges shown with configurable colors.
- **Locations** — A simple navigable list. Click to open, right-click to delete.

Clicking any character or location opens it in its dedicated Sheet View.

### Character Sheet View

A structured form editor that replaces the raw Markdown view for character files. Fields include:

- **Basic info** — Name, surname, gender, age, role
- **Physical attributes** — Eye color, hair color/length, height, build, skin tone, distinguishing features
- **Images** — Named image slots with drag-and-drop upload, an image browser, and thumbnail previews. Duplicates are detected via SHA-256 hashing.
- **Relationships** — Character links with role labels. An inline suggester helps you pick characters, and the plugin automatically prompts you to define the inverse relationship on the target character.
- **Custom properties** — Arbitrary key-value pairs you can add and remove freely
- **Free-form sections** — User-defined Markdown sections (e.g. Backstory, Notes)
- **Chapter overrides** — Select a chapter and override any field for that point in the story, letting you track how a character changes over time

Renaming a character in the sheet automatically renames the underlying file. A **Save** button writes changes, and **Edit Source** switches to the raw Markdown.

### Location Sheet View

A structured form editor for location files with fields for name, type, description, custom properties, images, and free-form sections. Works the same way as the character sheet.

### Context Sidebar

A right-panel view that updates automatically when you open a chapter file. It scans the chapter text for mentions of your characters and locations, then displays cards with key details at a glance — role, gender, age, relationships, chapter-specific info, and location descriptions. When the plot board has data for the current chapter, the sidebar also shows filled plot board columns inline. Accessible via the toolbar, ribbon icon, or command palette.

### Character Map

An interactive graph visualization of character relationships powered by Cytoscape.js. Characters are sized and colored by role. Shared surnames are grouped into family clusters. Mutual relationships (e.g. three siblings) are collapsed into shared hub nodes to reduce visual clutter. Edges show labeled roles, and multiple relationships between the same pair are merged into a single edge. Click a node to open that character's file. Pan, zoom, and drag to rearrange.

### Plot Board

A spreadsheet-style planning tool with your chapters as rows and user-defined columns. Use it to outline plot threads, themes, arcs, or any per-chapter metadata. Add, rename, reorder, and delete columns. Click a cell to edit, Ctrl/Cmd+Enter to commit. Chapter names link directly to the chapter file.

### Export

Export selected chapters to **EPUB**, **DOCX**, or **Markdown**. Configure a title, author, and whether to include a title page. Select individual chapters or use Select All / Select None. Exported chapters have frontmatter stripped, wikilinks converted to plain text, and are sorted by order.

### Smart Quotes & Auto-Replacement

Novalist replaces typed characters with language-appropriate typographic equivalents as you write. Eleven language presets are built in (German guillemets, German low-high, English curly, French, Spanish, Italian, Portuguese, Russian, Polish, Czech, Slovak) plus a fully customizable mode. Common replacements like `--` → em dash and `...` → ellipsis are included in every preset. The system is frontmatter-aware and handles Obsidian's auto-paired quotes correctly.

### Inline Annotations

A Google Docs-style commenting system. Select text in the editor, click the "+" tooltip that appears, and create a comment thread. Annotated ranges are highlighted with a rotating color palette. Comment cards appear in a right-side gutter aligned with the annotated text. Threads support multiple messages, can be resolved and reopened, and positions update automatically as you edit.

### Focus Peek

Hover your cursor over a character or location name in the editor and an inline card appears after a short delay showing the entity's details — portrait, attributes, relationships, and more. Pin the card to keep it visible while you write. Click character links inside a peek to navigate between entities with breadcrumb back-navigation. The card is resizable, and the size is remembered.

### Statistics Panel

A persistent bottom bar on every chapter editor showing real-time writing metrics:

- **File stats** — Word count, character count, reading time, readability score with a color-coded level badge
- **Project overview** — Total words, chapter/character/location counts, average words per chapter. Click to expand a per-chapter breakdown with word-count bar charts and readability badges.
- **Goal progress** — Daily and project word goal progress bars with percentages

Readability scoring supports multiple languages with language-specific syllable counting and uses Flesch-Kincaid or equivalent formulas.

### Entity Linkification

In reading/preview mode, character and location names are automatically rendered as styled, clickable links. The entity index updates as your vault changes.

### Daily Word Tracking

Novalist tracks how many words you write each day against a configurable daily goal. A baseline snapshot is taken at the start of each day and a 30-day rolling history is maintained.

### Automatic Image Organization

When you paste or drop an image into a project file, Novalist automatically moves it to your configured `Images/` folder, handling name collisions and preserving link integrity.

### Book Paragraph Spacing

A toggle in settings that adds printed-book-style spacing between paragraphs in edit mode.

## Settings

| Setting | Description | Default |
|---|---|---|
| Project path | Root vault folder for the novel project | `NovelProject` |
| Character folder | Subfolder name for characters | `Characters` |
| Location folder | Subfolder name for locations | `Locations` |
| Chapter folder | Subfolder name for chapters | `Chapters` |
| Image folder | Subfolder name for images | `Images` |
| Language | Auto-replacement language preset | `de-low` |
| Auto-replacements | Editable token → replacement pairs (in Custom mode) | Language-dependent |
| Book paragraph spacing | Toggle book-style paragraph gaps in edit mode | Off |
| Enable annotations | Toggle the inline comment system | On |
| Daily word goal | Target words per day | 1000 |
| Project word goal | Target total word count | 50000 |
| Role colors | Color picker per character role | Auto-discovered |
| Gender colors | Color picker per gender value | Auto-discovered |

## Commands

| Command | Description |
|---|---|
| Initialize novel project structure | Create or recreate the project folder tree |
| Open context sidebar | Open the chapter context panel |
| Open custom explorer | Open the project explorer |
| Open character map | Open the relationship graph |
| Open plot board | Open the plot planning board |
| Export novel | Open the export view |
| Open character sheet view | View the active character file as a form |
| Open location sheet view | View the active location file as a form |
| Add new character | Create a new character file |
| Add new location | Create a new location file |
| Add new chapter | Create a new chapter file |

## Internationalization

Novalist ships with **English** and **German** UI translations. The active locale is set automatically based on your Obsidian language setting.

## Support Development

If you find Novalist helpful in your writing journey, consider supporting its development:

[<img src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif" alt="Donate with PayPal" />](https://www.paypal.com/donate/?hosted_button_id=EQJG5JHAKYU4S)

---

*Write your story, better.*
