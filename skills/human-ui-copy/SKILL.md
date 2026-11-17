---
name: human-ui-copy
description: Write and edit product UI copy that is clear, concise, specific, and recognisably human. Use when creating or reviewing interface text, settings, forms, confirmations, helper text, empty states, permissions, schedules, warnings, and summaries. Removes AI-sounding rhetorical patterns and unnecessary explanation without hiding important information.
---

# Human UI Copy

Write interface copy for people who are trying to get something done. Make the next action and its consequences easy to understand at a glance.

The goal is not to sound clever, warm, or conversational. The goal is to be clear, direct, calm, and useful.

## Core standard

Every sentence must earn its place.

A person scanning the screen should be able to answer:
- What is this?
- What do I need to do?
- What will happen if I do it?
- Is there anything important I need to know first?

Use the fewest words that answer those questions accurately. Do not remove information that changes the user's decision, expectations, safety, cost, privacy, or ability to recover.

## Rules

### 1. Remove AI-shaped rhetorical habits

Do not use these patterns by default:

- Em-dash pivots that add a second explanation: "Do X — because Y", "X — so you can Y", "X — nobody will be there to..."
- Fake conversational asides: "Here's the thing", "It's worth noting", "The good news is..."
- Inflated framing: "In order to", "It's important to understand that", "This allows you to..."
- Repeated contrast structures: "Not just X, but Y", "It's not about X. It's about Y."
- Unnecessary signposting: "Please note that", "Keep in mind that", "As mentioned above".
- Generic reassurance or filler: "seamlessly", "effortlessly", "powerful", "flexible", "simply", "just".
- Self-conscious summaries that repeat what the heading or control already says.

An em dash is not forbidden. Use it only when it expresses a real interruption or relationship that would be less clear with normal punctuation. Never use it as a default way to bolt an explanation onto a sentence.

Prefer a full stop, a colon, or a shorter sentence when that reads more naturally.

### 2. Lead with the user's concern

Put the most useful information first:
- State the action before its implementation details.
- State the consequence before the technical mechanism.
- Put a warning before the button when the user needs it to decide.
- Put the exception next to the rule it qualifies.

Do not make users read a paragraph to discover the one fact that matters.

### 3. Explain outcomes, not internal machinery

Translate implementation details into user-visible consequences.

Prefer:
- "Runs every weekday at 08:30."
- "Uses the first available machine."
- "Changes files and runs commands without asking you."
- "Uses one run from your monthly allowance."

Avoid narrating the system's internal sequence unless the sequence itself matters to the user.

Keep technical names when users need them to identify a repository, model, account, device, permission, or setting. Do not repeat a technical value merely to make the copy sound complete.

### 4. Separate information by purpose

Do not pack setup details, permissions, billing, and failure behaviour into one dense paragraph.

Use the right UI element:
- **Label:** name the setting or action.
- **Helper text:** explain one thing the user needs to know to make a choice.
- **Summary:** show the important configuration in a scannable format.
- **Warning:** explain a material risk before the user commits.
- **Advanced details:** hold implementation specifics and less common edge cases.
- **Confirmation:** say what happened and what happens next.

If the interface supports structured rows, use them instead of a prose paragraph. For example:

Schedule       Weekdays at 08:30
Machine        First available
Repository     firetower-cloud/firetower
Permissions    Can edit files and run commands
Usage          About 21 runs per month

Do not turn every screen into a list. Structure information only when it makes scanning easier.

### 5. Keep sentences short and concrete

- Aim for one idea per sentence.
- Prefer active voice.
- Use familiar verbs: run, edit, send, save, delete, connect, share.
- Address the user as "you" only when it clarifies who acts or is affected.
- Avoid abstract nouns when a verb is clearer.
- Avoid repeating the same fact in a heading, helper text, and summary.
- Remove any sentence that does not change what the user understands or does.

Short does not mean cryptic. Include the subject and the consequence; do not reduce copy to fragments that require guesswork.

### 6. Make unattended behaviour explicit

For scheduled or autonomous actions, users must understand the meaningful consequences before enabling them.

Explain these points when relevant:
1. **When:** the schedule and timezone.
2. **Where:** the account, project, repository, or machine context.
3. **What it can do:** the meaningful actions it is allowed to take.
4. **What it cannot do:** approval requirements, blocked actions, or limits.
5. **Cost or usage:** what allowance, credits, money, or quota it consumes.
6. **Failure behaviour:** what happens if it needs input, hits an error, or cannot continue.

Do not dump all six into a single paragraph. Put the most decision-relevant facts in the main view; move secondary detail into clearly named advanced information.

Never hide a material permission, cost, or failure mode just to make the interface look cleaner.

### 7. Use numbers and limits precisely

- Prefer "About 21 runs a month" over "each run spends your allowance — about 21 runs a month."
- Explain what a number measures.
- Distinguish estimates from guarantees.
- Include units and time periods.
- Do not imply a hard limit when the value is an estimate.
- Do not repeat a schedule in multiple places unless the repetition serves a distinct purpose.

### 8. Use headings that help people scan

Headings should name the information below them.

Good:
- "Schedule"
- "Machine"
- "What the agent can do"
- "Usage"
- "If the agent needs your input"

Avoid headings that are vague, theatrical, or written like marketing copy.

### 9. Respect the product's voice

Sound like a competent product, not a chatbot, salesperson, legal disclaimer, or brand manifesto.

- No forced enthusiasm.
- No jokes in operational, permission, billing, or error copy.
- No fake empathy.
- No marketing adjectives.
- No unnecessary exclamation marks.
- Do not imitate a user's casual language if it makes instructions less clear.

## Editing procedure

When reviewing existing UI copy:

1. **Find the decision.** Identify what the user is deciding or trying to do.
2. **Extract the facts.** List the action, timing, scope, permissions, cost, limits, and failure behaviour that materially affect that decision.
3. **Delete the noise.** Remove repeated context, throat-clearing, rhetorical pivots, generic transitions, and implementation narration.
4. **Reorder.** Put the action and most important consequence first.
5. **Restructure.** Split dense prose into a label, short helper text, summary rows, or advanced details where appropriate.
6. **Rewrite.** Use plain language and one idea per sentence.
7. **Check accuracy.** Ensure no important permission, cost, constraint, or uncertainty was lost or exaggerated.
8. **Read it as a hurried person.** Can someone understand the consequence in a quick scan?

Do not preserve awkward wording just because it appeared in the original. Preserve its meaning, not its sentence structure.

## Example: scheduled agent

### Avoid

"Every weekday at 08:30 this starts a workspace as you, on whichever machine is free, using Claude (work), with firetower-cloud/firetower checked out and the secrets that repository carries.

Nobody is present, so it can change files, run commands and reach anything those secrets open, and each run spends your allowance — about 21 runs a month. Anything needing your approval is refused rather than asked; a run that stops to ask you something ends after 15 minutes."

### Prefer

**Runs**
Every weekday at 08:30 (Europe/Paris).

**Environment**
Uses Claude (work), the `firetower-cloud/firetower` repository, and the first available machine.

**Access**
Can edit files and run commands without you present. Repository secrets are available to the run.

**Usage**
About 21 runs per month.

**If approval is needed**
The action is blocked. The agent cannot ask you while the run is in progress.

This version is still explicit about schedule, environment, access, usage, and approval behaviour. It removes the narration and makes each consequence easy to find. If the interface cannot support separate rows, compress it into a short paragraph without losing those facts.

## Example: helper text

Avoid:
"What to ask for, every time — nobody will be there to reply, so say what done looks like"

Prefer:
"What should the agent do? Describe the result you expect. It won't be able to ask follow-up questions."

## Final checklist

Before shipping, confirm:

- [ ] The copy starts with what matters to the user.
- [ ] Each sentence adds a distinct, useful fact.
- [ ] No em-dash pivot or other AI-shaped filler survived without a good reason.
- [ ] The copy describes outcomes rather than narrating implementation.
- [ ] Important permissions, costs, limits, and failure behaviour are clear.
- [ ] Dense information is structured rather than buried in a paragraph.
- [ ] Technical names appear only where they help identify something.
- [ ] The copy is concise without becoming vague.
- [ ] The tone is calm, direct, and human.

When in doubt, remove the sentence and see whether the user loses information needed to make a good decision. If not, leave it out.
