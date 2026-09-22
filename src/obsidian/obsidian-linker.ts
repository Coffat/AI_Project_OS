import { ObsidianEntityType } from '../core/types.js';

export class ObsidianLinker {
  private static readonly WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  /**
   * Generates a standard Obsidian Wikilink.
   * Example: toWikilink('TASK-042') => '[[TASK-042]]'
   * Example: toWikilink('TASK-042', 'OAuth Refactor') => '[[TASK-042|OAuth Refactor]]'
   */
  public static toWikilink(target: string, alias?: string): string {
    const cleanTarget = target.trim();
    if (!alias || alias.trim() === cleanTarget) {
      return `[[${cleanTarget}]]`;
    }
    return `[[${cleanTarget}|${alias.trim()}]]`;
  }

  /**
   * Formats an entity reference as a Wikilink based on its type and id.
   */
  public static formatEntityLink(
    type: ObsidianEntityType,
    id: string,
    label?: string
  ): string {
    switch (type) {
      case 'project':
        return this.toWikilink('PROJECT', label);
      case 'architecture':
        return this.toWikilink('ARCHITECTURE', label);
      case 'constraint':
        return this.toWikilink('CONSTRAINTS', label);
      case 'decision':
        return this.toWikilink(id.toUpperCase(), label);
      case 'task':
        return this.toWikilink(id.toUpperCase(), label);
      case 'research':
        return this.toWikilink(id.toUpperCase(), label);
      case 'index':
        return this.toWikilink('INDEX', label);
      default:
        return this.toWikilink(id, label);
    }
  }

  /**
   * Extracts all Wikilink targets from a markdown document.
   */
  public static extractWikilinks(markdown: string): { target: string; alias?: string }[] {
    const results: { target: string; alias?: string }[] = [];
    let match: RegExpExecArray | null;

    const regex = new RegExp(this.WIKILINK_REGEX.source, 'g');
    while ((match = regex.exec(markdown)) !== null) {
      if (match[1]) {
        results.push({
          target: match[1].trim(),
          alias: match[2]?.trim(),
        });
      }
    }

    return results;
  }

  /**
   * Scans text and replaces known entity names or identifiers with Wikilinks,
   * avoiding double-linking already linked tokens.
   */
  public static linkEntities(
    content: string,
    knownEntities: { id: string; target: string; alias?: string }[]
  ): string {
    let linked = content;

    for (const entity of knownEntities) {
      // Don't replace if already inside [[...]]
      const pattern = new RegExp(`(?<!\\[\\[)\\b${entity.id}\\b(?!\\]\\])`, 'g');
      const replacement = this.toWikilink(entity.target, entity.alias);
      linked = linked.replace(pattern, replacement);
    }

    return linked;
  }
}
