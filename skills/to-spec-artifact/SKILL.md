---
name: to-spec-artifact
description: "Synthesize the current discovery into a complete product and technical specification, publish it as a Firetower HTML artifact, and create a linked review issue."
---

# To Spec Artifact

Turn the current conversation, discovery outcomes, and codebase understanding into a coherent specification.

Do NOT interview the user. Do NOT restart discovery. Synthesize what is already known, including decisions made through Wayfinder and any relevant prototype.

Your output is:
1. A **Firetower HTML artifact** containing the complete specification.
2. A **lightweight issue** linking to the artifact and the parent Wayfinder discovery issue.

The artifact is the source of truth for the specification. The issue exists only to track review status and provide traceability.

Do NOT create implementation tickets. That is the responsibility of `to-tickets`, after the specification has been approved.

## Process

### 1. Understand the context

Review the current conversation and relevant discovery outcomes.

- Identify the original problem and intended outcome.
- Gather resolved decisions from the Wayfinder discovery issues.
- Identify remaining uncertainties and assumptions.
- Explore the repository to understand the current architecture and implementation, when relevant.
- Review relevant ADRs, existing conventions, and domain glossary.
- Incorporate any existing prototype decisions, if a prototype has already been produced.

Do not repeat investigations that have already been completed during discovery.

Use the project's domain vocabulary consistently.

### 2. Define the specification

Produce a specification that is sufficiently detailed for an engineer to implement without having to rediscover the product requirements.

Be precise about:
- The problem being solved and for whom.
- The intended user experience and expected behavior.
- Functional requirements and important edge cases.
- Relevant technical and architectural decisions.
- Interfaces, data models, API contracts, and integrations where applicable.
- Acceptance criteria.
- Testing strategy and appropriate test boundaries.
- Explicitly excluded functionality.

Distinguish clearly between:
- **Decided:** explicitly agreed or established during discovery.
- **Proposed:** a recommendation that still requires validation.
- **Unresolved:** an important question that discovery did not answer.

Do not silently turn assumptions into requirements.

Avoid inventing requirements to make the document appear comprehensive. Include user stories when they clarify user needs, but do not generate an unnecessarily long list.

### 3. Create the Firetower artifact

Publish the specification as a Firetower HTML artifact.

The artifact must:
- Be readable and well structured.
- Stand on its own, without requiring access to the conversation.
- Clearly distinguish requirements, decisions, assumptions, and unresolved questions.
- Contain enough detail to guide implementation and subsequent ticket decomposition.
- Be the canonical location of the specification.

Do not create a `spec.md` file or store the specification in the repository.

Use the available Firetower artifact creation capabilities. Do not substitute a repository file, issue description, or plain conversation response for the artifact.

### 4. Create the review issue

Create one issue in the project issue tracker.

The issue should:
- Have a concise title describing the feature.
- Link to the Firetower specification artifact.
- Link to the parent Wayfinder discovery issue.
- Briefly explain that the specification is ready for review.
- Use the project's appropriate review-ready triage label.

Keep the issue lightweight. Do not duplicate the specification or copy its full contents into the issue.

Do not create child implementation issues or implementation tickets.

### 5. Report completion

Return:
- The Firetower artifact link.
- The review issue link.
- Any important unresolved questions or assumptions that require the Engineering Manager's attention.

The Engineering Manager is responsible for presenting the artifact to the user and obtaining explicit approval.

Do not proceed to `to-tickets` until the user has approved the specification.

## Specification template

# [Feature name]

## Problem

Describe the problem from the user's perspective. Explain who experiences it, what they are trying to accomplish, and why the current experience is insufficient.

## Proposed Solution

Describe the intended solution and how it addresses the problem.

## User Experience and Requirements

Describe the expected behavior in enough detail to guide implementation.

Include:
- User flows and interactions.
- Functional requirements.
- Important edge cases and error states.
- Relevant permissions and access rules.
- Non-functional requirements where applicable.

Use user stories when they add clarity, not as a substitute for concrete requirements.

## Acceptance Criteria

Define observable conditions that must be satisfied for the feature to be considered complete.

Make criteria specific and verifiable.

## Implementation Decisions

Document established technical and architectural decisions.

This can include:
- Relevant modules and system boundaries.
- Interfaces and integrations.
- Data models and schema changes.
- API contracts.
- Architectural constraints.
- Specific interaction and state-management decisions.

Do not include specific file paths or code snippets. They may become outdated.

If a prototype contains a decision that is more precisely expressed through a state machine, schema, or type shape, include the relevant excerpt and identify it as prototype-derived.

Clearly distinguish established decisions from proposals.

## Testing Strategy

Describe how the feature should be validated.

Include:
- Observable behavior to test.
- Relevant integration boundaries.
- Appropriate test levels and scenarios.
- Existing testing patterns worth following.
- Important edge cases and failure conditions.

Prefer testing through the highest meaningful seam. Favor external behavior over implementation details.

## Out of Scope

Explicitly list functionality and concerns that are not part of this specification.

## Open Questions and Assumptions

List unresolved questions, assumptions, and decisions that still require validation.

Do not hide uncertainty inside the requirements.

## References

Link to relevant discovery issues, existing documentation, ADRs, and prototype artifacts.