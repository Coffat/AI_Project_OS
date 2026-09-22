import { RelevantSymbolItem } from '../core/types.js';

export class ContextCompressor {
  /**
   * Compresses source code into an outline format (signatures, exports, interface declarations)
   * if the complete file is too large for the budget.
   */
  public compressCodeToOutline(
    filePath: string,
    content: string,
    symbols: RelevantSymbolItem[] = []
  ): string {
    const lines = content.split('\n');
    if (lines.length <= 40) {
      return content;
    }

    const outlineLines: string[] = [
      `// [Outline Compressed] ${filePath} (${lines.length} lines total)`,
      '// High-level structure & exported interfaces:',
    ];

    // If we have parsed AST symbols, use them to form a precise signature outline
    if (symbols.length > 0) {
      for (const sym of symbols) {
        if (sym.signature) {
          outlineLines.push(`// L${sym.lineStart ?? '?'}: ${sym.signature}`);
        } else {
          outlineLines.push(`// ${sym.kind} ${sym.name}`);
        }
      }
      return outlineLines.join('\n');
    }

    // Heuristic fallback: preserve imports, exports, class/interface definitions
    for (const line of lines) {
      if (!line) continue;
      const trimmed = line.trim();
      if (
        trimmed.startsWith('export ') ||
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('type ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('enum ')
      ) {
        outlineLines.push(line);
      }

    }


    if (outlineLines.length <= 2) {
      // Fallback: take head and tail
      return [...lines.slice(0, 20), '// ... [content omitted for brevity] ...', ...lines.slice(-10)].join('\n');
    }

    return outlineLines.join('\n');
  }

  /**
   * Compresses architectural decisions into a concise title + rationale bullet.
   */
  public compressDecision(decision: {
    id: string;
    title: string;
    status: string;
    rationale?: string;
    summary?: string;
  }): string {
    const mainText = decision.rationale || decision.summary || '';
    const firstSentence = mainText.split('\n')[0]?.trim() || '';
    return `- **[${decision.id}] ${decision.title}** (${decision.status}): ${firstSentence.slice(0, 150)}`;
  }

  /**
   * Compresses architecture rules into concise bullet points.
   */
  public compressArchitecture(summary: string, rules?: string[]): string {
    if (rules && rules.length > 0) {
      return rules.map((r) => `- ${r.trim()}`).join('\n');
    }
    const lines = summary.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(0, 5).join('\n');
  }

  /**
   * Trims large text to a maximum character count while preserving line integrity.
   */
  public trimContent(content: string, maxChars = 1000): string {
    if (content.length <= maxChars) return content;
    const truncated = content.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > maxChars / 2) {
      return truncated.slice(0, lastNewline) + '\n// ... [truncated for token budget]';
    }
    return truncated + '... [truncated]';
  }
}
