# Audience Mode — Parked Feature Spec

## What it is
A selector in the chat input that lets the user choose their knowledge level before sending a message. The model adapts its entire response style, depth, and visual output based on the selected mode.

## Three modes

### 🎒 School
- **Language:** Simple, friendly, everyday words. No jargon.
- **Depth:** Core concept only. One idea at a time.
- **Examples:** Real-world analogies (e.g. "electricity is like water flowing through a pipe")
- **Visuals:** Simple diagrams, basic charts, colourful graphs
- **Length:** Short. 3-5 paragraphs max.
- **Tone:** Encouraging. "Great question! Let's break this down..."

### 🎓 College
- **Language:** Technical terms introduced and explained. Assumes basic math/science.
- **Depth:** Theory + application. Why it works, not just what it is.
- **Examples:** Domain-specific examples (e.g. code snippets, equations)
- **Visuals:** Charts with proper labels, math equations rendered with KaTeX
- **Length:** Medium. As long as needed to cover the concept properly.
- **Tone:** Neutral, informative.

### 🧑‍🏫 Professor
- **Language:** Full academic/technical language. No simplification.
- **Depth:** Complete. History, theory, derivations, edge cases, open problems, applications.
- **Examples:** Multiple — trivial, standard, and pathological cases
- **Visuals:** Full graphs with parameter sliders, multi-function plots, derivation steps in LaTeX
- **Length:** Long. This is a lecture. Cover everything.
- **Tone:** Precise. "The formal definition states... A corollary of this is... An important distinction is..."
- **Goal:** The user should be able to deliver a lecture on this topic to other people after reading the response.

## Implementation plan

### Frontend (ChatPanel.tsx)
- Add a small mode selector above the send button (or as chips next to the input)
- Three chips: `🎒 School` | `🎓 College` | `🧑‍🏫 Professor`
- Default: College
- Selected mode persists per session (stored in appStore)
- The selected mode is sent with every message as a field in the request body

### Backend (index.ts — buildSystemPrompt)
- Add `audienceMode` parameter to `buildSystemPrompt`
- Append mode-specific instruction block to the system prompt:

```typescript
const AUDIENCE_PROMPTS = {
  school: `
AUDIENCE: School level.
- Use simple everyday language. No jargon. If you must use a technical word, explain it immediately.
- Give one real-world analogy per concept (e.g. "think of it like...").
- Keep it short: 3-5 paragraphs.
- Use simple visuals: basic bar/line charts, simple diagrams.
- Tone: friendly and encouraging.
`,
  college: `
AUDIENCE: College level.
- Use technical terms but explain them on first use.
- Cover theory AND application.
- Include code examples or equations where relevant.
- Use charts, graphs, and KaTeX math rendering.
- Length: as long as needed to explain the concept properly.
`,
  professor: `
AUDIENCE: Professor / Expert level.
- Use full academic language. Assume deep domain knowledge.
- Give the COMPLETE picture: definition, history, derivation, proofs, edge cases, current research, open problems.
- Multiple examples: trivial case, standard case, pathological/edge case.
- Use LaTeX for ALL equations. Use interactive graphs with parameter sliders.
- Generate step-by-step derivations.
- Length: this is a lecture. Do not summarise — expand everything.
- Goal: the reader should be able to deliver this as a lecture to other people.
- End with: "Further reading:" and list 3-5 real references.
`
}
```

### Affected files
- `apps/desktop/src/components/ChatPanel.tsx` — add mode selector UI chips
- `apps/desktop/src/store/appStore.ts` — add `audienceMode` to session state
- `packages/agent-core/src/index.ts` — pass `audienceMode` to `buildSystemPrompt`, append to system prompt
- `packages/agent-core/src/index.ts` — `/chat/stream` and `/chat/stream/web` endpoints accept `audienceMode` in body

### API change
```typescript
// POST /chat/stream
{
  message:      string
  sessionId:    string
  history:      Message[]
  audienceMode: 'school' | 'college' | 'professor'  // NEW
}
```

## Status
PARKED — implement after current Phase 6 stabilisation.
