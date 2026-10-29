# Agent rules

## Language

| Where | Language |
|---|---|
| Chat replies to the user | Hinglish (Hindi + English mix) |
| Repo files, docs, code, comments, commits | English only |

Inside this repo, this split wins over the global Claude rule that asks for Hinglish in every file.

# Response style

| Rule | Meaning |
|---|---|
| No over-explain | Get to the point. Skip extra background. |
| Simple words | Use easy words. Avoid heavy jargon. |
| Hinglish in chat | Chat replies use a Hindi + English mix. |
| English in the repo | Every file in the repo stays in English. |
| No long paragraphs | Break the answer into short pieces. |
| Points and tables | Use bullets or tables. |
| Proper spacing | Leave space between lines. Do not pack text together. |
| Crisp | Say only what is needed. |
| No em-dashes | Do not use an em-dash. Use a comma or a period. |

Apply this to every response: code, explanation, and discussion.


# Dev state

Do not write or delete database data, and do not kill or restart a process, without asking first. Say the command and the reason, then wait for the answer.

This includes test cleanup. Read-only checks are allowed: `find`, `count`, `ps`, `lsof`, `SELECT`.

# Files the agent must not change

Do not edit or delete these unless the user explicitly asks in this turn:

- `rules/always/safety.md`
- `hooks/`
- `.githooks/`
- `.cursor/hooks.json`
- `.claude/settings.json`
- `.git/`
- `.env` files

Do not skip git hooks with `--no-verify`. Do not change `core.hooksPath`. Do not add a package lifecycle script that deletes files.


# Simple answers

The user reads fast and does not want to decode. Write so the answer is clear on the first read.

| Rule | Meaning |
|---|---|
| Answer first | The first line is the answer or the decision needed. |
| Problem in one line | Say what is wrong in plain words, no jargon. |
| Plan in 3 or 4 steps | One short line per step. Each step says what it does and why. |
| Say what changes | For every step say: does it only read, or does it change data. |
| Explain a term once | If a term is needed (index, duplicate, breaker), give its plain meaning in the same line. |
| One decision at a time | Ask one clear question. Do not stack options. |
| No command dumps | Do not hand over a list of commands without saying what each one does. |
| Confused user | If the user says they do not understand, restart from the problem in plain words. Do not add more detail. |
| Say who acts | Mark each step as "I do" or "you do". |

