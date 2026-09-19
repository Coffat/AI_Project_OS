import { Task } from '../core/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface IValidationEngine {
  validateTaskForCompletion(task: Task): ValidationResult;
  validateCanonicalStructure(projectRoot: string): Promise<ValidationResult>;
}

export class ValidationEngine implements IValidationEngine {
  public validateTaskForCompletion(task: Task): ValidationResult {
    const errors: string[] = [];

    if (!task.title || task.title.trim().length === 0) {
      errors.push('Task must have a non-empty title');
    }
    if (task.status === 'done' && (!task.description || task.description.trim().length === 0)) {
      errors.push('Completed task must have a detailed description of what was accomplished');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public async validateCanonicalStructure(projectRoot: string): Promise<ValidationResult> {
    const requiredFiles = [
      path.join('.ai', 'canonical', 'PROJECT.md'),
      path.join('.ai', 'canonical', 'CONSTITUTION.md'),
      path.join('.ai', 'canonical', 'ARCHITECTURE.md'),
      path.join('.ai', 'canonical', 'CONSTRAINTS.md'),
    ];

    const missingFiles: string[] = [];

    for (const relPath of requiredFiles) {
      const fullPath = path.join(projectRoot, relPath);
      try {
        await fs.access(fullPath);
      } catch {
        missingFiles.push(relPath);
      }
    }

    return {
      isValid: missingFiles.length === 0,
      errors: missingFiles.map((f) => `Missing canonical file: ${f}`),
    };
  }
}
