# Architecture Overview

## Auth Subsystem
- Responsible for OAuth 2.0 authorization code flow with PKCE.
- Issues short-lived signed JWT access tokens (15m) and secure refresh tokens.
- Handles OAuth provider callback at `/api/auth/callback`.

## Database Subsystem
- Uses relational models with parameterized queries.
- Manages user profiles, credentials, and OAuth accounts.

## Frontend Subsystem
- Single-page application using React.
- Handles user login initiation and redirects to OAuth callback view.

## Billing Subsystem
- Manages Stripe invoices and subscriptions.
- Isolated from authentication and session management.

## Notifications Subsystem
- Handles transactional email delivery via SMTP.
- Decoupled from user authentication flow.
