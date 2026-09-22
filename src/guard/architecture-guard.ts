import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ASTAnalyzer } from '../code-intelligence/ast-analyzer.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import { AstAnalysisResult } from '../core/types.js';
import {
  ArchitectureGuardReport,
  ArchitectureViolation,
  ArchitectureBoundaryRule,
  GuardEvaluationOptions,
  PreImplementationContext,
  DiscoveredAbstraction,
  DiscoveredService,
  DiscoveredUtility,
  DiscoveredDependency,
} from './types.js';

// Default architectural boundary rules for AI Project OS
export const DEFAULT_BOUNDARY_RULES: ArchitectureBoundaryRule[] = [
  {
    id: 'boundary:ui-no-direct-db',
    name: 'UI must not import Database layer directly',
    sourcePattern: /(?:^|[/\\])(?:views|components)[/\\]|^(?:ui)[/\\]/,
    forbiddenImportPatterns: [
      /(?:^|[/\\])(?:database|repositories|sqlite|db)[/\\]/,
      /node:sqlite/,
      /better-sqlite3/,
    ],
    severity: 'error',
    message: 'UI components must communicate exclusively via Application Services / API, not direct database access.',
  },
  {
    id: 'boundary:core-no-ui-or-cli',
    name: 'Core domain must not depend on UI, Adapters, or CLI',
    sourcePattern: /(?:^|[/\\])src[/\\]core[/\\]/,
    forbiddenImportPatterns: [
      /(?:^|[/\\])(?:ui|cli|adapters|presentation)[/\\]/,
    ],
    severity: 'error',
    message: 'Core domain layer must remain pure and free from UI or delivery mechanism dependencies.',
  },
  {
    id: 'boundary:models-no-api',
    name: 'Models must not depend on API/Controllers',
    sourcePattern: /(?:^|[/\\])(?:models|entities)[/\\]/,
    forbiddenImportPatterns: [
      /(?:^|[/\\])(?:api|controllers|routes|handlers)[/\\]/,
    ],
    severity: 'error',
    message: 'Domain models must not depend on higher-level API routes or HTTP controllers.',
  },
];

// Known duplicate dependency groups (adding both is bloat)
export const KNOWN_DUPLICATE_DEPENDENCY_GROUPS: Record<string, string[]> = {
  utility: ['lodash', 'lodash-es', 'underscore', 'ramda', 'radash'],
  http: ['axios', 'node-fetch', 'got', 'superagent', 'undici', 'ky', 'request'],
  date: ['moment', 'dayjs', 'date-fns', 'luxon'],
  validation: ['zod', 'yup', 'joi', 'superstruct', 'valibot'],
  testing: ['vitest', 'jest', 'mocha', 'ava'],
};

export class ArchitectureGuard {
  private readonly astAnalyzer: ASTAnalyzer;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly graphRepo?: GraphRepository;

  constructor(
    private readonly projectRoot: string = process.cwd(),
    db?: DatabaseSync,
    gitAnalyzer?: GitAnalyzer
  ) {
    this.astAnalyzer = new ASTAnalyzer();
    this.gitAnalyzer = gitAnalyzer ?? new GitAnalyzer();
    if (db) {
      this.graphRepo = new GraphRepository(db);
    }
  }

  public getGraphRepository(): GraphRepository | undefined {
    return this.graphRepo;
  }

  /**
   * Evaluates the working tree or given changes against all architecture rules.
   */
  public async evaluate(options: GuardEvaluationOptions = {}): Promise<ArchitectureGuardReport> {
    const violations: ArchitectureViolation[] = [];
    const boundaryRules = options.boundaryRules ?? DEFAULT_BOUNDARY_RULES;

    // 1. Inspect working tree changes
    const gitChanges = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
    let modifiedFiles = [...gitChanges.added, ...gitChanges.modified];

    const isTestingRoot =
      this.projectRoot.includes('tests') || this.projectRoot.includes('fixtures');
    if (!isTestingRoot) {
      modifiedFiles = modifiedFiles.filter(
        (f) => !f.startsWith('tests/') && !f.includes('/tests/') && !f.includes('fixtures/')
      );
    }

    // 2. Scan all project files for baseline context
    const allSourceFiles = this.getAllSourceFiles(this.projectRoot);

    // 3. Run Rule: Circular Dependency Check
    const circularViolations = this.checkCircularDependency(this.projectRoot, allSourceFiles);
    violations.push(...circularViolations);

    // 4. Run Rule: Architecture Boundary Violations
    const boundaryViolations = this.checkArchitectureBoundaryViolations(
      allSourceFiles,
      boundaryRules
    );
    violations.push(...boundaryViolations);

    // 5. Run Rule: Unrelated File Modifications (if task declared scope files exist)
    if (options.declaredScopeFiles && options.declaredScopeFiles.length > 0) {
      const unrelatedViolations = this.checkUnrelatedFileModifications(
        modifiedFiles,
        options.declaredScopeFiles
      );
      violations.push(...unrelatedViolations);
    }

    // 6. Run Rule: Dependency Duplication & Unused Dependencies
    const dependencyViolations = this.checkDependencies(this.projectRoot, allSourceFiles);
    violations.push(...dependencyViolations);

    // 7. Run Rule: Duplicate Functionality & Unnecessary Abstraction in modified/added files
    const codeQualityViolations = this.checkCodeAbstractionsAndDuplication(
      modifiedFiles.length > 0 ? modifiedFiles : allSourceFiles,
      allSourceFiles
    );
    violations.push(...codeQualityViolations);

    // Filter approved violations if any
    const approvedSet = new Set(options.approvedViolations ?? []);
    const activeViolations = violations.filter((v) => !approvedSet.has(v.ruleId));

    // Calculate summary
    const warnings = activeViolations.filter((v) => v.severity === 'warning').length;
    const approvalRequired = activeViolations.filter((v) => v.severity === 'approval_required').length;
    const errors = activeViolations.filter((v) => v.severity === 'error').length;
    const total = activeViolations.length;

    const blocked = errors > 0 || (options.strictMode ? approvalRequired > 0 : false);
    const passed = errors === 0 && approvalRequired === 0;

    return {
      passed,
      blocked,
      summary: {
        warnings,
        approvalRequired,
        errors,
        total,
      },
      violations: activeViolations,
      checkedAt: Date.now(),
    };
  }

  /**
   * Pre-implementation Knowledge: discovers existing abstractions, services, utilities, and dependencies.
   */
  public async getPreImplementationContext(
    targetKeywords: string[] = []
  ): Promise<PreImplementationContext> {
    const allSourceFiles = this.getAllSourceFiles(this.projectRoot);
    const abstractions: DiscoveredAbstraction[] = [];
    const services: DiscoveredService[] = [];
    const utilities: DiscoveredUtility[] = [];

    for (const relFile of allSourceFiles) {
      const fullPath = path.resolve(this.projectRoot, relFile);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ast = this.astAnalyzer.analyze(relFile, content);
        const { classes, interfaces, functions } = this.extractClassInfo(ast);

        // Discovered Abstractions (interfaces)
        for (const iface of interfaces) {
          abstractions.push({
            name: iface.name,
            kind: 'interface',
            filePath: relFile,
            description: iface.signature ?? `Interface ${iface.name}`,
          });
        }

        // Discovered Classes (Services vs other abstractions)
        for (const cls of classes) {
          const isService =
            cls.name.toLowerCase().endsWith('service') ||
            cls.name.toLowerCase().endsWith('manager') ||
            cls.name.toLowerCase().endsWith('engine') ||
            cls.name.toLowerCase().endsWith('repository');

          if (isService) {
            services.push({
              name: cls.name,
              filePath: relFile,
              methods: cls.methods,
            });
          } else {
            abstractions.push({
              name: cls.name,
              kind: 'class',
              filePath: relFile,
              description: `Class with methods: ${cls.methods.join(', ')}`,
            });
          }
        }

        // Discovered Utilities (files with helper/util in path or pure functions)
        const isUtilFile =
          relFile.toLowerCase().includes('util') ||
          relFile.toLowerCase().includes('helper') ||
          relFile.toLowerCase().includes('common');

        if ((isUtilFile || functions.length > 0) && functions.length > 0) {
          utilities.push({
            name: path.basename(relFile, path.extname(relFile)),
            filePath: relFile,
            functions: functions.map((f) => f.name),
          });
        }
      } catch {
        // Skip files that fail parsing
      }
    }

    const dependencies = this.discoverExistingDependencies();

    // Filter or prioritize based on keywords if provided
    let filteredAbstractions = abstractions;
    let filteredServices = services;
    let filteredUtilities = utilities;

    if (targetKeywords.length > 0) {
      const lowerKws = targetKeywords.map((k) => k.toLowerCase());
      const matchesKw = (str: string) => lowerKws.some((kw) => str.toLowerCase().includes(kw));

      filteredAbstractions = abstractions.filter((a) => matchesKw(a.name) || matchesKw(a.filePath));
      filteredServices = services.filter((s) => matchesKw(s.name) || matchesKw(s.filePath));
      filteredUtilities = utilities.filter((u) => matchesKw(u.name) || matchesKw(u.filePath));

      // Fallback to general list if filter too aggressive
      if (filteredAbstractions.length === 0) filteredAbstractions = abstractions.slice(0, 10);
      if (filteredServices.length === 0) filteredServices = services.slice(0, 10);
      if (filteredUtilities.length === 0) filteredUtilities = utilities.slice(0, 10);
    }

    return {
      existingAbstractions: filteredAbstractions,
      existingServices: filteredServices,
      existingUtilities: filteredUtilities,
      existingDependencies: dependencies,
      relatedFiles: allSourceFiles.slice(0, 20),
    };
  }

  /**
   * Rule: Circular Dependency Check
   */
  public checkCircularDependency(
    projectRoot: string,
    sourceFiles: string[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const importGraph = new Map<string, string[]>();

    for (const file of sourceFiles) {
      const fullPath = path.resolve(projectRoot, file);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ast = this.astAnalyzer.analyze(file, content);
        const resolvedImports: string[] = [];

        for (const imp of ast.imports) {
          if (imp.sourceModule.startsWith('./') || imp.sourceModule.startsWith('../')) {
            const resolved = this.resolveRelativeImport(file, imp.sourceModule, sourceFiles);
            if (resolved) {
              resolvedImports.push(resolved);
            }
          }
        }
        importGraph.set(file, resolvedImports);
      } catch {
        // Skip unparseable files
      }
    }

    // Tarjan's / DFS cycle finder
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];
    const detectedCycles: string[][] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recStack.add(node);
      pathStack.push(node);

      const neighbors = importGraph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          const cycleStart = pathStack.indexOf(neighbor);
          if (cycleStart !== -1) {
            const cycle = [...pathStack.slice(cycleStart), neighbor];
            detectedCycles.push(cycle);
          }
        }
      }

      recStack.delete(node);
      pathStack.pop();
    };

    for (const file of sourceFiles) {
      if (!visited.has(file)) {
        dfs(file);
      }
    }

    // Deduplicate and record violations
    const seenCycles = new Set<string>();
    for (const cycle of detectedCycles) {
      const cycleKey = [...cycle].sort().join(' -> ');
      if (seenCycles.has(cycleKey)) continue;
      seenCycles.add(cycleKey);

      violations.push({
        ruleId: `circular:${cycle[0]}`,
        category: 'circular_dependency',
        severity: 'error',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        file: cycle[0],
        details: { cycle },
        suggestion: 'Refactor shared types or common logic into a standalone lower-level module to break the cycle.',
      });
    }

    return violations;
  }

  /**
   * Rule: Architecture Boundary Violations
   */
  public checkArchitectureBoundaryViolations(
    sourceFiles: string[],
    boundaryRules: ArchitectureBoundaryRule[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];

    for (const file of sourceFiles) {
      const fullPath = path.resolve(this.projectRoot, file);
      if (!fs.existsSync(fullPath)) continue;

      for (const rule of boundaryRules) {
        const matchesSource =
          typeof rule.sourcePattern === 'string'
            ? file.includes(rule.sourcePattern)
            : rule.sourcePattern.test(file);

        if (!matchesSource) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const ast = this.astAnalyzer.analyze(file, content);

          for (const imp of ast.imports) {
            for (const forbidden of rule.forbiddenImportPatterns) {
              const isForbidden =
                typeof forbidden === 'string'
                  ? imp.sourceModule.includes(forbidden)
                  : forbidden.test(imp.sourceModule);

              if (isForbidden) {
                violations.push({
                  ruleId: `${rule.id}:${file}:${imp.sourceModule}`,
                  category: 'architecture_boundary_violation',
                  severity: rule.severity,
                  message: `${rule.name}: ${rule.message} (in ${file} importing '${imp.sourceModule}')`,
                  file,
                  details: {
                    ruleId: rule.id,
                    ruleName: rule.name,
                    importedModule: imp.sourceModule,
                  },
                  suggestion: 'Route access through approved service interfaces rather than directly importing restricted layers.',
                });
              }
            }
          }
        } catch {
          // Skip unparseable
        }
      }
    }

    return violations;
  }

  /**
   * Rule: Unrelated File Modifications
   */
  public checkUnrelatedFileModifications(
    modifiedFiles: string[],
    declaredScopeFiles: string[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const scopeSet = new Set(declaredScopeFiles.map((f) => path.normalize(f)));

    for (const file of modifiedFiles) {
      const normalized = path.normalize(file);
      // If declared scope does not include this file
      if (!scopeSet.has(normalized)) {
        // Check if it's in the same parent directory or module
        const inScopeDir = declaredScopeFiles.some((s) => {
          const dir = path.dirname(s);
          return dir !== '.' && normalized.startsWith(dir);
        });

        if (!inScopeDir) {
          violations.push({
            ruleId: `scope:unrelated:${file}`,
            category: 'unrelated_file_modifications',
            severity: 'approval_required',
            message: `Modified file '${file}' is outside the declared task scope files [${declaredScopeFiles.join(', ')}].`,
            file,
            details: { declaredScopeFiles },
            suggestion: 'Revert modifications to this file or request explicit task scope expansion from supervisor.',
          });
        }
      }
    }

    return violations;
  }

  /**
   * Rule: Dependency Duplication & Unused Dependencies
   */
  public checkDependencies(
    projectRoot: string,
    sourceFiles: string[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const pkgPath = path.resolve(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return violations;

    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      return violations;
    }

    const prodDeps = Object.keys(pkg.dependencies || {});
    const allDeclaredDeps = [...prodDeps, ...Object.keys(pkg.devDependencies || {})];

    // Check 1: Duplicate / competing libraries within the same category
    for (const [category, competing] of Object.entries(KNOWN_DUPLICATE_DEPENDENCY_GROUPS)) {
      const present = competing.filter((dep) => allDeclaredDeps.includes(dep));
      if (present.length > 1) {
        violations.push({
          ruleId: `dependency:competing:${category}`,
          category: 'dependency_duplication',
          severity: 'approval_required',
          message: `Multiple competing packages in category '${category}' detected: [${present.join(', ')}].`,
          details: { category, packages: present },
          suggestion: `Standardize on a single ${category} package (e.g. '${present[0]}') to reduce bundle size and maintenance overhead.`,
        });
      }
    }

    // Check 2: Unused production dependencies
    const importedPackages = new Set<string>();
    for (const file of sourceFiles) {
      const fullPath = path.resolve(projectRoot, file);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ast = this.astAnalyzer.analyze(file, content);
        for (const imp of ast.imports) {
          if (!imp.sourceModule.startsWith('.') && !imp.sourceModule.startsWith('/')) {
            const parts = imp.sourceModule.split('/');
            const pkgName = imp.sourceModule.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
            if (pkgName) {
              importedPackages.add(pkgName);
            }
          }
        }
      } catch {
        // Skip unparseable
      }
    }

    for (const dep of prodDeps) {
      const ignoreUnused = ['typescript', 'tsx', 'ts-node', 'tauri'];
      if (ignoreUnused.includes(dep) || dep.includes('types')) continue;

      if (!importedPackages.has(dep)) {
        violations.push({
          ruleId: `dependency:unused:${dep}`,
          category: 'unused_dependency',
          severity: 'warning',
          message: `Production dependency '${dep}' is declared in package.json but never imported in any source file.`,
          details: { dependency: dep },
          suggestion: `Remove '${dep}' from package.json or move to devDependencies if only needed for tooling.`,
        });
      }
    }

    return violations;
  }

  /**
   * Rule: Duplicate Functionality & Unnecessary Abstraction
   */
  public checkCodeAbstractionsAndDuplication(
    modifiedFiles: string[],
    allSourceFiles: string[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const otherFiles = allSourceFiles.filter((f) => !modifiedFiles.includes(f));

    // Analyze existing classes and functions in other files
    const existingSymbols: Array<{ name: string; kind: string; file: string; methods: string[] }> = [];
    for (const file of otherFiles) {
      const fullPath = path.resolve(this.projectRoot, file);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ast = this.astAnalyzer.analyze(file, content);
        const { classes, functions } = this.extractClassInfo(ast);

        for (const cls of classes) {
          existingSymbols.push({
            name: cls.name,
            kind: 'class',
            file,
            methods: cls.methods,
          });
        }
        for (const fn of functions) {
          existingSymbols.push({
            name: fn.name,
            kind: 'function',
            file,
            methods: [],
          });
        }
      } catch {
        // Skip
      }
    }

    // Now analyze modified / newly added files
    for (const file of modifiedFiles) {
      const fullPath = path.resolve(this.projectRoot, file);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ast = this.astAnalyzer.analyze(file, content);
        const { classes } = this.extractClassInfo(ast);

        // 1. Check for Duplicate Functionality
        for (const cls of classes) {
          for (const existing of existingSymbols) {
            if (existing.kind !== 'class') continue;

            const similarity = this.calculateNameSimilarity(cls.name, existing.name);
            const methodOverlap = this.calculateMethodOverlap(cls.methods, existing.methods);

            // If similar name and method overlap
            const isDuplicate =
              (similarity >= 0.8 && methodOverlap >= 0.5) ||
              (similarity >= 0.7 && cls.methods.length > 0 && methodOverlap >= 0.6) ||
              (cls.name.toLowerCase() === existing.name.toLowerCase() && file !== existing.file);

            if (isDuplicate) {
              violations.push({
                ruleId: `duplicate:class:${file}:${cls.name}`,
                category: 'duplicate_functionality',
                severity: 'error',
                message: `Class '${cls.name}' in '${file}' appears to duplicate existing class '${existing.name}' in '${existing.file}' (similarity: ${Math.round(similarity * 100)}%, method overlap: ${Math.round(methodOverlap * 100)}%).`,
                file,
                symbol: cls.name,
                details: {
                  newClass: cls.name,
                  existingClass: existing.name,
                  existingFile: existing.file,
                  methodOverlap,
                },
                suggestion: `Reuse and extend '${existing.name}' in '${existing.file}' rather than creating a parallel duplicate service.`,
              });
            }
          }
        }

        // 2. Check for Unnecessary Abstraction (trivial passthrough wrappers)
        for (const cls of classes) {
          if (cls.methods.length > 0 && cls.methods.length <= 2) {
            const isTrivialPassthrough = this.isPassthroughClass(content, cls.name);
            if (isTrivialPassthrough) {
              violations.push({
                ruleId: `abstraction:trivial:${file}:${cls.name}`,
                category: 'unnecessary_abstraction',
                severity: 'approval_required',
                message: `Class '${cls.name}' in '${file}' appears to be a trivial pass-through abstraction with no distinct business logic.`,
                file,
                symbol: cls.name,
                suggestion: 'Eliminate the redundant wrapper layer and call the target dependency directly.',
              });
            }
          }
        }
      } catch {
        // Skip unparseable
      }
    }

    return violations;
  }

  // --- Helpers ---

  private extractClassInfo(ast: AstAnalysisResult): {
    classes: Array<{ name: string; signature?: string; methods: string[] }>;
    interfaces: Array<{ name: string; signature?: string }>;
    functions: Array<{ name: string; signature?: string }>;
  } {
    const classesMap = new Map<string, { name: string; signature?: string; methods: string[] }>();
    const interfaces: Array<{ name: string; signature?: string }> = [];
    const functions: Array<{ name: string; signature?: string }> = [];

    for (const sym of ast.symbols) {
      if (sym.kind === 'class') {
        if (!classesMap.has(sym.name)) {
          classesMap.set(sym.name, { name: sym.name, signature: sym.signature, methods: [] });
        }
      } else if (sym.kind === 'interface') {
        interfaces.push({ name: sym.name, signature: sym.signature });
      } else if (sym.kind === 'function') {
        functions.push({ name: sym.name, signature: sym.signature });
      } else if (sym.kind === 'method') {
        const parent = sym.parentSymbolName ?? (sym as { parentSymbol?: string }).parentSymbol;
        const methodName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
        if (parent) {
          const cls = classesMap.get(parent);
          if (cls) {
            cls.methods.push(methodName);
          } else {
            classesMap.set(parent, { name: parent, methods: [methodName] });
          }
        }
      }
    }

    return {
      classes: Array.from(classesMap.values()),
      interfaces,
      functions,
    };
  }

  private discoverExistingDependencies(): DiscoveredDependency[] {
    const pkgPath = path.resolve(this.projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps: DiscoveredDependency[] = [];

      for (const [name, version] of Object.entries(pkg.dependencies || {})) {
        deps.push({
          name,
          version: String(version),
          isDev: false,
          category: this.categorizePackage(name),
        });
      }

      for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
        deps.push({
          name,
          version: String(version),
          isDev: true,
          category: this.categorizePackage(name),
        });
      }

      return deps;
    } catch {
      return [];
    }
  }

  private categorizePackage(name: string): string {
    for (const [cat, pkgs] of Object.entries(KNOWN_DUPLICATE_DEPENDENCY_GROUPS)) {
      if (pkgs.includes(name)) return cat;
    }
    if (name.includes('react')) return 'ui';
    if (name.includes('test') || name.includes('vitest') || name.includes('jest')) return 'testing';
    if (name.includes('lint') || name.includes('type')) return 'tooling';
    return 'library';
  }

  private getAllSourceFiles(dir: string, baseDir = dir): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === 'ui/dist' ||
        entry.name === 'coverage' ||
        entry.name === '.ai' ||
        ((entry.name === 'tests' || entry.name === 'fixtures') &&
          !baseDir.includes('tests') &&
          !baseDir.includes('fixtures'))
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.getAllSourceFiles(fullPath, baseDir));
      } else if (
        entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.jsx')
      ) {
        const rel = path.relative(baseDir, fullPath);
        results.push(rel);
      }
    }

    return results;
  }

  private resolveRelativeImport(
    sourceFile: string,
    specifier: string,
    allFiles: string[]
  ): string | null {
    const dir = path.dirname(sourceFile);
    const targetBase = path.normalize(path.join(dir, specifier));
    const targetClean = targetBase.replace(/\.(js|jsx|ts|tsx)$/, '');

    const candidates = [
      targetBase,
      `${targetBase}.ts`,
      `${targetBase}.tsx`,
      `${targetBase}.js`,
      `${targetClean}.ts`,
      `${targetClean}.tsx`,
      `${targetClean}.js`,
      path.join(targetBase, 'index.ts'),
      path.join(targetBase, 'index.js'),
      path.join(targetClean, 'index.ts'),
      path.join(targetClean, 'index.js'),
    ];

    for (const c of candidates) {
      if (allFiles.includes(c)) return c;
    }

    return null;
  }

  private calculateNameSimilarity(a: string, b: string): number {
    const cleanA = a.replace(/^(I|Abstract|Base)/, '').toLowerCase();
    const cleanB = b.replace(/^(I|Abstract|Base)/, '').toLowerCase();

    if (cleanA === cleanB) return 1.0;

    // Stem endings (Service, Manager, Handler, Controller, Helper)
    const stems = ['service', 'manager', 'handler', 'controller', 'helper', 'util', 'utils'];
    let stemA = cleanA;
    let stemB = cleanB;
    for (const s of stems) {
      if (stemA.endsWith(s)) stemA = stemA.slice(0, -s.length);
      if (stemB.endsWith(s)) stemB = stemB.slice(0, -s.length);
    }

    if (stemA.length > 2 && stemB.length > 2 && stemA === stemB) {
      return 0.85; // e.g. UserService vs UserManager
    }

    // Levenshtein similarity
    const dist = this.levenshtein(cleanA, cleanB);
    const maxLen = Math.max(cleanA.length, cleanB.length);
    return maxLen === 0 ? 1.0 : Math.max(0, 1.0 - dist / maxLen);
  }

  private calculateMethodOverlap(methodsA: string[], methodsB: string[]): number {
    if (methodsA.length === 0 || methodsB.length === 0) return 0;
    const setB = new Set(methodsB);
    const common = methodsA.filter((m) => setB.has(m)).length;
    return common / Math.max(methodsA.length, methodsB.length);
  }

  private isPassthroughClass(content: string, className: string): boolean {
    const classBlockMatch = content.match(
      new RegExp(`class\\s+${className}[\\s\\S]*?\\n\\}`, 'm')
    );
    if (!classBlockMatch) return false;
    const classBody = classBlockMatch[0];

    // True passthrough classes are concise (<= 20 lines) and have no branching or complex logic
    const lines = classBody.split('\n');
    if (lines.length > 20) return false;

    // Reject if it contains conditionals, loops, or error handling
    if (/\b(if|switch|try|catch|while|for)\b/.test(classBody)) return false;

    return /return\s+(?:await\s+)?this\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\([^)]*\);?/.test(
      classBody
    );
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev: number[] = new Array<number>(m + 1);
    const curr: number[] = new Array<number>(m + 1);

    for (let j = 0; j <= m; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= n; i++) {
      curr[0] = i;
      const bChar = b.charAt(i - 1);
      for (let j = 1; j <= m; j++) {
        const cost = a.charAt(j - 1) === bChar ? 0 : 1;
        const insert = (curr[j - 1] ?? 0) + 1;
        const del = (prev[j] ?? 0) + 1;
        const subst = (prev[j - 1] ?? 0) + cost;
        curr[j] = Math.min(insert, del, subst);
      }
      prev = [...curr];
    }

    return prev[m] ?? 0;
  }
}
