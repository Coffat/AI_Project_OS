/**
 * AI PROJECT OS - Core Error Hierarchy
 */

export class AIProjectOSError extends Error {
  constructor(message: string, public readonly code: string = 'AI_OS_ERROR') {
    super(message);
    this.name = 'AIProjectOSError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TaskNotFoundError extends AIProjectOSError {
  constructor(taskId: string) {
    super(`Task not found with ID: ${taskId}`, 'TASK_NOT_FOUND');
    this.name = 'TaskNotFoundError';
  }
}

export class ValidationError extends AIProjectOSError {
  constructor(message: string, public readonly validationDetails?: unknown) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends AIProjectOSError {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class IntegrityError extends AIProjectOSError {
  constructor(message: string) {
    super(message, 'INTEGRITY_ERROR');
    this.name = 'IntegrityError';
  }
}
