import ts from 'typescript';
import {
  AstAnalysisResult,
  ImportInfo,
  ExportInfo,
  CallInfo,
  ImplementsInfo,
  TestInfo,
  ApiInfo,
  DatabaseModelInfo,
} from '../core/types.js';

export class ASTAnalyzer {
  /**
   * Analyzes source code content and extracts all code intelligence entities.
   */
  public analyze(filePath: string, content: string): AstAnalysisResult {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

    if (ext === 'json') {
      return this.analyzeJson(filePath, content);
    }

    if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
      return this.analyzeTypeScript(filePath, content);
    }

    if (ext === 'sql') {
      return this.analyzeSql(filePath, content);
    }

    if (ext === 'prisma') {
      return this.analyzePrisma(filePath, content);
    }

    // Generic fallback for other languages
    return {
      filePath,
      language: ext || 'unknown',
      symbols: [],
      imports: [],
      exports: [],
      calls: [],
      implements: [],
      tests: [],
      apis: [],
      models: [],
    };
  }

  private analyzeTypeScript(filePath: string, content: string): AstAnalysisResult {
    const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const symbols: AstAnalysisResult['symbols'] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];
    const calls: CallInfo[] = [];
    const implementsList: ImplementsInfo[] = [];
    const tests: TestInfo[] = [];
    const apis: ApiInfo[] = [];
    const models: DatabaseModelInfo[] = [];

    let currentCaller: string | undefined = undefined;

    const getLineRange = (node: ts.Node): { lineStart: number; lineEnd: number } => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      return {
        lineStart: start.line + 1,
        lineEnd: end.line + 1,
      };
    };

    const getDocstring = (node: ts.Node): string | undefined => {
      const fullText = sourceFile.getFullText();
      const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
      if (!ranges || ranges.length === 0) return undefined;
      return ranges
        .map((r) => fullText.substring(r.pos, r.end).trim())
        .join('\n');
    };

    const isExported = (node: ts.Node): boolean => {
      return (
        (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
        (node.parent && ts.isExportDeclaration(node.parent))
      );
    };

    const visit = (node: ts.Node): void => {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const sourceModule = (node.moduleSpecifier as ts.StringLiteral).text;
        const importClause = node.importClause;

        const specifiers: Array<{ name: string; alias?: string; isTypeOnly?: boolean }> = [];
        let isDefault = false;
        let defaultAlias: string | undefined = undefined;
        let isNamespace = false;
        let namespaceAlias: string | undefined = undefined;

        if (importClause) {
          if (importClause.name) {
            isDefault = true;
            defaultAlias = importClause.name.text;
          }

          if (importClause.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              isNamespace = true;
              namespaceAlias = importClause.namedBindings.name.text;
            } else if (ts.isNamedImports(importClause.namedBindings)) {
              for (const elem of importClause.namedBindings.elements) {
                specifiers.push({
                  name: elem.propertyName ? elem.propertyName.text : elem.name.text,
                  alias: elem.propertyName ? elem.name.text : undefined,
                  isTypeOnly: elem.isTypeOnly || importClause.isTypeOnly,
                });
              }
            }
          }
        }

        imports.push({
          sourceModule,
          specifiers,
          isDefault,
          defaultAlias,
          isNamespace,
          namespaceAlias,
          lineStart,
          lineEnd,
        });
      }

      // 2. Export Declarations (e.g. export { a, b as c })
      if (ts.isExportDeclaration(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            exports.push({
              name: el.propertyName ? el.propertyName.text : el.name.text,
              exportedName: el.name.text,
              isDefault: false,
              kind: 'variable',
              lineStart,
              lineEnd,
            });
          }
        }
      }

      // Export default assignment
      if (ts.isExportAssignment(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const expr = node.expression;
        const name = ts.isIdentifier(expr) ? expr.text : 'default';
        exports.push({
          name,
          exportedName: 'default',
          isDefault: true,
          kind: 'variable',
          lineStart,
          lineEnd,
        });
      }

      // 3. Class Declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const { lineStart, lineEnd } = getLineRange(node);
        const name = node.name.text;
        const docstring = getDocstring(node);

        symbols.push({
          name,
          kind: 'class',
          lineStart,
          lineEnd,
          signature: `class ${name}`,
          docstring,
        });

        if (isExported(node)) {
          exports.push({
            name,
            exportedName: name,
            isDefault: (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0,
            kind: 'class',
            lineStart,
            lineEnd,
          });
        }

        // Check implements
        if (node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const typeNode of hc.types) {
                const ifaceName = typeNode.expression.getText(sourceFile);
                implementsList.push({
                  className: name,
                  interfaceName: ifaceName,
                  lineStart,
                  lineEnd,
                });
              }
            }
          }
        }

        // Traverse class members
        const prevCaller = currentCaller;
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name) {
            const memberRange = getLineRange(member);
            const memberName = member.name.getText(sourceFile);
            const methodFullName = `${name}.${memberName}`;

            symbols.push({
              name: methodFullName,
              kind: 'method',
              lineStart: memberRange.lineStart,
              lineEnd: memberRange.lineEnd,
              signature: `${methodFullName}(...)`,
              docstring: getDocstring(member),
              parentSymbolName: name,
            });

            currentCaller = methodFullName;
            ts.forEachChild(member, visit);
            currentCaller = prevCaller;
          }
        }
        return; // already handled members
      }

      // 4. Interfaces
      if (ts.isInterfaceDeclaration(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const name = node.name.text;
        symbols.push({
          name,
          kind: 'interface',
          lineStart,
          lineEnd,
          signature: `interface ${name}`,
          docstring: getDocstring(node),
        });

        if (isExported(node)) {
          exports.push({
            name,
            exportedName: name,
            isDefault: false,
            kind: 'interface',
            lineStart,
            lineEnd,
          });
        }
      }

      // 5. Type Aliases
      if (ts.isTypeAliasDeclaration(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const name = node.name.text;
        symbols.push({
          name,
          kind: 'type',
          lineStart,
          lineEnd,
          signature: `type ${name}`,
          docstring: getDocstring(node),
        });

        if (isExported(node)) {
          exports.push({
            name,
            exportedName: name,
            isDefault: false,
            kind: 'type',
            lineStart,
            lineEnd,
          });
        }
      }

      // 6. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const { lineStart, lineEnd } = getLineRange(node);
        const name = node.name.text;
        const docstring = getDocstring(node);

        symbols.push({
          name,
          kind: 'function',
          lineStart,
          lineEnd,
          signature: `function ${name}(...)`,
          docstring,
        });

        if (isExported(node)) {
          exports.push({
            name,
            exportedName: name,
            isDefault: (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0,
            kind: 'function',
            lineStart,
            lineEnd,
          });

          // Check if this is an API handler (Next.js App router conventions: GET, POST, PUT, DELETE, PATCH)
          if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(name.toUpperCase())) {
            apis.push({
              httpMethod: name.toUpperCase(),
              routePath: filePath,
              handlerName: name,
              lineStart,
              lineEnd,
            });
          }
        }

        const prevCaller = currentCaller;
        currentCaller = name;
        ts.forEachChild(node, visit);
        currentCaller = prevCaller;
        return;
      }

      // 7. Variable Statements (constants, arrow functions, Drizzle/Prisma models)
      if (ts.isVariableStatement(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const isExp = isExported(node);

        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const varName = decl.name.text;
            const isFn = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));

            // Check if Drizzle / ORM model table: sqliteTable('users', ...), pgTable(...)
            if (decl.initializer && ts.isCallExpression(decl.initializer)) {
              const calleeText = decl.initializer.expression.getText(sourceFile);
              if (calleeText.includes('Table') || calleeText.includes('entity') || calleeText.includes('model')) {
                models.push({
                  modelName: varName,
                  modelType: 'table',
                  lineStart,
                  lineEnd,
                });
                symbols.push({
                  name: varName,
                  kind: 'model',
                  lineStart,
                  lineEnd,
                  signature: `model ${varName}`,
                  docstring: getDocstring(node),
                });
              }
            }

            if (isFn) {
              symbols.push({
                name: varName,
                kind: 'function',
                lineStart,
                lineEnd,
                signature: `const ${varName} = (...) => ...`,
                docstring: getDocstring(node),
              });
            } else if (!models.some((m) => m.modelName === varName)) {
              symbols.push({
                name: varName,
                kind: 'variable',
                lineStart,
                lineEnd,
                signature: `const ${varName}`,
                docstring: getDocstring(node),
              });
            }

            if (isExp) {
              exports.push({
                name: varName,
                exportedName: varName,
                isDefault: false,
                kind: isFn ? 'function' : 'variable',
                lineStart,
                lineEnd,
              });
            }

            if (isFn && decl.initializer) {
              const prevCaller = currentCaller;
              currentCaller = varName;
              ts.forEachChild(decl.initializer, visit);
              currentCaller = prevCaller;
            }
          }
        }
      }

      // 8. Call Expressions & Tests & Express/Hono API routes
      if (ts.isCallExpression(node)) {
        const { lineStart, lineEnd } = getLineRange(node);
        const calleeText = node.expression.getText(sourceFile);

        // Check if test block: describe, test, it, suite
        if (['describe', 'test', 'it', 'suite'].includes(calleeText)) {
          const testNameArg = node.arguments[0];
          const testName = testNameArg && ts.isStringLiteral(testNameArg) ? testNameArg.text : 'anonymous test';
          const calledSymbols: string[] = [];

          // Collect calls inside test body
          const collectCallsInTest = (child: ts.Node): void => {
            if (ts.isCallExpression(child) && child !== node) {
              const called = child.expression.getText(sourceFile);
              if (!['describe', 'test', 'it', 'expect', 'assert'].includes(called)) {
                calledSymbols.push(called);
              }
            }
            ts.forEachChild(child, collectCallsInTest);
          };

          if (node.arguments[1]) {
            collectCallsInTest(node.arguments[1]);
          }

          tests.push({
            testName,
            suiteName: calleeText === 'describe' ? testName : undefined,
            calledSymbols: Array.from(new Set(calledSymbols)),
            lineStart,
            lineEnd,
          });
        }

        // Check if API route handler: app.get('/...', ...), router.post('/...', ...)
        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text.toLowerCase();
          if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
            const firstArg = node.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              apis.push({
                httpMethod: method.toUpperCase(),
                routePath: firstArg.text,
                handlerName: `${method.toUpperCase()} ${firstArg.text}`,
                lineStart,
                lineEnd,
              });
            }
          }
        }

        // General Call tracking
        calls.push({
          callerSymbolName: currentCaller,
          calleeName: calleeText,
          lineStart,
          lineEnd,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      filePath,
      language: isJsx ? 'typescriptreact' : 'typescript',
      symbols,
      imports,
      exports,
      calls,
      implements: implementsList,
      tests,
      apis,
      models,
    };
  }

  private analyzeJson(filePath: string, content: string): AstAnalysisResult {
    const symbols: AstAnalysisResult['symbols'] = [];
    const imports: ImportInfo[] = [];

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // package.json dependencies
      if (filePath.endsWith('package.json')) {
        const deps = {
          ...(parsed['dependencies'] as Record<string, string> | undefined),
          ...(parsed['devDependencies'] as Record<string, string> | undefined),
        };

        for (const dep of Object.keys(deps)) {
          imports.push({
            sourceModule: dep,
            specifiers: [],
            isDefault: false,
            isNamespace: false,
            lineStart: 1,
            lineEnd: 1,
          });
        }

        symbols.push({
          name: String(parsed['name'] ?? 'package'),
          kind: 'variable',
          lineStart: 1,
          lineEnd: 1,
          signature: `Package: ${parsed['name']}`,
        });
      }
    } catch {
      // ignore invalid JSON
    }

    return {
      filePath,
      language: 'json',
      symbols,
      imports,
      exports: [],
      calls: [],
      implements: [],
      tests: [],
      apis: [],
      models: [],
    };
  }

  private analyzeSql(filePath: string, content: string): AstAnalysisResult {
    const models: DatabaseModelInfo[] = [];
    const symbols: AstAnalysisResult['symbols'] = [];

    // Match CREATE TABLE [IF NOT EXISTS] tableName
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        const tableName = match[1];
        if (tableName) {
          models.push({
            modelName: tableName,
            modelType: 'table',
            lineStart: i + 1,
            lineEnd: i + 1,
          });
          symbols.push({
            name: tableName,
            kind: 'model',
            lineStart: i + 1,
            lineEnd: i + 1,
            signature: `TABLE ${tableName}`,
          });
        }
      }
    }

    return {
      filePath,
      language: 'sql',
      symbols,
      imports: [],
      exports: [],
      calls: [],
      implements: [],
      tests: [],
      apis: [],
      models,
    };
  }

  private analyzePrisma(filePath: string, content: string): AstAnalysisResult {
    const models: DatabaseModelInfo[] = [];
    const symbols: AstAnalysisResult['symbols'] = [];

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? '';
      const match = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{/);
      if (match && match[1]) {
        const name = match[1];
        models.push({
          modelName: name,
          modelType: 'model' as unknown as 'table',
          lineStart: i + 1,
          lineEnd: i + 1,
        });
        symbols.push({
          name,
          kind: 'model',
          lineStart: i + 1,
          lineEnd: i + 1,
          signature: `model ${name}`,
        });
      }
    }

    return {
      filePath,
      language: 'prisma',
      symbols,
      imports: [],
      exports: [],
      calls: [],
      implements: [],
      tests: [],
      apis: [],
      models,
    };
  }
}
