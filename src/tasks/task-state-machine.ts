import { TaskStatus } from '../core/types.js';
import { ValidationError } from '../core/errors.js';

export class TaskStateMachine {
  private static readonly TRANSITION_MAP: Record<TaskStatus, TaskStatus[]> = {
    planned: ['in_progress', 'blocked'],
    in_progress: ['blocked', 'handoff', 'testing', 'done'],
    blocked: ['resumed', 'in_progress', 'handoff'],
    handoff: ['resumed', 'in_progress', 'blocked'],
    resumed: ['in_progress', 'testing', 'blocked'],
    testing: ['done', 'in_progress', 'blocked'],
    done: ['in_progress'], // Allow reopening if regressions occur
  };

  public static canTransition(current: TaskStatus, next: TaskStatus): boolean {
    const allowed = this.TRANSITION_MAP[current] ?? [];
    return allowed.includes(next);
  }

  public static assertTransition(current: TaskStatus, next: TaskStatus, taskId?: string): void {
    if (!this.canTransition(current, next)) {
      const taskSuffix = taskId ? ` for task ${taskId}` : '';
      throw new ValidationError(
        `Invalid task state transition from '${current}' to '${next}'${taskSuffix}. Allowed targets: [${(this.TRANSITION_MAP[current] ?? []).join(', ')}]`
      );
    }
  }

  public static getAllowedTransitions(current: TaskStatus): TaskStatus[] {
    return [...(this.TRANSITION_MAP[current] ?? [])];
  }
}
