import type { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ProjectRepository } from '../database/repositories/project.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { ConstraintRepository } from '../database/repositories/constraint.repository.js';
import { NotebookManifestBuilder } from './notebook-manifest.js';
import { NotebookFirewall } from './notebook-firewall.js';
import {
  NotebookExportOptions,
  NotebookExportResult,
  NotebookManifest,
} from '../core/types.js';
import { ProjectNotFoundError } from '../core/errors.js';

export class NotebookExporter {
  private readonly projectRepo: ProjectRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly firewall: NotebookFirewall;

  constructor(db: DatabaseSync, private readonly projectRoot: string) {
    this.projectRepo = new ProjectRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.constraintRepo = new ConstraintRepository(db);
    this.firewall = new NotebookFirewall();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public async export(options: NotebookExportOptions = {}): Promise<NotebookExportResult> {
    const projectId = options.projectId ?? this.resolveDefaultProjectId();
    const project = this.projectRepo.findById(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const outDir = options.outDir ?? path.join(this.projectRoot, '.ai', 'notebook');
    fs.mkdirSync(outDir, { recursive: true });

    const exportedFiles: string[] = [];
    const warnings: string[] = [];

    // 1. PROJECT-KNOWLEDGE.md
    const projectContent = this.renderProjectKnowledge(project);
    this.writeNotebookFile(path.join(outDir, 'PROJECT-KNOWLEDGE.md'), projectContent, exportedFiles);

    // 2. ARCHITECTURE.md
    const canonicalArchPath = path.join(this.projectRoot, '.ai', 'canonical', 'ARCHITECTURE.md');
    const rootArchPath = path.join(this.projectRoot, 'ARCHITECTURE.md');
    const archPath = fs.existsSync(canonicalArchPath)
      ? canonicalArchPath
      : fs.existsSync(rootArchPath)
      ? rootArchPath
      : null;

    if (archPath) {
      const archContent = fs.readFileSync(archPath, 'utf8');
      this.writeNotebookFile(path.join(outDir, 'ARCHITECTURE.md'), archContent, exportedFiles);
    } else {
      warnings.push('No ARCHITECTURE.md found in .ai/canonical/ or project root');
    }

    // 3. DECISIONS.md (summary of all accepted decisions)
    const decisions = this.decisionRepo.listByProject(projectId);
    const selectedDecisions = options.selectedDecisions
      ? decisions.filter((d) => options.selectedDecisions!.includes(d.id))
      : decisions.filter((d) => d.status === 'accepted' || d.status === 'proposed');

    const decisionsContent = this.renderDecisions(selectedDecisions);
    this.writeNotebookFile(path.join(outDir, 'DECISIONS.md'), decisionsContent, exportedFiles);

    // 4. README.md (Google Drive & NotebookLM integration instructions)
    const readmeContent = this.renderReadme(project);
    this.writeNotebookFile(path.join(outDir, 'README.md'), readmeContent, exportedFiles);

    // 5. SOURCES.md (index of sources)
    const sourcesContent = this.renderSources(exportedFiles, outDir);
    this.writeNotebookFile(path.join(outDir, 'SOURCES.md'), sourcesContent, exportedFiles);

    // 6. Build and write manifest
    const manifestBuilder = new NotebookManifestBuilder(this.projectRoot);
    const manifest: NotebookManifest = manifestBuilder.build({ ...options, projectId });
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    exportedFiles.push(manifestPath);

    return {
      projectId,
      outDir,
      exportedFiles,
      manifest,
      warnings,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------------------

  public renderProjectKnowledge(project: { id: string; name: string; description?: string; createdAt: number }): string {
    const lines: string[] = [
      `# Project Knowledge: ${project.name}`,
      '',
      `> **Project ID:** ${project.id}`,
      `> **Created:** ${new Date(project.createdAt).toISOString().slice(0, 10)}`,
      '',
    ];

    if (project.description) {
      lines.push('## Overview', '', project.description, '');
    }

    // Constraints overview
    const constraints = this.constraintRepo.listByProject(project.id);
    if (constraints.length > 0) {
      lines.push('## Key Constraints', '');
      for (const c of constraints) {
        lines.push(`### ${c.title}`);
        lines.push(`- **Category:** ${c.category}`);
        lines.push(`- **Enforcement:** ${c.enforcementLevel}`);
        lines.push(`- **Rule:** ${c.ruleContent}`);
        lines.push('');
      }
    }

    lines.push('---', '');
    lines.push('*This file is auto-generated for NotebookLM. Do not edit manually.*');
    return lines.join('\n');
  }

  public renderDecisions(decisions: Array<{
    id: string;
    title: string;
    context: string;
    decisionRationale: string;
    consequences?: string;
    status: string;
    createdAt: number;
  }>): string {
    const lines: string[] = [
      '# Architecture Decision Records',
      '',
      `*${decisions.length} decision(s) exported for NotebookLM.*`,
      '',
    ];

    for (const d of decisions) {
      lines.push(`## ${d.id}: ${d.title}`);
      lines.push('');
      lines.push(`**Status:** ${d.status}`);
      lines.push(`**Date:** ${new Date(d.createdAt).toISOString().slice(0, 10)}`);
      lines.push('');
      lines.push('### Context');
      lines.push(d.context);
      lines.push('');
      lines.push('### Decision');
      lines.push(d.decisionRationale);
      if (d.consequences) {
        lines.push('');
        lines.push('### Consequences');
        lines.push(d.consequences);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push('*This file is auto-generated for NotebookLM. Do not edit manually.*');
    return lines.join('\n');
  }

  public renderReadme(project: { id: string; name: string }): string {
    const lines: string[] = [
      `# NotebookLM Knowledge Pack: ${project.name}`,
      '',
      'This directory contains the canonical knowledge pack exported from AI Project OS for use with Google NotebookLM as an external research and knowledge synthesis layer.',
      '',
      '## Architecture & Context Firewall',
      '- **NotebookLM is a RESEARCH / EXTERNAL KNOWLEDGE LAYER**, NOT the source of truth for project state.',
      '- Source code, build outputs, node_modules, logs, task/handoff runtime states, and secrets (.env, keys) are strictly excluded by the NotebookLM Context Firewall.',
      '- Research output from NotebookLM CANNOT directly overwrite canonical memory. Findings must be submitted as Research Proposals (`.ai/proposals/PROPOSAL-XXX.md`) and undergo Human/Agent review before promotion to Architecture Decision Records (ADRs).',
      '',
      '## Files in this Knowledge Pack',
      '- `PROJECT-KNOWLEDGE.md`: High-level project context, requirements, and constraints.',
      '- `ARCHITECTURE.md`: Canonical system architecture and subsystem boundaries.',
      '- `DECISIONS.md`: Summary of accepted Architecture Decision Records.',
      '- `SOURCES.md`: Index of included knowledge documents and firewall exclusions.',
      '- `manifest.json`: Cryptographic hashes, categories, word counts, and token estimates.',
      '',
      '## Google Drive & NotebookLM Workflow',
      '1. **Sync / Upload to Google Drive**:',
      '   - Upload this `.ai/notebook/` folder (or sync via Google Drive desktop client) to your Google Drive.',
      '2. **Import to NotebookLM**:',
      '   - Open NotebookLM (https://notebooklm.google.com).',
      '   - Create a new notebook (e.g., "' + project.name + ' Research").',
      '   - Add sources by choosing "Google Drive" and selecting the uploaded Markdown files (or upload directly).',
      '3. **Conduct Research & Synthesize**:',
      '   - Ask NotebookLM for architectural trade-offs, technology evaluations, or code designs based on existing constraints.',
      '4. **Propose Changes Back to AI Project OS**:',
      '   - Save findings into a proposal:',
      '     ```bash',
      '     notebook proposal create --project-id ' + project.id + ' --title "..." --question "..."',
      '     ```',
      '   - Or save Markdown to `.ai/proposals/PROPOSAL-XXX.md` and ingest:',
      '     ```bash',
      '     notebook proposal ingest .ai/proposals/my-research.md --project-id ' + project.id,
      '     ```',
      '   - Review and approve to promote to canonical ADR:',
      '     ```bash',
      '     notebook proposal approve <PROPOSAL-ID> --reviewed-by "lead-architect"',
      '     ```',
      '',
      '---',
      '*This file is auto-generated for NotebookLM. Do not edit manually.*',
    ];
    return lines.join('\n');
  }

  private renderSources(files: string[], outDir: string): string {
    const lines: string[] = [
      '# Knowledge Sources',
      '',
      'Files included in this NotebookLM knowledge pack:',
      '',
    ];

    for (const f of files) {
      const rel = path.relative(outDir, f);
      lines.push(`- \`${rel}\``);
    }

    lines.push('');
    lines.push('## Excluded by Firewall');
    lines.push('');
    lines.push('The following categories are **never** exported:');
    lines.push('');
    lines.push('- Source code (*.ts, *.js, *.py, *.go, etc.)');
    lines.push('- Build artifacts (dist/, build/, coverage/)');
    lines.push('- Runtime state (.ai/handoff/, .ai/state/, .ai/tasks/)');
    lines.push('- Secrets (.env*, *.pem, *.key)');
    lines.push('- Logs and temporary files (*.log, *.tmp, *.bak, *.swp)');
    lines.push('- node_modules, .git');
    lines.push('');
    lines.push('*This file is auto-generated for NotebookLM. Do not edit manually.*');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private writeNotebookFile(absolutePath: string, content: string, exportedFiles: string[]): void {
    // Firewall check on relative path within notebook dir
    const relative = path.relative(this.projectRoot, absolutePath);
    this.firewall.validate(relative);
    fs.writeFileSync(absolutePath, content, 'utf8');
    exportedFiles.push(absolutePath);
  }

  private resolveDefaultProjectId(): string {
    const projects = this.projectRepo.list();
    const first = projects[0];
    if (!first) throw new Error('No projects found in database');
    return first.id;
  }
}
