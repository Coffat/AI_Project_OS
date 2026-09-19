export interface ObsidianLinkOptions {
  useWikiLinks: boolean;
  addTags: boolean;
}

export class ObsidianVaultSync {
  public formatAsWikiLink(targetName: string, alias?: string): string {
    if (alias) {
      return `[[${targetName}|${alias}]]`;
    }
    return `[[${targetName}]]`;
  }

  public wrapFrontmatter(content: string, metadata: Record<string, unknown>): string {
    const yamlLines = ['---'];
    for (const [key, value] of Object.entries(metadata)) {
      yamlLines.push(`${key}: ${JSON.stringify(value)}`);
    }
    yamlLines.push('---', '');
    return yamlLines.join('\n') + content;
  }
}

export class NotebookLMIntegration {
  public packageKnowledgeSources(sources: Array<{ title: string; content: string }>): string {
    return sources
      .map((s, idx) => `=== SOURCE ${idx + 1}: ${s.title} ===\n\n${s.content}\n\n`)
      .join('\n----------------------------------------\n\n');
  }
}
