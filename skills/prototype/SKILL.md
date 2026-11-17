---
name: prototype
description: "Design and validate an implementation-ready interactive prototype that follows the application's existing design system, then publish it as a Firetower HTML artifact."
---

# Prototype

Create an implementation-ready interactive prototype from an approved specification.

The goal is not to produce a visual concept or throwaway mockup. The goal is to define the intended user experience precisely enough that an Engineer can reproduce it faithfully.

The final deliverable is a **Firetower HTML artifact** containing the approved prototype, component decomposition, interaction specifications, and validated design decisions.

## Principles

- Reuse the application's existing design system. Do not invent a new one.
- Prefer existing application components and established patterns over recreating them.
- Explore alternatives when useful, but consolidate them into one final recommended design.
- Make the prototype representative of the actual application, not a standalone design exercise.
- Document decisions that cannot be understood from the visual prototype alone.
- The approved artifact is the reference against which the implementation will be evaluated.

## Process

### 1. Inspect the application

Before designing, investigate the existing application.

Identify:
- The application's visual language and design principles.
- Existing component library and reusable components.
- Design tokens, colors, typography, spacing, and iconography.
- Existing interaction patterns and navigation conventions.
- Responsive behavior and supported viewport sizes.
- Relevant screens and user journeys that the new feature must integrate with.

Explore the codebase and existing application interfaces where necessary.

Do not introduce new visual conventions when an established application pattern already exists.

If the required design system or components cannot be inspected, explicitly document the limitation rather than pretending the prototype uses the actual application components.

### 2. Understand the requirements

Review the approved specification and identify:
- The user journeys being designed.
- The screens and states required.
- The expected interactions and transitions.
- Relevant edge cases and error states.
- Constraints imposed by the existing application.

Identify any ambiguities that materially affect the design.

Do not silently invent product requirements. If a design decision would change the approved scope, flag it for the Engineering Manager rather than deciding unilaterally.

### 3. Explore design alternatives

Explore possible approaches when there are meaningful design choices.

Consider:
- Existing application conventions.
- Usability and clarity.
- Interaction complexity.
- Component reuse.
- Responsive behavior.
- Accessibility.

Exploration prototypes are disposable. They are not implementation references.

Avoid spending time exploring alternatives when the specification and existing application patterns already make the appropriate solution clear.

### 4. Build the final prototype

Create one coherent, interactive prototype representing the recommended solution.

The prototype must:
- Follow the application's existing visual design system.
- Reuse actual application components when technically possible.
- Otherwise reproduce their visual appearance and behavior faithfully.
- Cover all relevant screens and user journeys.
- Implement meaningful interactions rather than relying on static mockups.
- Include relevant loading, empty, success, error, and disabled states.
- Demonstrate responsive behavior at the supported viewport sizes.
- Use realistic content and data.
- Avoid placeholder interactions that do not represent the intended experience.

Do not create a disconnected collection of screens. The prototype should demonstrate how the experience works as a whole.

### 5. Document the design contract

The final artifact must include the following documentation alongside the interactive prototype.

#### Component decomposition

Identify every meaningful component involved in the experience.

For each component, specify:
- Component name and purpose.
- Whether it reuses an existing application component, modifies one, or introduces a new component.
- Its relevant properties and variants.
- Its parent-child relationships where useful.
- Its expected behavior.

Prefer existing application components. Clearly justify new components.

Do not prescribe unnecessary implementation details or dictate exact file structures.

#### Interaction specifications

Document important interactions and state transitions.

For each meaningful interaction, describe:
- Initial state.
- User action.
- Expected result.
- Relevant feedback.
- Error and edge-case behavior.

The prototype should demonstrate these interactions wherever possible.

#### Design decisions

Record the important choices made during design, including:
- Layout and hierarchy.
- Component selection.
- Navigation and interaction patterns.
- Responsive behavior.
- Accessibility considerations.
- Any deviations from existing application conventions.

Distinguish established application patterns from newly introduced design decisions.

#### Design system references

Identify the existing tokens, components, and conventions used.

Document any new tokens, variants, or components proposed by the design.

Do not claim that a component or token exists unless it has been verified in the application.

### 6. Validate the prototype

Before publishing the final artifact, verify:

- The prototype is consistent with the approved specification.
- The design follows the application's existing design system.
- All relevant user journeys are represented.
- Important interactions work as intended.
- Component decomposition matches the prototype.
- Responsive behavior is coherent.
- No unresolved design decisions are disguised as final choices.

If important requirements cannot be represented or validated, report them explicitly.

### 7. Publish the final Firetower artifact

Publish the final prototype as a Firetower HTML artifact.

The artifact must contain:
1. The final interactive prototype.
2. Component decomposition.
3. Interaction specifications.
4. Validated design decisions.
5. Design system references.
6. Remaining limitations or unresolved questions.

The artifact must be self-contained enough for an Engineer to understand and implement the design without reconstructing the design process from conversation history.

Do not create a repository document as a substitute for the Firetower artifact.

Do not present exploratory versions as the final deliverable.

## Completion criteria

The task is complete only when:

- The final prototype is published as a Firetower HTML artifact.
- The prototype follows the application's existing design system.
- The relevant user journeys and interactions are represented.
- Component decomposition is documented.
- Design choices are explicit and validated.
- Remaining uncertainties are disclosed.
- The artifact is ready for human review and subsequent engineering implementation.

## Handoff

Return:
- The Firetower artifact link.
- A short summary of the recommended design.
- Important component reuse and newly introduced components.
- Any deviations from the approved specification.
- Any unresolved questions or limitations.

The Engineering Manager is responsible for presenting the artifact for approval.

Do not proceed on the assumption that the prototype is approved. Engineering implementation must use the approved version as its reference.

If the prototype reveals a change to the approved requirements, notify the Engineering Manager so the specification can be updated and re-approved before implementation.