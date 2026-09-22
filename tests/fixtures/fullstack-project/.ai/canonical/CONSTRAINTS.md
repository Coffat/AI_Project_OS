# System Constraints

## SEC-001: OAuth CSRF Protection
OAuth callback handlers MUST cryptographically validate the returned `state` parameter against the session cookie before exchanging authorization codes.

## SEC-002: Token Security
JWT signing secret must be injected via environment variables; never hardcoded in source code.

## DB-001: SQL Parameter Binding
All queries in database models must use parameterized statements to prevent SQL injection vulnerabilities.
