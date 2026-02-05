# Novalist

A comprehensive novel writing plugin for Obsidian that provides project structure, character/location management, and intelligent linking.

## Features

1. **Project Structure Management**
   - Automatic folder creation (Characters, Locations, ChapterDescriptions, Chapters)
   - Template system for consistent file formatting
   - YAML frontmatter parsing for metadata

2. **Context Sidebar**
   - Real-time display of characters in current chapter
   - Location information
   - Quick navigation to referenced files
   - One-click character/location creation

3. **Auto-Replacement System**
   - Configurable text shortcuts (e.g., `''` → `»`)
   - Settings panel for custom replacements
   - Instant replacement while typing

4. **Intelligent Linking**
   - Automatic detection of character/location mentions
   - Hover preview of character information
   - Click to open detailed files
   - Auto-population of reference lists

## Installation

1. Copy the three files (`main.js`, `manifest.json`, `styles.css`) into a folder named `novalist` inside your Obsidian vault's `.obsidian/plugins/` directory
2. Enable the plugin in Obsidian Settings → Community Plugins
3. Run "Initialize Novel Project Structure" from the command palette

## Usage

### Setting Up
- Use the command palette (Ctrl/Cmd+P) and select "Novalist: Initialize Novel Project Structure"
- This creates the folder structure and templates

### Writing
- Open the Context Sidebar via the ribbon icon or command palette
- Create characters/locations using the sidebar buttons or commands
- Write chapters in the Chapters folder
- Character and location names will be automatically detected and linked

### Templates

**Character Template:**
```yaml
---
name: 
surname: 
age: 
relationship: 
further_info: 
images: []
---