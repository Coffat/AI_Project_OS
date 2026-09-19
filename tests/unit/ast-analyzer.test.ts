import { describe, it, expect } from 'vitest';
import { ASTAnalyzer } from '../../src/code-intelligence/ast-analyzer.js';

describe('ASTAnalyzer', () => {
  const analyzer = new ASTAnalyzer();

  it('extracts functions, docstrings, and line ranges correctly', () => {
    const code = `
/**
 * Calculates sum
 */
export function add(a: number, b: number): number {
  return a + b;
}
`;
    const result = analyzer.analyze('src/math.ts', code);
    expect(result.symbols.length).toBe(1);
    const sym = result.symbols[0];
    expect(sym?.name).toBe('add');
    expect(sym?.kind).toBe('function');
    expect(sym?.docstring).toContain('Calculates sum');
    expect(sym?.lineStart).toBe(5);
    expect(result.exports.length).toBe(1);
    expect(result.exports[0]?.name).toBe('add');
  });

  it('extracts classes, methods, and implements heritage', () => {
    const code = `
interface IService {
  execute(): void;
}

export class MyService implements IService {
  public execute(): void {
    console.log('done');
  }
}
`;
    const result = analyzer.analyze('src/service.ts', code);
    expect(result.symbols.some((s) => s.name === 'IService' && s.kind === 'interface')).toBe(true);
    expect(result.symbols.some((s) => s.name === 'MyService' && s.kind === 'class')).toBe(true);
    expect(result.symbols.some((s) => s.name === 'MyService.execute' && s.kind === 'method')).toBe(true);

    expect(result.implements.length).toBe(1);
    expect(result.implements[0]?.className).toBe('MyService');
    expect(result.implements[0]?.interfaceName).toBe('IService');
  });

  it('extracts imports with specifiers and defaults', () => {
    const code = `
import React, { useState, useEffect as useFx } from 'react';
import * as utils from './utils.js';
`;
    const result = analyzer.analyze('src/app.tsx', code);
    expect(result.imports.length).toBe(2);

    const reactImport = result.imports[0];
    expect(reactImport?.sourceModule).toBe('react');
    expect(reactImport?.isDefault).toBe(true);
    expect(reactImport?.defaultAlias).toBe('React');
    expect(reactImport?.specifiers).toHaveLength(2);
    expect(reactImport?.specifiers[1]?.alias).toBe('useFx');

    const utilsImport = result.imports[1];
    expect(utilsImport?.isNamespace).toBe(true);
    expect(utilsImport?.namespaceAlias).toBe('utils');
  });

  it('extracts call expressions and links to callers', () => {
    const code = `
function helper() {
  doWork();
}
`;
    const result = analyzer.analyze('src/helper.ts', code);
    expect(result.calls.some((c) => c.callerSymbolName === 'helper' && c.calleeName === 'doWork')).toBe(true);
  });

  it('detects test blocks and called symbols in tests', () => {
    const code = `
describe('Suite', () => {
  it('tests add', () => {
    expect(add(1, 2)).toBe(3);
  });
});
`;
    const result = analyzer.analyze('tests/calc.test.ts', code);
    expect(result.tests.length).toBe(2); // describe + it
    const itTest = result.tests.find((t) => t.testName === 'tests add');
    expect(itTest).toBeDefined();
    expect(itTest?.calledSymbols).toContain('add');
  });

  it('detects API routes and HTTP methods', () => {
    const code = `
app.get('/api/v1/health', (req, res) => res.send('ok'));
router.post('/api/v1/items', (req, res) => {});
`;
    const result = analyzer.analyze('src/routes.ts', code);
    expect(result.apis.length).toBe(2);
    expect(result.apis[0]?.httpMethod).toBe('GET');
    expect(result.apis[0]?.routePath).toBe('/api/v1/health');
    expect(result.apis[1]?.httpMethod).toBe('POST');
    expect(result.apis[1]?.routePath).toBe('/api/v1/items');
  });

  it('detects database models in TypeScript and SQL', () => {
    const tsCode = `
export const usersTable = sqliteTable('users', { id: 'text' });
`;
    const tsResult = analyzer.analyze('src/db.ts', tsCode);
    expect(tsResult.models.length).toBe(1);
    expect(tsResult.models[0]?.modelName).toBe('usersTable');

    const sqlCode = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY);
CREATE TABLE tasks (id TEXT PRIMARY KEY);
`;
    const sqlResult = analyzer.analyze('schema.sql', sqlCode);
    expect(sqlResult.models.length).toBe(2);
    expect(sqlResult.models[0]?.modelName).toBe('projects');
    expect(sqlResult.models[1]?.modelName).toBe('tasks');
  });
});
