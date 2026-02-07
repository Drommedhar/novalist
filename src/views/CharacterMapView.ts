import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  TFolder
} from 'obsidian';
import type NovalistPlugin from '../main';
import { parseCharacterSheet } from '../utils/characterSheetUtils';
import cytoscape from 'cytoscape';
// @ts-ignore
import fcose from 'cytoscape-fcose';

const fcoseExtension = fcose as cytoscape.Ext;
cytoscape.use(fcoseExtension);

class UnionFind {
    parent: Map<string, string>;
    constructor() {
        this.parent = new Map();
    }
    
    find(i: string): string {
        if (!this.parent.has(i)) this.parent.set(i, i);
        if (this.parent.get(i) !== i) {
            this.parent.set(i, this.find(this.parent.get(i)));
        }
        return this.parent.get(i);
    }
    
    union(i: string, j: string) {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent.set(rootI, rootJ);
        }
    }
}

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
            public surname: string = '',
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
        const sheetData = parseCharacterSheet(content);
        
        const role = sheetData.role || 'Side';
        const gender = sheetData.gender || '';
        const surname = sheetData.surname || '';
        
        allCharData.set(id, new CharData(id, file.basename, file, role, gender, surname));
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

    // Helper to store directed edges temporarily
    const rawEdges: { source: string; target: string; role: string }[] = [];

    // Pass 2: Parse relationships (reuse sheetData from Pass 1 by re-reading)
    for (const char of allCharData.values()) {
        const content = await this.plugin.app.vault.read(char.file);
        const sheetData = parseCharacterSheet(content);
        
        for (const rel of sheetData.relationships) {
            const roleLabel = rel.role;
            
            // Split comma-separated targets (e.g. "[[Finn Drent]], [[Liam Calder]]")
            const targetNames = rel.character.split(/,(?=\s*\[\[)/).map(s => s.trim()).filter(Boolean);
            // Fallback: if no wikilinks, just split by comma
            const targets = targetNames.length > 0 ? targetNames : [rel.character];
            
            for (const targetName of targets) {
                const targetId = resolveTarget(targetName);
                if (targetId && targetId !== char.id) {
                    if (!char.connections.has(targetId)) char.connections.set(targetId, []);
                    char.connections.get(targetId)?.push(roleLabel);
                    
                    rawEdges.push({ source: char.id, target: targetId, role: roleLabel });
                }
            }
        }
    }

    // Process Edges: Group Mutuals & Apply Relationship Model
    const mutualUFs = new Map<string, UnionFind>(); // Role -> UnionFind
    
    // Build adjacency for quick lookup: Source -> Target -> Roles[]
    const adjacency = new Map<string, Map<string, Set<string>>>();
    for (const edge of rawEdges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Map());
        if (!adjacency.get(edge.source).has(edge.target)) adjacency.get(edge.source).set(edge.target, new Set());
        adjacency.get(edge.source).get(edge.target).add(edge.role);
    }

    // Merged edge collector for deduplication
    const mergedEdges = new Map<string, { source: string; target: string; roles: Set<string> }>();

    // Build role groups: for each role, collect all (source -> targets) 
    const roleGroups = new Map<string, Map<string, Set<string>>>();
    for (const edge of rawEdges) {
        if (!roleGroups.has(edge.role)) roleGroups.set(edge.role, new Map());
        const group = roleGroups.get(edge.role);
        if (!group.has(edge.source)) group.set(edge.source, new Set());
        group.get(edge.source).add(edge.target);
    }

    // Detect mutual roles: a role is mutual if every target also lists
    // the source under that same role (all connections are bidirectional)
    const mutualRoles = new Set<string>();
    for (const [role, sources] of roleGroups.entries()) {
        let allMutual = true;
        for (const [src, targets] of sources.entries()) {
            for (const tgt of targets) {
                if (!sources.get(tgt)?.has(src)) {
                    allMutual = false;
                    break;
                }
            }
            if (!allMutual) break;
        }
        if (allMutual) mutualRoles.add(role);
    }

    const processedPairs = new Set<string>();
    const simpleEdges: { source: string; target: string; role: string; mutual: boolean }[] = [];

    // Identify Mutual Pairs
    for (const edge of rawEdges) {
        const u = edge.source;
        const v = edge.target;
        const roleU = edge.role;
        
        const pairKey = [u, v].sort().join('--');
        if (processedPairs.has(pairKey + '--' + roleU)) continue;
        
        if (mutualRoles.has(roleU)) {
             if (!mutualUFs.has(roleU)) mutualUFs.set(roleU, new UnionFind());
             mutualUFs.get(roleU).union(u, v);
             processedPairs.add(pairKey + '--' + roleU);
        } else {
             simpleEdges.push({ source: u, target: v, role: roleU, mutual: false });
        }
    }

    // Generate Hubs for Components > 2
    for (const [role, uf] of mutualUFs.entries()) {
        const components = new Map<string, string[]>();
        // Gather components
        // Iterate all nodes involved in this role (we need to track them or just iterate all chars)
        // Optimization: track nodes in the UF logic?
        // We'll iterate allCharData.
        
        for (const charId of allCharData.keys()) {
            if (uf.parent.has(charId)) {
                const root = uf.find(charId);
                if (!components.has(root)) components.set(root, []);
                components.get(root).push(charId);
            }
        }

        for (const [root, members] of components.entries()) {
            if (members.length > 2) {
                // Create Hub
                const hubId = `hub-${role}-${root}`;
                elements.push({ 
                    data: { id: hubId, label: role }, 
                    classes: 'hub-node' 
                });
                for (const member of members) {
                     elements.push({
                        data: { source: member, target: hubId, label: '' },
                        classes: 'hub-edge'
                     });
                }
            } else {
                // Size 2: Just draw edge (approximate as single edge)
                // We need to ensure we don't draw duplicates.
                if (members.length === 2) {
                    const [a, b] = members;
                    const pairKey = [a, b].sort().join('--');
                    if (!mergedEdges.has(pairKey)) mergedEdges.set(pairKey, { source: a, target: b, roles: new Set() });
                    mergedEdges.get(pairKey).roles.add(role);
                }
            }
        }
    }

    // Merge simple edges: combine all roles between same pair into one edge with "/"
    for (const edge of simpleEdges) {
        const pairKey = [edge.source, edge.target].sort().join('--');
        if (!mergedEdges.has(pairKey)) mergedEdges.set(pairKey, { source: edge.source, target: edge.target, roles: new Set() });
        mergedEdges.get(pairKey).roles.add(edge.role);
    }

    // Emit merged edges
    for (const edge of mergedEdges.values()) {
        const label = Array.from(edge.roles).join(' / ');
        elements.push({
            data: { source: edge.source, target: edge.target, label },
            classes: 'relationship-edge'
        });
    }

    // Pass 3: Group by surname
    const connectedIds = new Set<string>();
    for (const edge of rawEdges) {
        connectedIds.add(edge.source);
        connectedIds.add(edge.target);
    }

    const surnameGroups = new Map<string, string[]>();
    for (const char of allCharData.values()) {
        if (!connectedIds.has(char.id)) continue;
        const key = char.surname.trim();
        if (key) {
            if (!surnameGroups.has(key)) surnameGroups.set(key, []);
            surnameGroups.get(key).push(char.id);
        }
    }

    const handledFamily = new Set<string>();
    for (const [surname, members] of surnameGroups.entries()) {
        if (members.length > 1) {
            const parentId = `family-${surname.toLowerCase().replace(/\s+/g, '-')}`;
            elements.push({ data: { id: parentId, label: surname }, classes: 'family-group' });
            for (const cid of members) {
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

    for (const char of allCharData.values()) {
        if (!handledFamily.has(char.id)) {
            if (connectedIds.has(char.id)) {
                elements.push({ 
                    data: { id: char.id, label: char.name }, 
                    classes: `character-node role-${char.role.toLowerCase().replace(/\s+/g, '-')}` 
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
                    'label': 'data(label)',
                    'color': '#888',
                    'font-size': '9px',
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': 5,
                    'shape': 'round-rectangle'
                }
            },
            {
                selector: '.hub-node',
                style: {
                    'background-color': '#e1f5fe',
                    'border-color': '#01579b',
                    'border-style': 'dashed',
                    'width': '30px',
                    'height': '30px',
                    'label': 'data(label)',
                    'font-size': '8px',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'color': '#01579b'
                }
            },
            {
                selector: '.hub-edge',
                style: {
                    'width': 1,
                    'line-color': '#01579b',
                    'line-style': 'dashed',
                    'curve-style': 'bezier',
                    'opacity': 0.6
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#666',
                    'target-arrow-shape': 'none',
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
            name: 'fcose',
            // @ts-ignore
            quality: 'proof',
            animate: false,
            nodeDimensionsIncludeLabels: true,
            uniformNodeDimensions: false,
            packComponents: true,
            nodeRepulsion: 8000,
            idealEdgeLength: 120,
            edgeElasticity: 0.45,
            nestingFactor: 0.1,
            gravity: 0.25,
            gravityRange: 3.8,
            gravityCompound: 1.5,
            gravityRangeCompound: 2.0,
            numIter: 5000,
            tile: true,
            tilingPaddingVertical: 20,
            tilingPaddingHorizontal: 20
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
