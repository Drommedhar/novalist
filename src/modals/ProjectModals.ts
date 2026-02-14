import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

/**
 * Modal for switching between projects.
 */
export class ProjectSwitcherModal extends Modal {
  plugin: NovalistPlugin;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('project.switchProject') });

    const projects = this.plugin.getProjects();
    const activeId = this.plugin.settings.activeProjectId;

    for (const project of projects) {
      const isActive = project.id === activeId;
      const row = new Setting(contentEl)
        .setName(project.name)
        .setDesc(project.path + (isActive ? ` — ${t('project.active')}` : ''));

      if (!isActive) {
        row.addButton(btn => btn
          .setButtonText(t('project.switch'))
          .setCta()
          .onClick(async () => {
            await this.plugin.switchProject(project.id);
            this.close();
          }));
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal for renaming the active project.
 */
export class ProjectRenameModal extends Modal {
  plugin: NovalistPlugin;
  newName: string;
  onDone: (() => void) | null;

  constructor(app: App, plugin: NovalistPlugin, onDone?: () => void) {
    super(app);
    this.plugin = plugin;
    const active = this.plugin.getActiveProject();
    this.newName = active?.name ?? '';
    this.onDone = onDone ?? null;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('project.renameProject') });
    contentEl.createEl('p', { text: t('project.renameDesc') });

    new Setting(contentEl)
      .setName(t('project.newName'))
      .addText(text => text
        .setValue(this.newName)
        .onChange(value => { this.newName = value; }));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('project.rename'))
      .setCta()
      .onClick(async () => {
        const trimmed = this.newName.trim();
        if (!trimmed) {
          new Notice(t('project.nameRequired'));
          return;
        }
        const active = this.plugin.getActiveProject();
        if (active) {
          await this.plugin.renameProject(active.id, trimmed);
        }
        this.close();
        if (this.onDone) this.onDone();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal for adding a new project.
 */
export class ProjectAddModal extends Modal {
  plugin: NovalistPlugin;
  projectName: string = '';
  onDone: (() => void) | null;

  constructor(app: App, plugin: NovalistPlugin, onDone?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone ?? null;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('project.addProject') });
    contentEl.createEl('p', { text: t('project.addProjectDesc') });

    new Setting(contentEl)
      .setName(t('project.projectName'))
      .addText(text => text
        .setPlaceholder(t('project.projectNamePlaceholder'))
        .onChange(value => { this.projectName = value; }));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(async () => {
        const trimmed = this.projectName.trim();
        if (!trimmed) {
          new Notice(t('project.nameRequired'));
          return;
        }
        const project = await this.plugin.addProject(trimmed, trimmed);
        await this.plugin.switchProject(project.id);
        await this.plugin.initializeProjectStructure();
        this.close();
        if (this.onDone) this.onDone();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal asking the user whether existing content should be moved
 * when the Novalist root folder changes.
 */
export class RootMoveConfirmModal extends Modal {
  plugin: NovalistPlugin;
  newRoot: string;
  onDone: (() => void) | null;

  constructor(app: App, plugin: NovalistPlugin, newRoot: string, onDone?: () => void) {
    super(app);
    this.plugin = plugin;
    this.newRoot = newRoot;
    this.onDone = onDone ?? null;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('settings.rootChangeTitle') });
    contentEl.createEl('p', { text: t('settings.rootChangeDesc') });

    const oldDisplay = this.plugin.settings.novalistRoot || '/';
    const newDisplay = this.newRoot || '/';
    contentEl.createEl('p', {
      text: t('settings.rootChangeFromTo', { from: oldDisplay, to: newDisplay }),
    });

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('settings.rootChangeMove'))
      .setCta()
      .onClick(async () => {
        await this.plugin.changeNovalistRoot(this.newRoot, true);
        this.close();
        if (this.onDone) this.onDone();
      });

    new ButtonComponent(buttonDiv)
      .setButtonText(t('settings.rootChangeDontMove'))
      .onClick(async () => {
        await this.plugin.changeNovalistRoot(this.newRoot, false);
        this.close();
        if (this.onDone) this.onDone();
      });

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
