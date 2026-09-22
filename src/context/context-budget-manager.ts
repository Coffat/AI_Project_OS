import {
  TokenBudgetManager,
  BudgetCandidate,
  PackingResult,
  PackingOptions,
} from './token-budget-manager.js';

export { BudgetCandidate, PackingResult, PackingOptions };

/**
 * ContextBudgetManager (Phase 6 / Phase 17).
 * Inherits from TokenBudgetManager to provide both legacy interface compatibility
 * and full Phase 17 hierarchical level budgeting (L0-L4) with detailed reporting.
 */
export class ContextBudgetManager extends TokenBudgetManager {}
