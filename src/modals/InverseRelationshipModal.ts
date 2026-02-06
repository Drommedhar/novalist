import {
  Modal,
  App,
  TFile,
  ButtonComponent,
  Notice
} from 'obsidian';
import type NovalistPlugin from '../main';

export class InverseRelationshipModal extends Modal {
  private targetFile: TFile;
  private sourceFile: TFile;
  private relationshipKey: string;
  private plugin: NovalistPlugin;
  onSubmit: (inverseKey: string) => void;

  constructor(app: App, plugin: NovalistPlugin, sourceFile: TFile, targetFile: TFile, relationshipKey: string, onSubmit: (k: string) => void) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
    this.targetFile = targetFile;
    this.relationshipKey = relationshipKey;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Define inverse relationship' });
    contentEl.createEl('p', { 
        text: `You defined ${this.targetFile.basename} as "**${this.relationshipKey}**" of ${this.sourceFile.basename}.` 
    });
    contentEl.createEl('p', { 
        text: `How is ${this.sourceFile.basename} related to ${this.targetFile.basename}?` 
    });

    const inputDiv = contentEl.createDiv('novalist-input-group');
    const input = inputDiv.createEl('input', { type: 'text', placeholder: 'e.g. Child, Sibling...' });

    // Suggestion bubbles
    const suggestionsDiv = contentEl.createDiv('novalist-suggestions');

    const renderSuggestions = () => {
       suggestionsDiv.empty();
       const currentInput = input.value.toLowerCase();
       
       // 1. Priortize known inverses for this key
       const knownInverses = this.plugin.settings.relationshipPairs[this.relationshipKey] || [];
       const allKeys = Array.from(this.plugin.knownRelationshipKeys);

       // Filter and combine
       const suggestions = new Set<string>();
       
       // Always show known inverses first
       knownInverses.forEach(k => suggestions.add(k));
       
       // Add matching keys from vault
       allKeys
         .filter(k => k.toLowerCase().includes(currentInput) && !suggestions.has(k))
         .sort()
         .slice(0, 5) // Limit generic suggestions
         .forEach(k => suggestions.add(k));

       suggestions.forEach(key => {
          const chip = suggestionsDiv.createEl('button', { text: key, cls: 'novalist-chip' });
          
          chip.addEventListener('click', () => {
             this.submit(key);
          });
       });
    };

    input.addEventListener('input', renderSuggestions);
    // Initial render
    renderSuggestions();

    input.focus();
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.submit(input.value);
        }
    });

    new ButtonComponent(contentEl)
        .setButtonText('Update')
        .setCta()
        .onClick(() => this.submit(input.value));
  }

  submit(value: string) {
      if (!value.trim()) {
          new Notice('Please enter a relationship label.');
          return;
      }
      this.onSubmit(value.trim());
      this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
