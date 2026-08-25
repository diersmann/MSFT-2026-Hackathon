# Submission draft

Not filed yet — this is the text to paste into the organizer repo's
[project submission form](https://github.com/reneexeener/msft-hackathon-2026/issues/new?template=2-project-submission.yml).

Filing it is a human decision (it claims ideas #3 and #4 on behalf of the team and
names the team), so it is left here rather than opened automatically.

---

**Title:** `[Submission] <Team name> — Dispatch`

**Team name:** _fill in_

**Code repo:** https://github.com/diersmann/MSFT-2026-Hackathon

**Playground repo the demo runs against:** https://github.com/sametd04/widgetworks-playground

**Demo link:** https://dispatch-dashboard.thankfulmushroom-c8f31c24.swedencentral.azurecontainerapps.io/

**Theme:** Agentic workflows (it also touches Automation and Planning & tracking)

---

## What we built

Two features sharing one engine, aimed at a single question: what does a project board look like when part of your team isn't human?

1. **Agent-readiness linter** (from idea #3, donated by @reneexeener). Scores every new issue out of 4 — observable outcome, scope, context, ambiguity — and leaves one concrete rewrite of the weakest part. Never blocks. Abstains rather than inventing a number.

2. **`/split`** (from idea #4). Decomposes an epic into real GitHub sub-issues, classifies each as mechanical or judgement, and assigns only the mechanical ones to the Copilot coding agent.

Credit to @reneexeener for both ideas.

## The connection between them

They need the same primitive: a judgement about whether work is agent-actionable. The linter exposes it as a score; `/split` uses it as a routing decision. `mechanical` isn't a separate question — it's a high readiness score plus a check that the diff could be reviewed without an opinion. So we built the rubric once and the splitter became decomposition plus a threshold.

## Where agents do real work, and where humans stay

- The rubric is a model judgement, not a regex checklist.
- Decomposition is a model proposing 3–8 sub-issues against the real repo layout.
- Classification is a reasoning model deciding mechanical vs judgement.
- **Humans keep every consequential decision.** The linter is advisory and never blocks. Judgement items stay unassigned. Every classification is visible with its reasoning and one click from being overridden.

## The thing we're most pleased with

Deterministic grounding. Every path an issue mentions is extracted and checked against the real git tree, pinned to a commit sha, and the model is told the _result_ rather than asked to guess.

That catches a failure mode text analysis cannot: an issue naming a file that no longer exists. It reads like a perfect ticket, and an agent handed it will confidently flail. Worse than a vague issue, and invisible without the check.

## The risky part, and what we did about it

Classification. An agent that assigns itself a design decision produces a confident, wrong PR that someone has to catch before it merges. The costs are asymmetric — a wrongly-human item costs ten minutes, a wrongly-agent item costs trust.

So `mechanical` requires _all_ of: outcome fully determined, diff verifiable without opinion, no taste required, classifier confident, and every named path verified. Any doubt collapses to `judgement`. There's a test asserting no single failing condition can be outvoted by the others.

## Honest findings

- **The rubric needs measuring, not asserting.** `npm run eval` scores 16 hand-labeled fixtures and reports per-signal agreement separately, because the interesting failure is one signal disagreeing consistently — that's a wording problem, not a model problem.
- **We could not confirm that readiness predicts throughput.** The backfill correlates score against time-to-close and reports a null result plainly. A hackathon repo has no real throughput, so the honest answer is "unknown" rather than a number built from four data points.
- **The organizer repo is the wrong test set.** It's mostly idea issues, which have no code target. Our scope gate skips them, and the backfill reports ideas and work items separately rather than blending them into a flattering distribution.

## Demo flow

Live against a real repo, with the real Copilot coding agent — no mocks:

1. File a vague issue in the playground → the linter labels it `readiness: unscored` and comments which dimension failed. Not dispatched, no agent run wasted.
2. File a well-formed issue → `4/4`, labelled `agent-ready` + `mechanical`.
3. File a broad epic → comment `/split` → real sub-issues, each re-scored and routed.
4. Mechanical sub-issues get picked up by the Copilot coding agent, which opens PRs.
5. Open the dashboard and walk the funnel: what came in, what scored, what got delegated, what stayed human.

## Try it

```bash
npm install && cp .env.example .env
npm run smoke                                     # find your model deployment names
npm test                                          # 105 tests, no credentials needed
npm run eval                                      # rubric vs hand-labeled fixtures
npm run lint -- --repo owner/name --issue 42       # dry run, nothing written
```

Full setup in the [README](https://github.com/diersmann/MSFT-2026-Hackathon#setup).
