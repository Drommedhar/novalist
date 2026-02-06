import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  TFolder
} from 'obsidian';
import type NovalistPlugin from '../main';
import cytoscape from 'cytoscape';
// @ts-ignore
import dagre from 'cytoscape-dagre';

const dagreExtension = dagre as cytoscape.Ext;
cytoscape.use(dagreExtension);

export const CHARACTER_MAP_VIEW_TYPE = 'novalist-character-map';

export class CharacterMapView extends ItemView {
  plugin: NovalistPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHARACTER_MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Character map';
  }

  getIcon(): string {
    return 'git-commit';
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.plugin.app.vault.on('modify', () => { void this.updateGraph(); }));
    await this.updateGraph();
  }

  async updateGraph(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    
    const header = container.createEl('div', { 
        cls: 'view-header',
        attr: {
             style: 'margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;'
        }
    });

    header.createEl('h4', { text: 'Character relationship map (work in progress)' });
    
    const wipBanner = container.createDiv();
    wipBanner.setCssStyles({
        backgroundColor: '#5c4818',
        color: '#f0ad4e',
        padding: '5px 10px',
        marginBottom: '10px',
        borderRadius: '4px',
        fontSize: '0.9em',
        border: '1px solid #8a6d3b',
        textAlign: 'center'
    });
    wipBanner.createEl('strong', { text: 'Note: ' });
    wipBanner.createSpan({ text: 'This relationship graph is currently under development. Layout and connections might be unstable.' });

    const refreshBtn = header.createEl('button', { text: 'Refresh' });
    refreshBtn.addEventListener('click', () => { void this.updateGraph(); });

    const div = container.createDiv();
    div.addClass('novalist-character-map-cy');
    div.setCssProps({ height: 'calc(100% - 40px)', width: '100%', position: 'relative', overflow: 'hidden' });
    
    const legend = div.createDiv();
    legend.setCssProps({
        position: 'absolute',
        bottom: '10px', 
        left: '10px',
        background: 'rgba(0,0,0,0.6)',
        padding: '8px',
        borderRadius: '5px',
        zIndex: '1000',
        pointerEvents: 'none',
        color: '#ccc',
        fontSize: '0.8em',
        border: '1px solid rgba(255,255,255,0.1)'
    });
    legend.createEl('div', { text: 'Scroll to zoom • drag to pan' });
    legend.createEl('div', { text: 'Drag nodes to rearrange' });


    if (!this.plugin.settings.characterFolder) {
        div.setText('Character folder not set in settings.');
        return;
    }

    let folderPath = this.plugin.settings.characterFolder;
    if (this.plugin.settings.projectPath) {
        folderPath = `${this.plugin.settings.projectPath}/${folderPath}`;
    }

    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
        div.setText('Character folder not found: ' + folderPath);
        return;
    }

    const files = this.plugin.app.vault.getFiles().filter((f: TFile) => f.path.startsWith(folderPath));
    if (files.length === 0) {
        div.setText('No character files found in ' + folderPath);
        return;
    }
    
    interface ElementData {
        id?: string;
        label?: string;
        parent?: string;
        source?: string;
        target?: string;
    }
    
    interface ElementWrapper {
        data: ElementData;
        classes?: string;
    }

    const elements: ElementWrapper[] = [];
    const charIdMap = new Map<string, string>();
    
    const getId = (name: string) => {
        let n = name.trim();
        if (n.startsWith('[[') && n.endsWith(']]')) n = n.slice(2, -2);
        const parts = n.split('|');
        const core = parts[0].trim();
        return core.toLowerCase().replace(/\s+/g, '-');
    };

    const charFiles = new Map<string, TFile>();

    class CharData {
        constructor(
            public id: string,
            public name: string,
            public file: TFile,
            public role: string,
            public gender: string,
            public family: Set<string> = new Set(),
            public connections: Map<string, string[]> = new Map() 
        ) {}
    }

    const allCharData = new Map<string, CharData>();

    // Pass 1: Collect Nodes
    for (const file of files) {
        const id = getId(file.basename);
        charIdMap.set(file.basename, id);
        charFiles.set(id, file);
        
        const content = await this.plugin.app.vault.read(file);
        const { frontmatter } = this.plugin.extractFrontmatterAndBody(content);
        
        const role = frontmatter.role || 'Side';
        const gender = frontmatter.gender || '';
        
        allCharData.set(id, new CharData(id, file.basename, file, role, gender));
    }

    const resolveTarget = (targetName: string): string | null => {
        let name = targetName.trim();
        if (name.startsWith('[[') && name.endsWith(']]')) name = name.slice(2, -2);
        name = name.split('|')[0].trim();
        
        if (charIdMap.has(name)) return charIdMap.get(name) || null;
        
        for (const [key, id] of charIdMap.entries()) {
             if (key.includes(name) || name.includes(key)) return id;
        }
        return null;
    };

    // Pass 2: Parse relationships
    for (const char of allCharData.values()) {
        const content = await this.plugin.app.vault.read(char.file);
        const relationshipLines = this.plugin.getSectionLines(content, 'Relationships');
        
        for (const line of relationshipLines) {
            const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)(.*)$/);
            if (!match) continue;
            
            let roleLabel = match[2].trim();
            if (roleLabel.endsWith(':')) roleLabel = roleLabel.slice(0, -1).trim();
            const targetsStr = match[4].trim();
            
            const targets = targetsStr.split(',').map(s => s.trim()).filter(Boolean);
            for (const t of targets) {
                const targetId = resolveTarget(t);
                if (targetId && targetId !== char.id) {
                    if (!char.connections.has(targetId)) char.connections.set(targetId, []);
                    char.connections.get(targetId)?.push(roleLabel);
                    
                    const isFamily = roleLabel.toLowerCase().includes('child') || 
                                     roleLabel.toLowerCase().includes('father') || 
                                     roleLabel.toLowerCase().includes('mother') || 
                                     roleLabel.toLowerCase().includes('parent') || 
                                     roleLabel.toLowerCase().includes('sibling') || 
                                     roleLabel.toLowerCase().includes('sister') || 
                                     roleLabel.toLowerCase().includes('brother') || 
                                     roleLabel.toLowerCase().includes('husband') || 
                                     roleLabel.toLowerCase().includes('wife') || 
                                     roleLabel.toLowerCase().includes('son') || 
                                     roleLabel.toLowerCase().includes('daughter');
                    if (isFamily) {
                        char.family.add(targetId);
                    }
                }
            }
        }
    }

    // Pass 3: Create familial clusters/compounds if possible
    const handledFamily = new Set<string>();
    for (const char of allCharData.values()) {
        if (handledFamily.has(char.id)) continue;
        if (char.family.size > 0) {
            const cluster = new Set<string>([char.id]);
            const stack = [char.id];
            while(stack.length > 0) {
                const current = stack.pop();
                if (!current) continue;
                const data = allCharData.get(current);
                if (!data) continue;
                for(const f of data.family) {
                    if (!cluster.has(f)) {
                        cluster.add(f);
                        stack.push(f);
                    }
                }
            }
            
            if (cluster.size > 1) {
                const parentId = `family-${char.id}`;
                elements.push({ data: { id: parentId, label: 'Family Group' }, classes: 'family-group' });
                for(const cid of cluster) {
                    const c = allCharData.get(cid);
                    if (c) {
                        elements.push({ 
                            data: { id: c.id, label: c.name, parent: parentId }, 
                            classes: `character-node role-${c.role.toLowerCase().replace(/\s+/g, '-')}` 
                        });
                        handledFamily.add(cid);
                    }
                }
            }
        }
    }

    for (const char of allCharData.values()) {
        if (!handledFamily.has(char.id)) {
            elements.push({ 
                data: { id: char.id, label: char.name }, 
                classes: `character-node role-${char.role.toLowerCase().replace(/\s+/g, '-')}` 
            });
        }
    }

    const shouldDraw = (idA: string, idB: string, roleInput: string): boolean => {
        const a = allCharData.get(idA);
        const b = allCharData.get(idB);
        if (!a || !b) return true;

        const role = roleInput.toLowerCase();
        
        if (role.includes('parent') || role.includes('mother') || role.includes('father')) {
             const bRoles = b.connections.get(idA)?.map(r => r.toLowerCase()) || [];
             if (bRoles.some(r => r.includes('child') || r.includes('son') || r.includes('daughter'))) return idA < idB; 
        }
        
        if (role.includes('sibling') || role.includes('sister') || role.includes('brother')) {
             const bRoles = b.connections.get(idA)?.map(r => r.toLowerCase()) || [];
             if (bRoles.some(r => r.includes('sibling') || r.includes('sister') || r.includes('brother'))) return idA < idB;
        }

        if (role.includes('husband') || role.includes('wife') || role.includes('spouse') || role.includes('partner')) {
            const bRoles = b.connections.get(idA)?.map(r => r.toLowerCase()) || [];
            if (bRoles.some(r => r.includes('husband') || r.includes('wife') || r.includes('spouse') || r.includes('partner'))) return idA < idB;
        }
        
        return true;
    };

    const addedEdges = new Set<string>();
    for (const char of allCharData.values()) {
        for (const [targetId, roles] of char.connections.entries()) {
            for (const role of roles) {
                if (!shouldDraw(char.id, targetId, role)) continue;
                
                const edgeId = [char.id, targetId, role].sort().join('-edge-');
                if (addedEdges.has(edgeId)) continue;
                addedEdges.add(edgeId);

                elements.push({
                    data: { source: char.id, target: targetId, label: role },
                    classes: 'relationship-edge'
                });
            }
        }
    }

    const cy = cytoscape({
        container: div,
        elements: elements,
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'color': '#fff',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'background-color': '#444',
                    'font-size': '10px',
                    'text-wrap': 'wrap',
                    'text-max-width': '80px'
                }
            },
            {
                selector: '.character-node',
                style: {
                    'width': '60px',
                    'height': '60px',
                    'shape': 'ellipse',
                    'border-width': '2px',
                    'border-color': '#666'
                }
            },
            {
                selector: '.role-main',
                style: {
                    'background-color': '#d39e00',
                    'width': '80px',
                    'height': '80px',
                    'font-size': '12px',
                    'font-weight': 'bold',
                    'border-color': '#ffc107'
                }
            },
            {
                selector: '.role-side',
                style: {
                    'background-color': '#555',
                    'border-color': '#999'
                }
            },
            {
                selector: '.role-background',
                style: {
                    'background-color': '#333',
                    'border-color': '#444',
                    'width': '50px',
                    'height': '50px',
                    'opacity': 0.8
                }
            },
            {
                selector: '.family-group',
                style: {
                    'background-color': 'rgba(255, 255, 255, 0.05)',
                    'border-width': '1px',
                    'border-color': '#555',
                    'border-style': 'dashed',
                    'label': '',
                    'shape': 'round-rectangle'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#666',
                    'target-arrow-color': '#666',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': '8px',
                    'color': '#aaa',
                    'text-rotation': 'autorotate',
                    'text-margin-y': -10,
                    'edge-text-rotation': 'autorotate'
                }
            }
        ],
        layout: {
            name: 'dagre',
            // @ts-ignore
            nodeSep: 100,
            edgeSep: 100,
            rankSep: 200,
            rankDir: 'LR'
        }
    });

    cy.on('tap', 'node', (evt) => {
        const id = (evt.target as cytoscape.NodeSingular).id();
        const file = charFiles.get(id);
        if (file) {
            void this.plugin.focusEntityByName(file.basename, true);
        }
    });
  }
}
