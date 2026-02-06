import {
  EditorSuggest,
  EditorPosition,
  Editor,
  TFile,
  EditorSuggestTriggerInfo,
  EditorSuggestContext
} from 'obsidian';
import type NovalistPlugin from '../main';

export class RelationshipKeySuggester extends EditorSuggest<string> {
  plugin: NovalistPlugin;

  constructor(plugin: NovalistPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    // Trigger if we are in a bullet point that looks like open metadata: "- **Key"
    const match = line.match(/^(\s*[-*]\s*\*\*)([^*]*)$/);
    if (!match) return null;

    const prefix = match[1];
    const query = match[2];

    return {
      start: { line: cursor.line, ch: prefix.length },
      end: cursor,
      query: query
    };
  }

  getSuggestions(context: EditorSuggestContext): string[] {
    const query = context.query.toLowerCase();
    return Array.from(this.plugin.knownRelationshipKeys)
       .filter(key => key.toLowerCase().includes(query))
       .sort((a,b) => a.localeCompare(b));
  }

  renderSuggestion(key: string, el: HTMLElement): void {
    el.createEl("div", { text: key });
  }

  selectSuggestion(key: string, _: MouseEvent | KeyboardEvent): void {
     if (!this.context) return;
     const editor = this.context.editor;
     const completion = `${key}**: `;
     const range = { start: this.context.start, end: this.context.end };
     editor.replaceRange(completion, range.start, range.end);
     // Move cursor to end
     const newCursor = { 
         line: range.start.line, 
         ch: range.start.ch + completion.length 
     };
     editor.setCursor(newCursor);
  }
}
