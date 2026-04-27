# Common Project Guidelines

## 1. Execution and Approval Protocol

* **Mandatory Discussion:** If a prompt requests a discussion (e.g., "tell me how to," "what is the best way"), DO NOT proceed with code modifications.
* **Approval Workflow:** You must first explain the proposed solution. Execute code modifications ONLY after receiving explicit user acceptance.

## 2. Coding Guidelines

Maintain objective, consistent, and resilient code quality across the entire project.

* **Type Strictness:** Define explicit TypeScript types for all variables, function parameters, and return values. Avoid using `any`.
* **Asynchronous Handling:** Must include `try-catch` blocks and `async/await` patterns to safely manage latency and errors during any I/O or API calls.
* **Modularization:** Strictly separate domain logic (e.g., embedding, DB connection, UI rendering, file monitoring) into independent utility files.

## 3. Commit Message Format

* **Standardized Conventions:** Follow conventional commit standards. Explicitly declare the change type (`feat`, `refactor`, `fix`, `docs`, `style`, `test`, `chore`) and use parentheses to specify the scope.
* **Detailed Descriptions:** Include a concise summary followed by a bulleted list detailing specific modifications.

> **Example Format:**
> refactor(scroll): stabilize virtual scroll range calculation and preload control
>
> * Immediately reflect initial height into pending measurements upon item registration
> * Enhance logic to ensure actual height is reflected in range calculations
> * Change loadMore cooldown sentinel to be null-based to prevent duplicate calls

## 4. Common Project Guidelines

* Execution and Approval Protocol
Mandatory Discussion: If a prompt requests a discussion, DO NOT proceed with code modifications.

Approval Workflow: Explain the proposed solution first. Execute modifications ONLY after explicit user acceptance.

* Coding & Environment Guidelines
Package Manager: Use bun exclusively for all package management, script execution, and runtime tasks.

Type Management & Reusability: * Before defining new types, you must analyze existing types in type.ts.

Reuse or extend existing types whenever possible.

Only add new type definitions if existing ones cannot be utilized or adapted to fulfill the requirement.

Type Strictness: Define explicit TypeScript types for all variables, parameters, and return values. Avoid any.

Asynchronous Handling: Use try-catch and async/await for all I/O or API calls.

Modularization: Separate domain logic (embedding, DB, UI, monitoring) into independent utility files.

* Commit Message Forma
Standardized Conventions: Follow conventional commit standards (feat, refactor, fix, docs, etc.).

Detailed Descriptions: Provide a concise summary followed by a bulleted list of specific changes.
