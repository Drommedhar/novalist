# Novalist for Obsidian

<img src="images/novalist.png" alt="Novalist Logo" width="400"/>

A comprehensive novel writing environment for Obsidian. Novalist turns your vault into a full-featured writing workspace with structured character and location management, an interactive relationship map, a plot board, inline annotations, real-time statistics, multi-project support, a shared World Bible, and multi-format export — all without leaving Obsidian.

## Getting Started

On first launch Novalist opens a **Startup Wizard** that walks you through project setup. Pick a project folder name, choose your preferred dialogue language (for smart-quote auto-replacement), and Novalist creates the folder structure for you: `Characters/`, `Locations/`, `Items/`, `Lore/`, `Chapters/`, and `Images/`.

You can re-run the wizard at any time from the command palette with **Novalist: Initialize novel project structure**. To manage multiple projects or configure a shared World Bible, open **Settings > Novalist > Projects**.

## Features

### Multi-Project Support

A single vault can hold multiple novel projects. Each project has its own folder with independent chapters, characters, locations, items, lore, and images. Per-project data — plot board, annotations, word count goals, and relationship pairs — is stored separately and swapped automatically when you switch projects.

- **Add a project** from Settings > Projects or from the `Add project` button. Novalist creates the folder structure for the new project and switches to it.
- **Switch projects** via Settings > Projects dropdown, the command palette (`Switch project`), or the project switcher modal that lists all projects with a single click to switch.
- **Rename a project** from Settings or the command palette (`Rename active project`). The vault folder is renamed and all internal references (including annotation file paths) are updated.
- **Delete a project** from Settings. The project entry is removed from Novalist's data; the vault folder is left untouched so no files are lost.
- Existing single-project vaults are migrated automatically on first load — no manual action needed.

### World Bible

A World Bible is a shared folder whose characters, locations, items, lore, and images are available to every project in the vault. Enabled by default with the folder name `WorldBible`. Useful for book series or shared-universe stories where multiple projects reference the same cast and setting.

- Configure the World Bible folder path in Settings > Projects > World Bible. Click `Initialize World Bible folders` to create the sub-folder structure.
- When creating a character, location, item, or lore entry, toggle `Add to World Bible` in the creation modal to place the entity in the shared folder instead of the current project.
- Right-click any character or location in the explorer to `Move to World Bible` or `Move to <project>` to relocate existing entities between the World Bible and any project.
- World Bible entities appear alongside project entities in the explorer, sidebar, character map, and focus peek. A `WB` badge in the explorer distinguishes shared entities from project-local ones.
- Entity scanning, mention detection, word counting, and file lookups all search both the active project and the World Bible folder.

### Toolbar

An always-visible toolbar is injected into every editor tab header. It provides one-click access to all major actions:

- **Create group** — Add Character, Add Location, Add Item, Add Lore, Add Chapter
- **Views group** — Explorer, Context Sidebar, Character Map, Plot Board, Image Gallery, Export
- **Chapter status dropdown** — Visible on chapter files. Change between Outline (○), First Draft (◔), Revised (◑), Edited (◕), and Final (●). The status is stored in the chapter's frontmatter and reflected in the explorer.

### Project Explorer

A specialized file explorer in the left panel with five tabs:

- **Chapters** — Listed in order, grouped by act when acts are defined. Drag and drop to reorder (updates frontmatter automatically). Status icons indicate progress. Scenes within each chapter are listed as nested sub-items. Right-click a chapter to edit its metadata (name, order, status, act, date), add a scene, assign to an act, or delete. Right-click a scene to edit its name and date. An `Add act` button lets you create new acts, and act headers support right-click to rename or delete.
- **Characters** — Grouped by role with collapsible sections. Drag characters between groups to reassign roles. Multi-select with Ctrl/Shift+click. Gender badges shown with configurable colors. A property filter bar lets you search by any built-in or custom property (e.g. `Eye Color: Blue`, `Role: Protagonist`). Results update as you type.
- **Locations** — A simple navigable list. Click to open, right-click to delete. Supports the same property filter bar (e.g. `Type: Tavern`).
- **Items** — Lists all items/artifacts across the project and World Bible. Click to open in the Item Sheet View. Supports the property filter bar.
- **Lore** — Lists all lore/encyclopedia entries. Click to open in the Lore Sheet View. Supports the property filter bar.

Clicking any character, location, item, or lore entry opens it in its dedicated Sheet View.

### Character Sheet View

A structured form editor that replaces the raw Markdown view for character files. Fields include:

- **Basic info** — Name, surname, gender, age, role. The age field can optionally act as a birthdate picker (configurable per template) that automatically computes the character's age relative to the current chapter or scene date.
- **Physical attributes** — Eye color, hair color/length, height, build, skin tone, distinguishing features
- **Images** — Named image slots with drag-and-drop upload, an image browser, and thumbnail previews. Duplicates are detected via SHA-256 hashing.
- **Relationships** — Character links with role labels. An inline suggester helps you pick characters, and the plugin automatically prompts you to define the inverse relationship on the target character.
- **Custom properties** — Typed key-value pairs you can add and remove freely. Each property has a selectable data type: `Text`, `Integer`, `Boolean`, `Date` (ISO format), `Enum` (custom definable string options), or `Timespan` (a reference date whose interval to the current chapter or scene date is computed automatically). Types are defined in the entity template and the sheet view renders the appropriate input control (text field, number spinner, toggle, date picker, dropdown, or date picker with computed interval label).
- **Free-form sections** — User-defined Markdown sections (e.g. Backstory, Notes)
- **Chapter overrides** — Select an act, chapter, and optionally a scene, then override any field for that point in the story. The override cascade is: scene > chapter > act > base data. Act-level overrides apply to all chapters within that act unless a more specific chapter or scene override exists.

Renaming a character in the sheet automatically renames the underlying file. A **Save** button writes changes, and **Edit Source** switches to the raw Markdown.

### Location Sheet View

A structured form editor for location files with fields for name, type, description, custom properties, images, and free-form sections. Works the same way as the character sheet.

### Item Sheet View

A structured form editor for item/artifact files. Track significant objects — a family heirloom, a magical weapon, a key plot device — across your story. Fields include:

- **Basic info** — Name, type, description, origin
- **Custom properties** — Typed key-value pairs (same data types as characters: text, integer, boolean, date, enum, timespan)
- **Images** — Named image slots with drag-and-drop upload and thumbnail previews
- **Free-form sections** — User-defined Markdown sections (e.g. History, Powers, Notes)

Renaming an item in the sheet automatically renames the underlying file. Items mentioned in chapter text appear in the context sidebar with their type and description.

### Lore Sheet View

A structured form editor for lore/encyclopedia entries. Organize world-building knowledge — organizations, cultures, historical events, or any other reference material — in dedicated files. Fields include:

- **Basic info** — Name, category (Organization, Culture, History, Other), description
- **Custom properties** — Typed key-value pairs
- **Images** — Named image slots with drag-and-drop upload
- **Free-form sections** — User-defined Markdown sections

Lore entries mentioned in chapter text appear in the context sidebar with their category and description.

### Image Gallery

A central view for browsing all images in your project's `Images/` folder. Accessible from the toolbar, command palette, or ribbon. Features:

- **Grid mode** — Thumbnail cards with image name, copy-wikilink button, and open-file button
- **List mode** — Compact rows with small thumbnails, file name, path, and action buttons
- **Search** — Filter images by name as you type
- **Image count** — Displays total and filtered image counts
- Auto-refreshes when images are added, removed, or renamed in the vault

### Entity Templates

Templates control the structure of new character, location, item, and lore files. Each template defines which fields, sections, images, relationships, and custom properties are included when an entity is created. A built-in `Default` template ships with all standard fields enabled.

- **Character templates** configure fields (gender, age, role, physical attributes, etc.), whether to include relationships, images, and chapter overrides, plus optional typed custom property definitions and free-form sections. The age field can be set to `Number` (plain text) or `Date (Birthdate)` mode with a configurable interval unit (years, months, or days). Timespan properties include an interval unit setting that controls how the elapsed time is displayed.
- **Location templates** configure fields (type, description), images, typed custom properties, and sections.
- **Item templates** configure fields (type, description, origin), images, typed custom properties, and sections.
- **Lore templates** configure fields (category, description), images, typed custom properties, and sections.
- Create, duplicate, edit, and delete templates from **Settings > Character / Location / Item / Lore templates**. Built-in templates can be edited but not deleted.
- Set an **active template** per entity type. The active template is pre-selected in the creation dialog. When multiple templates exist, a dropdown appears in the creation modal.
- A `TemplateId` is stored in each generated file. When opening a sheet, missing custom properties and sections from the associated template are automatically merged in, so template changes propagate to existing entities.

### Context Sidebar

A right-panel view that updates automatically when you open a chapter file. It scans the chapter text for mentions of your characters, locations, items, and lore entries, then displays cards with key details at a glance — role, gender, age, relationships, chapter-specific info, location descriptions, item types, and lore categories. Character data reflects the full override cascade (scene > chapter > act > base). When you are inside a scene (an `## heading` section), the sidebar shows the current scene name and applies the most specific matching override. When the plot board has data for the current chapter, the sidebar also shows filled plot board columns inline. A **Mention Frequency** graph shows a heatmap of which chapters each character appears in, with a warning badge when a character has been absent for three or more consecutive chapters. Accessible via the toolbar, ribbon icon, or command palette.

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

Export selected chapters to **EPUB**, **DOCX**, **PDF**, or **Markdown**. Configure a title, author, and whether to include a title page. Select individual chapters or use Select All / Select None. Exported chapters have frontmatter stripped, wikilinks converted to plain text, and are sorted by order. Scene headings (`## heading`) within chapters are converted to scene-break separators in the output.

- **Standard Manuscript Format (SMF)** — available for DOCX and PDF. Enable the `Standard Manuscript Format` toggle to apply industry-standard submission formatting: 12 pt Courier / Courier New, double-spaced lines, 1-inch margins, and a running page header with surname / title / page number. The SMF title page places the author name top-left and a centered title block.
- **PDF export** — generates a self-contained PDF via pdf-lib with proper pagination, chapter headings, scene breaks, and inline bold/italic formatting. With SMF enabled, the output matches the conventions expected by literary agents and publishers.

### Smart Quotes & Auto-Replacement

Novalist replaces typed characters with language-appropriate typographic equivalents as you write. Eleven language presets are built in (German guillemets, German low-high, English curly, French, Spanish, Italian, Portuguese, Russian, Polish, Czech, Slovak) plus a fully customizable mode. Common replacements like `--` → em dash and `...` → ellipsis are included in every preset. The system is frontmatter-aware and handles Obsidian's auto-paired quotes correctly.

### Inline Annotations

A Google Docs-style commenting system. Select text in the editor, click the "+" tooltip that appears, and create a comment thread. Annotated ranges are highlighted with a rotating color palette. Comment cards appear in a right-side gutter aligned with the annotated text. Threads support multiple messages, can be resolved and reopened, and positions update automatically as you edit.

### Focus Peek

Hover your cursor over a character or location name in the editor and an inline card appears after a short delay showing the entity's details — portrait, attributes, relationships, and more. Pin the card to keep it visible while you write. Click character links inside a peek to navigate between entities with breadcrumb back-navigation. The card is resizable with a stable default size, remembers custom size, inherits the current editor font size, and keeps section content filling the available height as you resize. If needed, reset the saved card size from Settings. The peek card applies character overrides with the full cascade: scene > chapter > act > base data.

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

Chapters and scenes can each carry a date (stored in chapter frontmatter). When a timespan custom property is displayed in the character sheet, the interval between the property's reference date and the selected chapter or scene date is computed and shown automatically. Edit chapter or scene metadata — including dates — by right-clicking in the explorer.

### Book Paragraph Spacing

A toggle in settings that adds printed-book-style spacing between paragraphs in edit mode.

### Chapter Snapshots

Snapshot a chapter before a major rewrite and compare versions side-by-side.

- **Create a snapshot** from the command palette (`Snapshot chapter`) or by right-clicking a chapter in the explorer and selecting `Snapshot`. Enter a descriptive name (e.g. "Before restructuring") and the current chapter content is saved to the project's `Snapshots/` folder.
- **Snapshot all chapters** at once via the command palette (`Snapshot all chapters`) or the explorer context menu (`Snapshot All Chapters`). Enter a single name and a snapshot is created for every chapter in the project.
- **View snapshots** from the command palette (`View chapter snapshots`) or the explorer context menu (`View Snapshots`). The modal lists all snapshots for the chapter sorted by date, newest first.
- **Compare** a snapshot against the current chapter text in a side-by-side diff view with added, removed, and unchanged lines highlighted. A summary bar shows line counts.
- **Restore** a snapshot to replace the chapter body while preserving frontmatter.
- **Delete** snapshots you no longer need.

## Settings

| Setting | Description | Default |
|---|---|---|
| Active project | Select which project to work on | First project |
| Novalist root folder | Optional subfolder inside the vault where all projects and the World Bible are placed; leave empty to use the vault root | _(empty)_ |
| World Bible folder | Root folder for shared entities across projects | `WorldBible` |
| Project path | Root vault folder for the novel project | `NovelProject` |
| Focus Peek size | Button that clears stored Focus Peek dimensions and restores default card size on next open | Default card size |
| Auto-reveal Novalist Explorer | Automatically switch the left sidebar to the Novalist Explorer when opening a project file | On |
| Character folder | Subfolder name for characters | `Characters` |
| Location folder | Subfolder name for locations | `Locations` |
| Item folder | Subfolder name for items/artifacts | `Items` |
| Lore folder | Subfolder name for lore/encyclopedia entries | `Lore` |
| Chapter folder | Subfolder name for chapters | `Chapters` |
| Image folder | Subfolder name for images | `Images` |
| Character templates | Define which fields, sections, and options new character files include | One built-in `Default` template |
| Location templates | Define which fields, sections, and options new location files include | One built-in `Default` template |
| Item templates | Define which fields, sections, and options new item files include | One built-in `Default` template |
| Lore templates | Define which fields, sections, and options new lore files include | One built-in `Default` template |
| Active character template | Pre-selected template when creating a character | `Default` |
| Active location template | Pre-selected template when creating a location | `Default` |
| Active item template | Pre-selected template when creating an item | `Default` |
| Active lore template | Pre-selected template when creating a lore entry | `Default` |
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
| Open item sheet view | View the active item file as a form |
| Open lore sheet view | View the active lore file as a form |
| Open image gallery | Browse all project images |
| Add new character | Create a new character file |
| Add new location | Create a new location file |
| Add new item | Create a new item/artifact file |
| Add new lore entry | Create a new lore/encyclopedia file |
| Add new chapter | Create a new chapter file |
| Add new scene | Add a scene heading to the current chapter |
| Switch project | Switch the active project |
| Rename active project | Rename the active project and its vault folder |
| Snapshot chapter | Save a named snapshot of the current chapter |
| Snapshot all chapters | Save a named snapshot of every chapter at once |
| View chapter snapshots | List, compare, restore, or delete snapshots for the current chapter |

## Internationalization

Novalist ships with **English** and **German** UI translations. The active locale is set automatically based on your Obsidian language setting.

## Support Development

If you find Novalist helpful in your writing journey, consider supporting its development:

[<img src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif" alt="Donate with PayPal" />](https://www.paypal.com/donate/?hosted_button_id=EQJG5JHAKYU4S)

<a href="https://ko-fi.com/L3L81U8JW8" target="_blank">
  <img src="https://storage.ko-fi.com/cdn/kofi6.png?v=6" height="36" alt="Buy Me a Coffee at ko-fi.com">
</a>


**Quick note**: I’m a professional developer, but for Novalist I leaned heavily on LLMs. That may or may not align with your philosophy — either way, I appreciate you taking a look. I prefer to be transparent about how it was built.

---

*Write your story, better.*
