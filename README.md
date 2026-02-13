# Novalist for Obsidian

<img src="images/novalist.png" alt="Novalist Logo" width="400"/>

A comprehensive novel writing environment for Obsidian. Novalist turns your vault into a full-featured writing workspace with structured character and location management, an interactive relationship map, a plot board, inline annotations, real-time statistics, multi-project support, a shared World Bible, and multi-format export — all without leaving Obsidian.

## Getting Started

On first launch Novalist opens a **Startup Wizard** that walks you through project setup. Pick a project folder name, choose your preferred dialogue language (for smart-quote auto-replacement), and Novalist creates the folder structure for you: `Characters/`, `Locations/`, `Chapters/`, and `Images/`.

You can re-run the wizard at any time from the command palette with **Novalist: Initialize novel project structure**. To manage multiple projects or configure a shared World Bible, open **Settings > Novalist > Projects**.

## Features

### Multi-Project Support

A single vault can hold multiple novel projects. Each project has its own folder with independent chapters, characters, locations, and images. Per-project data — plot board, annotations, word count goals, and relationship pairs — is stored separately and swapped automatically when you switch projects.

- **Add a project** from Settings > Projects or from the `Add project` button. Novalist creates the folder structure for the new project and switches to it.
- **Switch projects** via Settings > Projects dropdown, the command palette (`Switch project`), or the project switcher modal that lists all projects with a single click to switch.
- **Rename a project** from Settings or the command palette (`Rename active project`). The vault folder is renamed and all internal references (including annotation file paths) are updated.
- **Delete a project** from Settings. The project entry is removed from Novalist's data; the vault folder is left untouched so no files are lost.
- Existing single-project vaults are migrated automatically on first load — no manual action needed.

### World Bible

A World Bible is a shared folder whose characters, locations, and images are available to every project in the vault. Enabled by default with the folder name `WorldBible`. Useful for book series or shared-universe stories where multiple projects reference the same cast and setting.

- Configure the World Bible folder path in Settings > Projects > World Bible. Click `Initialize World Bible folders` to create the sub-folder structure.
- When creating a character or location, toggle `Add to World Bible` in the creation modal to place the entity in the shared folder instead of the current project.
- Right-click any character or location in the explorer to `Move to World Bible` or `Move to <project>` to relocate existing entities between the World Bible and any project.
- World Bible entities appear alongside project entities in the explorer, sidebar, character map, and focus peek. A `WB` badge in the explorer distinguishes shared entities from project-local ones.
- Entity scanning, mention detection, word counting, and file lookups all search both the active project and the World Bible folder.

### Toolbar

An always-visible toolbar is injected into every editor tab header. It provides one-click access to all major actions:

- **Create group** — Add Character, Add Location, Add Chapter
- **Views group** — Explorer, Context Sidebar, Character Map, Plot Board, Export
- **Chapter status dropdown** — Visible on chapter files. Change between Outline (○), First Draft (◔), Revised (◑), Edited (◕), and Final (●). The status is stored in the chapter's frontmatter and reflected in the explorer.

### Project Explorer

A specialized file explorer in the left panel with three tabs:

- **Chapters** — Listed in order, grouped by act when acts are defined. Drag and drop to reorder (updates frontmatter automatically). Status icons indicate progress. Scenes within each chapter are listed as nested sub-items. Right-click a chapter to add a scene, assign to an act, or delete. An `Add act` button lets you create new acts, and act headers support right-click to rename or delete.
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
- **Chapter overrides** — Select an act, chapter, and optionally a scene, then override any field for that point in the story. The override cascade is: scene > chapter > act > base data. Act-level overrides apply to all chapters within that act unless a more specific chapter or scene override exists.

Renaming a character in the sheet automatically renames the underlying file. A **Save** button writes changes, and **Edit Source** switches to the raw Markdown.

### Location Sheet View

A structured form editor for location files with fields for name, type, description, custom properties, images, and free-form sections. Works the same way as the character sheet.

### Entity Templates

Templates control the structure of new character and location files. Each template defines which fields, sections, images, relationships, and custom properties are included when an entity is created. A built-in `Default` template ships with all standard fields enabled.

- **Character templates** configure fields (gender, age, role, physical attributes, etc.), whether to include relationships, images, and chapter overrides, plus optional pre-populated custom properties and free-form sections.
- **Location templates** configure fields (type, description), images, custom properties, and sections.
- Create, duplicate, edit, and delete templates from **Settings > Character templates / Location templates**. Built-in templates can be edited but not deleted.
- Set an **active template** per entity type. The active template is pre-selected in the creation dialog. When multiple templates exist, a dropdown appears in the creation modal.
- A `TemplateId` is stored in each generated file. When opening a sheet, missing custom properties and sections from the associated template are automatically merged in, so template changes propagate to existing entities.

### Context Sidebar

A right-panel view that updates automatically when you open a chapter file. It scans the chapter text for mentions of your characters and locations, then displays cards with key details at a glance — role, gender, age, relationships, chapter-specific info, and location descriptions. Character data reflects the full override cascade (scene > chapter > act > base). When you are inside a scene (an `## heading` section), the sidebar shows the current scene name and applies the most specific matching override. When the plot board has data for the current chapter, the sidebar also shows filled plot board columns inline. Accessible via the toolbar, ribbon icon, or command palette.

### Character Map

An interactive graph visualization of character relationships powered by Cytoscape.js. Characters are sized and colored by role. Shared surnames are grouped into family clusters. Mutual relationships (e.g. three siblings) are collapsed into shared hub nodes to reduce visual clutter. Edges show labeled roles, and multiple relationships between the same pair are merged into a single edge. Click a node to open that character's file. Pan, zoom, and drag to rearrange.

### Plot Board

A visual story-mapping tool for outlining narrative structure, organizing scenes, and tracking plot threads. Two view modes are available:

- **Board view** (default) — a Kanban-style layout where acts serve as swim lanes and chapters appear as draggable cards. Drag-and-drop cards to reorder chapters within an act or move them between acts. Each card shows the chapter status icon, scene count, labels, and a notes preview. Act lanes are collapsible.
- **Table view** — the original spreadsheet layout with chapters as rows and user-defined columns. Scenes appear as indented sub-rows with their own editable cells. Click a cell to edit, `Ctrl/Cmd+Enter` to commit. Column names are renamable via double-click.

Both views share a header toolbar for toggling the view, managing labels, and adding note columns. Additional features:

- **Color-coding** — right-click a card to assign one of eight preset colors. A color stripe appears on the card (board) or row (table) for at-a-glance subplot identification.
- **Labels** — create named, color-coded labels (e.g. "Subplot A", "Foreshadowing") from the labels manager and assign any combination to a card via right-click. Label badges appear on cards and table rows.
- **Notes** — right-click a card in board view to open a notes editor overlay that lets you fill in all note columns (and per-scene notes) in one place. In table view, cells remain inline-editable.
- **Drag-and-drop** — in board view, drag chapter cards between act lanes to reassign their act and reorder them. Drop position is indicated by a highlight above or below existing cards.

### Export

Export selected chapters to **EPUB**, **DOCX**, or **Markdown**. Configure a title, author, and whether to include a title page. Select individual chapters or use Select All / Select None. Exported chapters have frontmatter stripped, wikilinks converted to plain text, and are sorted by order. Scene headings (`## heading`) within chapters are preserved and rendered as sub-headings in the output.

### Smart Quotes & Auto-Replacement

Novalist replaces typed characters with language-appropriate typographic equivalents as you write. Eleven language presets are built in (German guillemets, German low-high, English curly, French, Spanish, Italian, Portuguese, Russian, Polish, Czech, Slovak) plus a fully customizable mode. Common replacements like `--` → em dash and `...` → ellipsis are included in every preset. The system is frontmatter-aware and handles Obsidian's auto-paired quotes correctly.

### Inline Annotations

A Google Docs-style commenting system. Select text in the editor, click the "+" tooltip that appears, and create a comment thread. Annotated ranges are highlighted with a rotating color palette. Comment cards appear in a right-side gutter aligned with the annotated text. Threads support multiple messages, can be resolved and reopened, and positions update automatically as you edit.

### Focus Peek

Hover your cursor over a character or location name in the editor and an inline card appears after a short delay showing the entity's details — portrait, attributes, relationships, and more. Pin the card to keep it visible while you write. Click character links inside a peek to navigate between entities with breadcrumb back-navigation. The card is resizable, and the size is remembered. The peek card applies character overrides with the full cascade: scene > chapter > act > base data.

### Statistics Panel

A persistent bottom bar on every chapter editor showing real-time writing metrics:

- **File stats** — Word count, character count, reading time, readability score with a color-coded level badge
- **Project overview** — Total words, chapter/character/location counts, average words per chapter. Click to expand a per-chapter breakdown with word-count bar charts and readability badges. Chapters with scenes show per-scene word counts as indented sub-rows.
- **Goal progress** — Daily and project word goal progress bars with percentages

Readability scoring supports multiple languages with language-specific syllable counting and uses Flesch-Kincaid or equivalent formulas.

### Entity Linkification

In reading/preview mode, character and location names are automatically rendered as styled, clickable links. The entity index updates as your vault changes.

### Daily Word Tracking

Novalist tracks how many words you write each day against a configurable daily goal. A baseline snapshot is taken at the start of each day and a 30-day rolling history is maintained.

### Automatic Image Organization

When you paste or drop an image into a project file, Novalist automatically moves it to your configured `Images/` folder, handling name collisions and preserving link integrity.

### Acts

Acts are an optional grouping layer above chapters. Create an act from the explorer's `Add act` button, then right-click a chapter and use `Assign to act` to place it under that act. Chapters in the explorer are grouped under collapsible act headers, and unassigned chapters appear in a separate section. Acts are stored as frontmatter on chapter files and managed entirely through the explorer UI — no manual frontmatter editing required. Right-click an act header to rename or delete it. Drag chapters between act groups to reassign them. Character sheet overrides can target an act, applying to all chapters within it unless a more specific override exists.

### Scenes

Scenes are subsections within a chapter file, created as `## heading` (H2) Markdown headings. Use the command palette (`Add new scene`) or right-click a chapter in the explorer to add a new scene. Scene names appear in the explorer nested under their chapter, in the plot board as sub-rows, and in the statistics breakdown. Character sheet overrides can target a specific scene for fine-grained tracking of character changes. The full override cascade is: scene > chapter > act > base character data.

### Book Paragraph Spacing

A toggle in settings that adds printed-book-style spacing between paragraphs in edit mode.

## Settings

| Setting | Description | Default |
|---|---|---|
| Active project | Select which project to work on | First project |
| World Bible folder | Root folder for shared entities across projects | `WorldBible` |
| Project path | Root vault folder for the novel project | `NovelProject` |
| Character folder | Subfolder name for characters | `Characters` |
| Location folder | Subfolder name for locations | `Locations` |
| Chapter folder | Subfolder name for chapters | `Chapters` |
| Image folder | Subfolder name for images | `Images` |
| Character templates | Define which fields, sections, and options new character files include | One built-in `Default` template |
| Location templates | Define which fields, sections, and options new location files include | One built-in `Default` template |
| Active character template | Pre-selected template when creating a character | `Default` |
| Active location template | Pre-selected template when creating a location | `Default` |
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
| Add new scene | Add a scene heading to the current chapter |
| Switch project | Switch the active project |
| Rename active project | Rename the active project and its vault folder |

## Internationalization

Novalist ships with **English** and **German** UI translations. The active locale is set automatically based on your Obsidian language setting.

## Support Development

If you find Novalist helpful in your writing journey, consider supporting its development:

[<img src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif" alt="Donate with PayPal" />](https://www.paypal.com/donate/?hosted_button_id=EQJG5JHAKYU4S)

---

*Write your story, better.*
