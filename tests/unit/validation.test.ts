import { describe, it, expect } from 'vitest';
import { ValidationEngine } from '../../src/validation/validator.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ValidationEngine', () => {
  const validator = new ValidationEngine();

  it('should validate canonical structure in repository root', async () => {
    const projectRoot = path.resolve(__dirname, '../../');
    const result = await validator.validateCanonicalStructure(projectRoot);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing canonical files if root is empty', async () => {
    const result = await validator.validateCanonicalStructure('/tmp/non_existent_project');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
