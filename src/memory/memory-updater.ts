import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import crypto from 'node:crypto';
import {
  MemoryLayer,
  MemoryItem,
  MemoryCategory,
  MemoryDiffResult,
} from '../core/types.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { ConstraintRepository } from '../database/repositories/constraint.repository.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';

export class MemoryUpdater {
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly graphRepo: GraphRepository;

  constructor(private readonly db: DatabaseSync) {
    this.decisionRepo = new DecisionRepository(db);
    this.constraintRepo = new ConstraintRepository(db);
    this.graphRepo = new GraphRepository(db);
  }

  /**
   * Applies deterministic updates to SQLite memory stores and canonical markdown files
   * strictly for the affected layers identified in diffResult.
   */
  public async updateMemory(params: {
    projectRoot: string;
    projectId: string;
    diffResult: MemoryDiffResult;
  }): Promise<{ updatedLayers: MemoryLayer[]; updatedCanonicalFiles: string[] }> {
    const updatedLayers: MemoryLayer[] = [];
    const updatedCanonicalFiles: string[] = [];

    const canonicalDir = path.join(params.projectRoot, '.ai', 'canonical');
    await fs.mkdir(canonicalDir, { recursive: true });
    await this.ensureCanonicalStructure(params.projectRoot, canonicalDir, params.projectId);

    // 1. Architecture Layer Update
    if (params.diffResult.affectedLayers.includes('architecture')) {
      const archUpdated = await this.updateArchitectureMemory(
        params.projectRoot,
        canonicalDir,
        params.projectId
      );
      if (archUpdated) {
        updatedLayers.push('architecture');
        updatedCanonicalFiles.push(path.join('.ai', 'canonical', 'ARCHITECTURE.md'));
      }
    }

    // 2. Decision Layer Update
    if (params.diffResult.affectedLayers.includes('decision')) {
      const decisionsUpdated = await this.updateDecisionMemory(
        params.projectRoot,
        canonicalDir,
        params.projectId
      );
      if (decisionsUpdated.length > 0) {
        updatedLayers.push('decision');
        updatedCanonicalFiles.push(...decisionsUpdated);
      }
    }

    // 3. Constraint Layer Update
    if (params.diffResult.affectedLayers.includes('constraint')) {
      const constraintsUpdated = await this.updateConstraintMemory(
        params.projectRoot,
        canonicalDir,
        params.projectId
      );
      if (constraintsUpdated) {
        updatedLayers.push('constraint');
        updatedCanonicalFiles.push(path.join('.ai', 'canonical', 'CONSTRAINTS.md'));
      }
    }

    // 4. Project Layer Update (if project metadata changed or initialization)
    if (params.diffResult.affectedLayers.includes('project')) {
      const projUpdated = await this.updateProjectMemory(
        params.projectRoot,
        canonicalDir,
        params.projectId
      );
      if (projUpdated) {
        updatedLayers.push('project');
        updatedCanonicalFiles.push(path.join('.ai', 'canonical', 'PROJECT.md'));
      }
    }

    return {
      updatedLayers: Array.from(new Set(updatedLayers)),
      updatedCanonicalFiles: Array.from(new Set(updatedCanonicalFiles)),
    };
  }

  public async ensureCanonicalStructure(
    projectRoot: string,
    canonicalDir: string,
    projectId: string
  ): Promise<void> {
    await fs.mkdir(path.join(canonicalDir, 'DECISIONS'), { recursive: true });

    const projPath = path.join(canonicalDir, 'PROJECT.md');
    try {
      await fs.access(projPath);
    } catch {
      await this.updateProjectMemory(projectRoot, canonicalDir, projectId);
    }

    const constPath = path.join(canonicalDir, 'CONSTRAINTS.md');
    try {
      await fs.access(constPath);
    } catch {
      await this.updateConstraintMemory(projectRoot, canonicalDir, projectId);
    }

    const archPath = path.join(canonicalDir, 'ARCHITECTURE.md');
    try {
      await fs.access(archPath);
    } catch {
      await this.updateArchitectureMemory(projectRoot, canonicalDir, projectId);
    }
  }

  /**
   * Updates Architecture Memory deterministically.
   * Discovers top-level subsystems/directories and updates ARCHITECTURE.md cleanly.
   */
  public async updateArchitectureMemory(
    projectRoot: string,
    canonicalDir: string,
    projectId: string
  ): Promise<boolean> {
    const archFilePath = path.join(canonicalDir, 'ARCHITECTURE.md');
    let existingContent = '';
    try {
      existingContent = await fs.readFile(archFilePath, 'utf8');
    } catch {
      existingContent = '# Canonical Architecture Reference\n\n## Subsystems Overview\n';
    }

    // Get current files from graphRepo to build subsystem module breakdown
    const files = this.graphRepo.listFiles(projectId);
    const subsystems = new Set<string>();
    for (const f of files) {
      const parts = f.path.split(/[/\\]/);
      if (parts.length > 1) {
        if (parts[0] === 'src' && parts.length > 2) {
          subsystems.add(`src/${parts[1]}`);
        } else {
          subsystems.add(parts[0]!);
        }
      }
    }

    const sortedSubsystems = Array.from(subsystems).sort();
    const generatedSection = [
      '<!-- BEGIN_GENERATED_SUBSYSTEMS -->',
      '## Detected Subsystems & Modules',
      ...sortedSubsystems.map((s) => `- \`${s}/\``),
      `<!-- Total Indexed Modules: ${sortedSubsystems.length} | Updated: ${new Date().toISOString()} -->`,
      '<!-- END_GENERATED_SUBSYSTEMS -->',
    ].join('\n');

    let newContent: string;
    const startTag = '<!-- BEGIN_GENERATED_SUBSYSTEMS -->';
    const endTag = '<!-- END_GENERATED_SUBSYSTEMS -->';

    if (existingContent.includes(startTag) && existingContent.includes(endTag)) {
      const before = existingContent.substring(0, existingContent.indexOf(startTag)).trimEnd();
      const after = existingContent.substring(existingContent.indexOf(endTag) + endTag.length).trimStart();
      newContent = `${before}\n\n${generatedSection}\n\n${after}`.trim() + '\n';
    } else {
      newContent = `${existingContent.trim()}\n\n${generatedSection}\n`;
    }

    // Anti-bloat check: only write if hash differs
    const existingHash = crypto.createHash('sha256').update(existingContent).digest('hex');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

    if (existingHash !== newHash) {
      await fs.writeFile(archFilePath, newContent, 'utf8');
    }

    // Sync to SQLite project_memory
    await this.upsertProjectMemoryRecord({
      projectId,
      category: 'ARCHITECTURE',
      key: 'canonical:architecture',
      title: 'Canonical Architecture Reference',
      content: newContent,
      sourceFile: path.relative(projectRoot, archFilePath),
    });

    return true;
  }

  /**
   * Updates Decision Memory deterministically.
   * Generates or updates ADR files in `.ai/canonical/DECISIONS/`.
   */
  public async updateDecisionMemory(
    projectRoot: string,
    canonicalDir: string,
    projectId: string
  ): Promise<string[]> {
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    await fs.mkdir(decisionsDir, { recursive: true });

    const decisions = this.decisionRepo.listByProject(projectId);
    const updatedFiles: string[] = [];

    for (const d of decisions) {
      const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const fileName = `${d.id.substring(0, 8)}-${slug}.md`;
      const fullPath = path.join(decisionsDir, fileName);
      const relPath = path.relative(projectRoot, fullPath);

      const content = [
        `# ADR: ${d.title}`,
        '',
        `- **ID**: ${d.id}`,
        `- **Status**: ${d.status.toUpperCase()}`,
        `- **Task ID**: ${d.taskId ?? 'N/A'}`,
        `- **Date**: ${new Date(d.createdAt).toISOString()}`,
        '',
        '## Context',
        d.context,
        '',
        '## Decision Rationale',
        d.decisionRationale,
        '',
        d.consequences ? `## Consequences\n${d.consequences}\n` : '',
      ].filter(Boolean).join('\n');

      let currentFileHash = '';
      try {
        const existing = await fs.readFile(fullPath, 'utf8');
        currentFileHash = crypto.createHash('sha256').update(existing).digest('hex');
      } catch {
        // file doesn't exist
      }

      const newHash = crypto.createHash('sha256').update(content).digest('hex');
      if (currentFileHash !== newHash) {
        await fs.writeFile(fullPath, content, 'utf8');
        updatedFiles.push(relPath);
      }

      // Upsert into project_memory
      await this.upsertProjectMemoryRecord({
        projectId,
        category: 'DECISION',
        key: `decision:${d.id}`,
        title: d.title,
        content,
        sourceFile: relPath,
      });
    }

    return updatedFiles;
  }

  /**
   * Updates Constraint Memory deterministically.
   */
  public async updateConstraintMemory(
    projectRoot: string,
    canonicalDir: string,
    projectId: string
  ): Promise<boolean> {
    const constraintFilePath = path.join(canonicalDir, 'CONSTRAINTS.md');
    const constraints = this.constraintRepo.listByProject(projectId);

    const lines = [
      '# Canonical Constraints & Invariants',
      '',
      '> Technical, security, and architectural guardrails enforced across the codebase.',
      '',
    ];

    for (const c of constraints) {
      lines.push(
        `### [${c.enforcementLevel.toUpperCase()}] ${c.title}`,
        `- **Category**: ${c.category}`,
        `- **Rule**: ${c.ruleContent}`,
        ''
      );
    }

    const content = lines.join('\n');
    let existingHash = '';
    try {
      const existing = await fs.readFile(constraintFilePath, 'utf8');
      existingHash = crypto.createHash('sha256').update(existing).digest('hex');
    } catch {
      // file doesn't exist
    }

    const newHash = crypto.createHash('sha256').update(content).digest('hex');
    if (existingHash !== newHash) {
      await fs.writeFile(constraintFilePath, content, 'utf8');
    }

    await this.upsertProjectMemoryRecord({
      projectId,
      category: 'CONSTRAINT',
      key: 'canonical:constraints',
      title: 'Canonical Constraints & Invariants',
      content,
      sourceFile: path.relative(projectRoot, constraintFilePath),
    });

    return true;
  }

  /**
   * Updates Project Definition Memory.
   */
  public async updateProjectMemory(
    projectRoot: string,
    canonicalDir: string,
    projectId: string
  ): Promise<boolean> {
    const projFilePath = path.join(canonicalDir, 'PROJECT.md');
    let content = '';
    try {
      content = await fs.readFile(projFilePath, 'utf8');
    } catch {
      content = [
        '# Canonical Project Definition',
        '',
        `Project ID: ${projectId}`,
        'Status: Active',
        '',
        '## Mission',
        'AI Project OS - Local-first Project Memory + Context + Handoff + Code Intelligence OS.',
        '',
      ].join('\n');
      await fs.writeFile(projFilePath, content, 'utf8');
    }

    await this.upsertProjectMemoryRecord({
      projectId,
      category: 'ARCHITECTURE',
      key: 'canonical:project',
      title: 'Canonical Project Definition',
      content,
      sourceFile: path.relative(projectRoot, projFilePath),
    });

    return true;
  }

  /**
   * Upserts into project_memory with version increment and synchronized FTS5 index.
   * Ensures idempotency: if content is identical, skips version bump.
   */
  private async upsertProjectMemoryRecord(params: {
    projectId: string;
    category: MemoryCategory;
    key: string;
    title: string;
    content: string;
    sourceFile: string;
  }): Promise<void> {
    const existing = this.findProjectMemoryByKey(params.projectId, params.key);
    const now = Date.now();

    if (existing) {
      // If content is identical, do not create unnecessary version increment or FTS churn
      if (existing.content === params.content && existing.title === params.title) {
        return;
      }

      const stmt = this.db.prepare(`
        UPDATE project_memory
        SET title = ?, content = ?, source_file = ?, version = version + 1, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(params.title, params.content, params.sourceFile, now, existing.id);

      // Re-index FTS
      try {
        this.db.prepare('DELETE FROM fts_project_memory WHERE memory_id = ?').run(existing.id);
        this.db.prepare(`
          INSERT INTO fts_project_memory (memory_id, title, content, category, source_file)
          VALUES (?, ?, ?, ?, ?)
        `).run(existing.id, params.title, params.content, params.category, params.sourceFile);
      } catch {
        // Fallback
      }
    } else {
      const id = crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO project_memory (id, project_id, category, key, title, content, source_file, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        params.projectId,
        params.category,
        params.key,
        params.title,
        params.content,
        params.sourceFile,
        1,
        now
      );

      try {
        this.db.prepare(`
          INSERT INTO fts_project_memory (memory_id, title, content, category, source_file)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, params.title, params.content, params.category, params.sourceFile);
      } catch {
        // Fallback
      }
    }
  }

  private findProjectMemoryByKey(projectId: string, key: string): MemoryItem | null {
    const stmt = this.db.prepare('SELECT * FROM project_memory WHERE project_id = ? AND key = ?');
    const row = stmt.get(projectId, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      category: row['category'] as MemoryCategory,
      key: String(row['key']),
      title: String(row['title']),
      content: String(row['content']),
      sourceFile: String(row['source_file']),
      version: Number(row['version']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
