import {
  EditorSuggest,
  EditorPosition,
  Editor,
  TFile,
  EditorSuggestTriggerInfo,
  EditorSuggestContext,
  TFolder
} from 'obsidian';
import type NovalistPlugin from '../main';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];

export class ImageSuggester extends EditorSuggest<TFile> {
  plugin: NovalistPlugin;

  constructor(plugin: NovalistPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    
    // Check if we are potentially in an image context
    // We check if the current line is part of the "Images" section
    // Optimization: Check current line first if it looks like an image entry
    // But user might just be typing in a blank line under the header.
    
    // Scan upwards to find header
    let inImageSection = false;
    for (let i = cursor.line; i >= 0; i--) {
        const txt = editor.getLine(i);
        if (txt.match(/^##\s+Images/i)) {
            inImageSection = true;
            break;
        }
        if (txt.match(/^##\s+/)) {
            // Found another header before Images
            return null;
        }
    }

    if (!inImageSection) return null;

    // Trigger behavior:
    // If text looks like a standard markdown image syntax `![[`, Obsidian handles it?
    // User asked "suggest the images... and on accept replace it with the correct image tag".
    // So we probably intervene before they type `![[`.
    
    // Let's trigger on any word char if we are in this section.
    // Or if we are after a key like "- **Main**: "
    
    // Extract query: current word being typed
    const sub = line.substring(0, cursor.ch);
    // Find last word boundary
    // If strict: match only after `**Key**: `?
    // Flexible: match last word.
    
    // If the user already typed `![[`, we should let Obsidian handle it OR handle it ourselves.
    // Let's handle generic typing.
    
    const match = sub.match(/(\S+)$/);
    let query = match ? match[1] : '';

    // If user starts typing standard obsidian link syntax, we strip it to find the file
    if (query.startsWith('![[')) query = query.slice(3);
    else if (query.startsWith('[[')) query = query.slice(2);

    // If perfectly empty line in Images section, maybe show all?
    // Only if after a bullet or colon for context?
    // Ex: "- **Main**: " -> show all
    if (!query) {
        if (sub.trim().endsWith(':')) {
             return {
                start: { line: cursor.line, ch: cursor.ch },
                end: cursor,
                query: ''
            };
        }
        // Also if we just stripped the query to empty (e.g. user matched "![[" which became "")
        if (match && (match[1] === '![[' || match[1] === '[[')) {
             return {
                start: { line: cursor.line, ch: cursor.ch - match[1].length },
                end: cursor,
                query: ''
            };
        }
        return null;
    }

    return {
      start: { line: cursor.line, ch: cursor.ch - (match ? match[1].length : 0) },
      end: cursor,
      query
    };
  }

  getSuggestions(context: EditorSuggestContext): TFile[] {
    const query = context.query.toLowerCase();
    const result: TFile[] = [];
    
    const rootPath = this.plugin.settings.projectPath;
    const imageFolder = this.plugin.settings.imageFolder;
    const fullFolderPath = `${rootPath}/${imageFolder}`;
    
    const folder = this.plugin.app.vault.getAbstractFileByPath(fullFolderPath);
    if (!folder || !(folder instanceof TFolder)) return [];

    // Recursive file collection
    const collectImages = (folder: TFolder) => {
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                collectImages(child);
            } else if (child instanceof TFile) {
                if (IMAGE_EXTENSIONS.includes(child.extension.toLowerCase())) {
                    if (!query || child.basename.toLowerCase().includes(query) || child.path.toLowerCase().includes(query)) {
                        result.push(child);
                    }
                }
            }
        }
    };

    collectImages(folder);
    return result;
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path, cls: 'novalist-suggestion-path' });
  }

  selectSuggestion(file: TFile, _: MouseEvent | KeyboardEvent): void {
     const context = this.context;
     if (!context) return;
     
     const editor = context.editor;
     // Insert: ![[Path/To/Image.png]]
     // We should use the relative path or best practice link format.
     // For typical Obsidian setups, `![[Filename]]` works if unique, else `![[Folder/Filename]]`
     // We can just use the path relative to vault root? Obsidian usually handles shorter links if unique.
     // But explicit path is safer.
     
     // However, standard wiki link: `![[filepath]]`
     // Or standard md: `![alt](filepath)`
     
     // User requirement: "replace it with the correct image tag"
     const tag = `![[${file.path}]]`;

     editor.replaceRange(tag, context.start, context.end);
  }
}
