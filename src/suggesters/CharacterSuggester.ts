import {
  EditorSuggest,
  EditorPosition,
  Editor,
  TFile,
  EditorSuggestTriggerInfo,
  EditorSuggestContext,
  Notice
} from 'obsidian';
import type NovalistPlugin from '../main';
import { InverseRelationshipModal } from '../modals/InverseRelationshipModal';

export class CharacterSuggester extends EditorSuggest<TFile> {
  plugin: NovalistPlugin;

  constructor(plugin: NovalistPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    // Trigger if we are in a bullet point that looks like metadata: "- **Key**: Value" or "- **Key:** Value"
    const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)(.*)$/);
    if (!match) return null;

    const prefix = match[1];
    let key = match[2];
    const colonOutside = match[3];
    const valueStr = match[4];

    // Check for colon presence either inside or outside
    if (!colonOutside && !key.trim().endsWith(':')) return null;

    // Clean key (remove trailing colon if inside)
    if (key.trim().endsWith(':')) key = key.trim().slice(0, -1);

    // Check if cursor is in the value part
    if (cursor.ch < prefix.length) return null;

    const subCursor = cursor.ch - prefix.length;
    const valueBeforeCursor = valueStr.substring(0, subCursor);
    const lastComma = valueBeforeCursor.lastIndexOf(',');
    
    const query = lastComma === -1 ? valueBeforeCursor.trim() : valueBeforeCursor.substring(lastComma + 1).trim();

    let extraOffset = 0;
    if (lastComma !== -1) {
        const afterComma = valueBeforeCursor.substring(lastComma + 1);
        const leadingSpaceMatch = afterComma.match(/^\s*/);
        extraOffset = (lastComma + 1) + (leadingSpaceMatch ? leadingSpaceMatch[0].length : 0);
    }

    return {
      start: { line: cursor.line, ch: prefix.length + extraOffset },
      end: cursor,
      query: query
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<TFile[]> {
    const chars = await this.plugin.getCharacterList();
    const query = context.query.toLowerCase().replace(/^\[\[/, '');
    const activeFile = this.plugin.app.workspace.getActiveFile();
    
    return chars
      .map(c => c.file)
      .filter(f => {
         if (activeFile && f.path === activeFile.path) return false;
         return f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query);
      });
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl("div", { text: file.basename });
  }

  selectSuggestion(file: TFile, _: MouseEvent | KeyboardEvent): void {
     if (!this.context) return;
     const editor = this.context.editor;
     const range = { start: this.context.start, end: this.context.end };
     
     // Insert the wikilink
     const link = `[[${file.basename}]]`;
     editor.replaceRange(link, range.start, range.end);
     const newCursor = { line: range.start.line, ch: range.start.ch + link.length };
     editor.setCursor(newCursor);
     
     // Trigger reciprocal update
     const activeFile = this.plugin.app.workspace.getActiveFile();
     
     // Re-extract key from line
     const lineNum = this.context.start.line;
     const line = editor.getLine(lineNum);
     const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)/);
     
     let key = '';
     if (match) {
        key = match[2];
        if (key.trim().endsWith(':')) key = key.trim().slice(0, -1);
     }
     
     if (activeFile && key) {
         void (async () => {
             // Attempt to deduce inverse key from siblings
             let deducedKey: string | null = null;
             
             // Extract all wikilinks from the line
             const linkRegex = /\[\[(.*?)\]\]/g;
             let linkMatch: RegExpExecArray | null;
             while ((linkMatch = linkRegex.exec(line)) !== null) {
                 if (!linkMatch[1]) continue;
                 const rawName = linkMatch[1];
                 const name = rawName.split('|')[0]; // Handle aliases if any
                 if (name === file.basename) continue; // Skip the one we just added

                 // Find the file for this name
                 const siblingFile = this.plugin.app.metadataCache.getFirstLinkpathDest(name, activeFile.path);
                 if (siblingFile && siblingFile instanceof TFile) {
                      // Check sibling file for reference to activeFile
                      const content = await this.plugin.app.vault.read(siblingFile);
                      // Look for: - **Role**: ... [[ActiveFile]] ...
                      const escapeName = activeFile.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      // Matches: - **KEY**: [[Active]] or - **KEY**: [[Other]], [[Active]]
                      const siblingRegex = new RegExp(`^\\s*[-*]\\s*\\*\\*(.+?)\\*\\*[:]?:.*?\\[\\[${escapeName}(?:\\|.*?)?\\]\\]`, 'm');
                      const siblingMatch = content.match(siblingRegex);
                      if (siblingMatch) {
                          deducedKey = siblingMatch[1].trim();
                          // Cleanup trailing colon if captured
                          if (deducedKey.endsWith(':')) deducedKey = deducedKey.slice(0, -1).trim();
                          break; 
                      }
                 }
             }

             if (deducedKey) {
                 new Notice(`Auto-linked relationship as "${deducedKey}" based on existing siblings.`);
                 void this.plugin.addRelationshipToFile(file, deducedKey, activeFile.basename);
             } else {
                 new InverseRelationshipModal(
                     this.plugin.app, 
                     this.plugin, 
                     activeFile, 
                     file, 
                     key, 
                     (inverseKey) => {
                         void this.plugin.addRelationshipToFile(file, inverseKey, activeFile.basename);
                         void this.plugin.learnRelationshipPair(key, inverseKey);
                     }
                 ).open();
             }
         })();
     }
  }
}
