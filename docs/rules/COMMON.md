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
