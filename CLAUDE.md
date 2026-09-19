# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart UoS E-Service is an AI-assisted academic request management system for the University of Sharjah. It is a from-scratch rebuild of a prior senior-project prototype whose frontend was disorganized, whose database integration was incomplete, and whose AI agents were built separately from the app. This rebuild's goal is clean architecture, a clear folder structure, maintainable code, and proper end-to-end integration between frontend, backend, database, and AI agents.

The repository is currently in a pre-scaffolding state (README only). No frontend, backend, or build tooling has been created yet — do not assume any commands, folder structure, or files beyond what actually exists in the repo.

## Technology Stack

This is the current plan, not a permanent restriction (see "Changing the Stack" below).

**Frontend**
- React + TypeScript + Vite
- Tailwind CSS
- Reusable components, organized by feature

**Backend**
- Python + FastAPI, for protected workflows and AI agent execution

**Database and Auth**
- Reuses the team's existing Supabase PostgreSQL database (do not treat this as a fresh/empty database)
- Supabase Auth with pre-provisioned student and administrator accounts (no self-service signup)
- Row Level Security (RLS) protects student data
- Direct React-to-Supabase communication is allowed for authorized, RLS-protected operations
- FastAPI handles protected backend workflows and AI agent execution
- All schema, auth, and RLS changes must be coordinated with the database owner — this is a shared database, not one this project can freely migrate

**AI**
- Reuses and integrates the team's existing Python agents (do not rewrite these from scratch without review)
- Gemini as the LLM
- Gemini API keys and privileged database credentials live only on the backend, never in frontend code
- MongoDB may be added later if needed

## Changing the Stack

The stack above is a starting point, not a constraint for the life of the project. Before adding, replacing, or removing a technology or architectural decision:
1. Explain why the change is needed.
2. Explain how it affects the existing architecture and integrations.
3. Discuss advantages, disadvantages, and alternatives.
4. Get explicit approval before implementing a significant architectural change.
5. Update this file and relevant project docs after the change is approved and made.

## Application Domain

Two user roles: **Student** and **Admin**.

Five academic request types (each its own feature module):
1. Raise Capacity
2. Incomplete Exam
3. Grade Change
4. Program Change
5. Course Equivalency

## Development Approach

Build one complete feature at a time, in this order:
1. Authentication and login
2. Student dashboard
3. Raise Capacity
4. Remaining academic request types
5. Administrator workflows
6. Full system testing and deployment

Each feature must be designed, implemented, wired to real data, tested, and documented before starting the next one. Do not generate the whole application at once, and do not scaffold future features ahead of where the project currently is.

## Code Organization and Quality

- Clear, descriptive folder and file names.
- Separate UI components, API communication, validation, and business logic.
- Each academic request type is its own feature module (frontend and backend).
- TypeScript strict mode.
- Comments and docstrings only for non-obvious or important logic — not for restating what code does.
- No unnecessary abstractions, duplicated code, or placeholder/stub implementations left in place.
- Never invent database tables, columns, relationships, or API endpoints that don't already exist or haven't been explicitly defined — verify against the real Supabase schema (ask the database owner or inspect it) rather than assuming.
- Never overwrite existing AI agent implementations without reviewing them first.

## Security Rules

- Never expose secrets (Gemini API key, service-role/privileged DB credentials) in frontend code, and never commit them to GitHub.
- Frontend-to-Supabase calls must rely on RLS policies for authorization — never assume the frontend is a trusted boundary.
- Any operation requiring privileged credentials or the Gemini API key goes through the FastAPI backend, not the frontend.
- Do not change the existing Supabase database (schema, RLS policies, auth config) without the database owner's approval.

## Collaboration Workflow

The project owner wants to understand the implementation, not just receive finished code.

**Before implementing a feature:**
- Explain the implementation plan.
- Explain which technologies are involved and why.
- Identify the files that will be created or modified.
- Explain how frontend, backend, database, and agents will communicate for this feature.
- Call out relevant security considerations.

**After implementing a feature:**
- Explain what changed and why.
- Explain how the code works in plain language.
- Give clear instructions for running and testing the feature.
- Report any remaining placeholders, limitations, or unresolved issues honestly.
- Never claim functionality works unless it has actually been tested.

## Commands

No build, lint, or test tooling exists yet — this repo currently contains only a README. This section should be filled in with real commands (`npm run dev`, `pytest`, etc.) as soon as the frontend and backend scaffolding is created, and kept in sync as tooling changes.
