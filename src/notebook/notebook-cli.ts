/**
 * NotebookCLI
 *
 * CLI interface for the NotebookLM Knowledge Bridge.
 *
 * Commands:
 *   notebook export [--project-id ID] [--out-dir DIR]
 *   notebook proposal create --project-id ID --title "..." --question "..."
 *   notebook proposal ingest <file> --project-id ID
 *   notebook proposal list [--project-id ID] [--status STATUS]
 *   notebook proposal approve <PROPOSAL-ID> [--reviewed-by NAME]
 *   notebook proposal reject  <PROPOSAL-ID> [--comment "..."] [--reviewed-by NAME]
 *   notebook proposal show <PROPOSAL-ID>
 */

import type { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { NotebookExporter } from './notebook-exporter.js';
import { NotebookProposalService } from './notebook-proposal-service.js';
import { NotebookManifestBuilder } from './notebook-manifest.js';
import { ProposalStatus } from '../core/types.js';

export class NotebookCLI {
  private readonly exporter: NotebookExporter;
  private readonly proposalService: NotebookProposalService;
  private readonly manifestBuilder: NotebookManifestBuilder;

  constructor(db: DatabaseSync, private readonly projectRoot: string) {
    this.exporter = new NotebookExporter(db, projectRoot);
    this.proposalService = new NotebookProposalService(db, projectRoot);
    this.manifestBuilder = new NotebookManifestBuilder(projectRoot);
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  public async run(args: string[]): Promise<string> {
    if (args.length === 0) return this.renderHelp();

    let idx = 0;
    // Skip leading "notebook" token if present
    if (args[idx]?.toLowerCase() === 'notebook') idx++;

    const subCommand = args[idx]?.toLowerCase();
    idx++;

    switch (subCommand) {
      case 'export':
        return this.handleExport(args.slice(idx));

      case 'manifest':
        return this.handleManifest(args.slice(idx));

      case 'proposal':
        return this.handleProposal(args.slice(idx));

      default:
        return this.renderHelp();
    }
  }

  // ---------------------------------------------------------------------------
  // notebook export
  // ---------------------------------------------------------------------------

  private async handleExport(args: string[]): Promise<string> {
    const projectId = this.extractOption(args, '--project-id');
    const outDir    = this.extractOption(args, '--out-dir');

    const result = await this.exporter.export({ projectId, outDir });

    const lines: string[] = [
      '='.repeat(72),
      '  NOTEBOOKLM KNOWLEDGE PACK EXPORT',
      '='.repeat(72),
      `  Project ID   : ${result.projectId}`,
      `  Output dir   : ${result.outDir}`,
      `  Files        : ${result.exportedFiles.length}`,
      `  Sources      : ${result.manifest.totalSources}`,
      `  Words        : ${result.manifest.totalWords.toLocaleString()}`,
      `  Token est.   : ${result.manifest.totalTokens.toLocaleString()}`,
      '='.repeat(72),
      '',
      'Exported files:',
    ];

    for (const f of result.exportedFiles) {
      lines.push(`  ${f}`);
    }

    if (result.warnings.length > 0) {
      lines.push('', 'Warnings:');
      for (const w of result.warnings) {
        lines.push(`  ⚠  ${w}`);
      }
    }

    lines.push('');
    lines.push('✓ Ready to upload .ai/notebook/ to Google Drive for NotebookLM.');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // notebook manifest
  // ---------------------------------------------------------------------------

  private async handleManifest(args: string[]): Promise<string> {
    const projectId = this.extractOption(args, '--project-id');
    const isJson = args.includes('--json');
    const shouldWrite = args.includes('--write');
    const outDir = this.extractOption(args, '--out-dir') ?? path.join(this.projectRoot, '.ai', 'notebook');

    const manifest = this.manifestBuilder.build({ projectId });

    if (shouldWrite) {
      fs.mkdirSync(outDir, { recursive: true });
      const manifestPath = path.join(outDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }

    if (isJson) {
      return JSON.stringify(manifest, null, 2);
    }

    const lines: string[] = [
      '='.repeat(72),
      '  NOTEBOOKLM KNOWLEDGE MANIFEST',
      '='.repeat(72),
      `  Project ID   : ${manifest.projectId}`,
      `  Version      : ${manifest.version}`,
      `  Generated    : ${new Date(manifest.generatedAt).toISOString()}`,
      `  Total Sources: ${manifest.totalSources}`,
      `  Total Words  : ${manifest.totalWords.toLocaleString()}`,
      `  Token Est.   : ${manifest.totalTokens.toLocaleString()}`,
      `  Firewall     : ${manifest.firewallVerified ? '✓ VERIFIED (Strict)' : '⚠ UNVERIFIED'}`,
      '='.repeat(72),
      '',
      'Discovered Knowledge Sources:',
    ];

    if (manifest.sources.length === 0) {
      lines.push('  (No canonical sources found)');
    } else {
      for (const s of manifest.sources) {
        lines.push(`  - [${s.category.padEnd(18)}] ${s.relativePath.padEnd(35)} (${s.wordCount} words, ~${s.tokenEstimate} tokens)`);
      }
    }

    lines.push('');
    lines.push('Firewall Exclusions:');
    for (const p of manifest.excludedPatterns.slice(0, 10)) {
      lines.push(`  ✗ ${p}`);
    }
    if (manifest.excludedPatterns.length > 10) {
      lines.push(`  ... and ${manifest.excludedPatterns.length - 10} more patterns`);
    }

    if (shouldWrite) {
      lines.push('', `✓ Manifest written to ${path.join(outDir, 'manifest.json')}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // notebook proposal <sub>
  // ---------------------------------------------------------------------------

  private async handleProposal(args: string[]): Promise<string> {
    const sub = args[0]?.toLowerCase();

    switch (sub) {
      case 'create':   return this.proposalCreate(args.slice(1));
      case 'ingest':   return this.proposalIngest(args.slice(1));
      case 'list':     return this.proposalList(args.slice(1));
      case 'show':     return this.proposalShow(args.slice(1));
      case 'approve':  return this.proposalApprove(args.slice(1));
      case 'reject':   return this.proposalReject(args.slice(1));
      default:         return this.renderProposalHelp();
    }
  }

  private proposalCreate(args: string[]): string {
    const projectId      = this.extractOption(args, '--project-id');
    const title          = this.extractOption(args, '--title');
    const question       = this.extractOption(args, '--question');
    const confidence     = this.extractOption(args, '--confidence');
    const taskId         = this.extractOption(args, '--task-id');

    if (!projectId) return 'Error: --project-id is required';
    if (!title)     return 'Error: --title is required';
    if (!question)  return 'Error: --question is required';

    const proposal = this.proposalService.createProposal({
      projectId,
      taskId,
      title,
      question,
      confidence: (confidence as 'low' | 'medium' | 'high' | 'experimental') || 'medium',
    });

    return this.renderProposal(proposal);
  }

  private proposalIngest(args: string[]): string {
    const file      = args[0];
    const projectId = this.extractOption(args, '--project-id');

    if (!file)      return 'Error: file path is required (notebook proposal ingest <file>)';
    if (!projectId) return 'Error: --project-id is required';

    const proposal = this.proposalService.ingestFromMarkdown(file, projectId);
    return `✓ Ingested proposal ${proposal.id}: ${proposal.title}\n` + this.renderProposal(proposal);
  }

  private proposalList(args: string[]): string {
    const projectId  = this.extractOption(args, '--project-id');
    const statusRaw  = this.extractOption(args, '--status');

    if (!projectId) return 'Error: --project-id is required';

    const proposals = this.proposalService.listProposals(
      projectId,
      statusRaw as ProposalStatus | undefined
    );

    if (proposals.length === 0) {
      return `No proposals found for project ${projectId}${statusRaw ? ` with status '${statusRaw}'` : ''}.`;
    }

    const lines = [
      '='.repeat(72),
      '  RESEARCH PROPOSALS',
      '='.repeat(72),
      '',
    ];

    for (const p of proposals) {
      lines.push(`  ${p.id.padEnd(20)} [${p.status.padEnd(12)}] [${p.confidence.padEnd(12)}] ${p.title}`);
    }

    lines.push('', `  Total: ${proposals.length}`);
    return lines.join('\n');
  }

  private proposalShow(args: string[]): string {
    const id = args[0];
    if (!id) return 'Error: proposal ID is required (notebook proposal show <ID>)';
    const proposal = this.proposalService.getProposal(id);
    return this.proposalService.renderProposalMarkdown(proposal);
  }

  private proposalApprove(args: string[]): string {
    const id         = args[0];
    const reviewedBy = this.extractOption(args, '--reviewed-by');

    if (!id) return 'Error: proposal ID is required (notebook proposal approve <ID>)';

    const proposal = this.proposalService.approveProposal(id, reviewedBy);

    return [
      `✓ Proposal ${id} approved.`,
      `  Status            : ${proposal.status}`,
      `  Promoted decision : ${proposal.promotedDecisionId ?? 'n/a'}`,
      `  Reviewed by       : ${proposal.reviewedBy ?? 'agent'}`,
    ].join('\n');
  }

  private proposalReject(args: string[]): string {
    const id         = args[0];
    const comment    = this.extractOption(args, '--comment');
    const reviewedBy = this.extractOption(args, '--reviewed-by');

    if (!id) return 'Error: proposal ID is required (notebook proposal reject <ID>)';

    const proposal = this.proposalService.rejectProposal(id, comment, reviewedBy);

    return [
      `✓ Proposal ${id} rejected.`,
      `  Status      : ${proposal.status}`,
      `  Reviewed by : ${proposal.reviewedBy ?? 'agent'}`,
      comment ? `  Comment     : ${comment}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private renderProposal(p: {
    id: string;
    title: string;
    status: string;
    confidence: string;
    question: string;
    findings?: string;
    promotedDecisionId?: string;
    createdAt: number;
  }): string {
    return [
      '='.repeat(72),
      `  ID         : ${p.id}`,
      `  Title      : ${p.title}`,
      `  Status     : ${p.status}`,
      `  Confidence : ${p.confidence}`,
      `  Question   : ${p.question.slice(0, 80)}`,
      ...(p.findings ? [`  Findings   : ${p.findings.slice(0, 80)}...`] : []),
      ...(p.promotedDecisionId ? [`  Decision   : ${p.promotedDecisionId}`] : []),
      `  Created    : ${new Date(p.createdAt).toISOString().slice(0, 10)}`,
      '='.repeat(72),
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractOption(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }

  private renderHelp(): string {
    return [
      'notebook – NotebookLM Knowledge Bridge',
      '',
      'USAGE:',
      '  notebook export [--project-id ID] [--out-dir DIR]',
      '  notebook manifest [--project-id ID] [--json] [--write] [--out-dir DIR]',
      '  notebook proposal create --project-id ID --title "..." --question "..."',
      '  notebook proposal ingest <file> --project-id ID',
      '  notebook proposal list --project-id ID [--status STATUS]',
      '  notebook proposal show <PROPOSAL-ID>',
      '  notebook proposal approve <PROPOSAL-ID> [--reviewed-by NAME]',
      '  notebook proposal reject  <PROPOSAL-ID> [--comment "..."] [--reviewed-by NAME]',
      '',
      'STATUS values: draft | under_review | approved | rejected | implemented',
    ].join('\n');
  }

  private renderProposalHelp(): string {
    return [
      'notebook proposal <sub-command>',
      '',
      'Sub-commands:',
      '  create   – Create a new draft proposal',
      '  ingest   – Import a proposal from a Markdown file',
      '  list     – List proposals for a project',
      '  show     – Show full proposal details',
      '  approve  – Approve a proposal (promotes to ADR)',
      '  reject   – Reject a proposal',
    ].join('\n');
  }
}
