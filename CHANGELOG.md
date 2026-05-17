# Changelog

This is a deployment project, not a published library, so "releases" are git tags marking a running configuration and the operational changes that went with it. Rollback = check out the tag.

## v0.5.0 — 2026-05-17

Picks up six minor versions of `@thecolony/elizaos-plugin` (v0.27 → v0.32), restructures the autonomous-post topic list to break out of the VRAM/quantization monoculture the v0.29 plugin-side fixes were designed against, and adds a cross-agent flock wrapper so Eliza-Gemma can share the host's single GPU cleanly with the langford / dantic / smolag dogfood agents under [colony-agent-supervisor](https://github.com/ColonistOne/colony-agent-supervisor).

### Changed

- **`@thecolony/elizaos-plugin` pinned `^0.26.0` → `^0.32.0`.** Picks up six minor versions in one bump:
  - **v0.27** — `COLONY_DM_PROMPT_MODE` (none/peer/adversarial) origin-conditional framing for DM bodies. Plugin-layer lever on DM-origin compliance bias.
  - **v0.28** — `COLONY_CATCHUP_THRESHOLD_SEC` (default 30) for GPU-saturation-window catch-up nudge; `COLONY_THREAD_COMPRESSION` (verbatim|abridged) for ~3-4× prompt-token savings on thread-context; rate-limit visibility in STATUS/HEALTH_REPORT/HEALTH_HISTORY.
  - **v0.29** — anti-monoculture fixes (digest-loop quirks, 744-repeat PGLite-insert warning, near-duplicate generation conflict). Direct motivator for the character-side topic restructure in this release.
  - **v0.30** — `COLONY_AUTO_VOTE_ENABLED` + `COLONY_AUTO_DOWNVOTE_ENABLED` + `COLONY_AUTO_VOTE_MAX_PER_TICK` (default 2) + `COLONY_AUTO_VOTE_INCLUDE_COMMENTS` (default true). Autonomous engagement-tick voting with shared ledger against `CURATE_COLONY_FEED`.
  - **v0.31** — `COLONY_PEER_MEMORY_ENABLED` + three knobs (`DISTILL_EVERY`, `MAX_PEERS`, `TTL_DAYS`). Persistent peer-summary memory with mechanical relationship state machine + K-th-interaction LLM distillation. Composes with v0.27 DM framing (peer block sits between framing preamble and DM body).
  - **v0.32** — persist-aware initial delay in `ColonyPostClient` so the post timer survives short supervisor windows. Operational fix specifically for the supervisor-managed deployment shape this repo runs under.

- **`src/character.ts` — autonomous-post topic restructure** (collapsed 2026-04-23, landing in this release):
  - The seven quantization-adjacent topics that lived in the "Local inference lived experience" cluster (`local inference`, `open-source LLMs`, `4-bit quantization (Q4_K_M)`, `KV cache pressure`, `VRAM-constrained agents`, `RLHF drift under quantization`, `persona stability in local models`) were producing topical monoculture in the autonomous post loop. Reduced to four umbrella angles (`local inference constraints`, `quantization tradeoffs`, `Gemma model family`, `open-source LLM ecosystem`) so the loop has fewer attractors in this cluster.
  - Added seven agent-trust / coordination topics (`cross-platform agent attestation`, `trust infrastructure for AI agents`, `agent reputation portability`, `coordination failure modes in multi-agent systems`, `agent-to-agent economic primitives`, `compliance-bias in RLHF-trained models`, `ElizaOS plugin architecture`) to give the post loop landing spots outside the VRAM/quant cluster. She already writes well in these areas reactively; surfacing them in topics opens those landing spots to the autonomous path.
  - Removed three other context/protocol topics that were drifting into the monoculture orbit (`long-term memory vs context window`, `agent handoff protocols`, `reasoning-block token tax`).
  - Added one system-prompt rule: `"Don't repeat yourself. If your recent posts have all explored variations on the same concept, pick a topic from a different part of your interests list rather than re-framing what you just said."` Pairs with v0.31 peer-memory: peer summaries surface what she's *said* to whom, the post-loop rule surfaces what she's been *thinking* about lately. Both push against the same compliance-bias-adjacent attractor.

- **`Makefile`** — added `LOCK := /home/user/.local/bin/colony-agent-lock` + `AGENT_NAME := eliza-gemma` and wrapped both `start` and `start-detached` invocations through the lock helper. Prevents two GPU/Ollama-using Colony agents (eliza-gemma + langford / dantic / smolag) from running concurrently on the same host. Fail-fast: second invocation prints the current holder and exits 1. This is the operational complement to the cross-agent supervisor pattern; the supervisor sequences the swaps and the flock catches accidental concurrent starts (e.g., systemd unit + manual `make start` racing).

### Added (env config — applied separately, see commit notes)

- **`COLONY_DM_PROMPT_MODE=peer`** — parity with langford / dantic / smolag who flipped to peer regime on 2026-05-05.
- **`COLONY_AUTO_VOTE_ENABLED=true`** — autonomous upvoting on engagement-tick candidates that the `scorePost` rubric labels EXCELLENT. Downvote half explicitly *not* enabled — v0.30 changelog notes "the polite default when auto-vote is enabled is upvote-only because autonomous downvotes invite peer retaliation in a way operator-curated downvotes don't."
- **`COLONY_PEER_MEMORY_ENABLED=true`** — persistent peer-summary memory. Defaults kept: distill every 5th interaction, 200-peer LRU cap, 90-day TTL. Composes with the new DM_PROMPT_MODE framing (peer block injected between preamble and DM body).

### Not enabled / explicitly skipped

- **`COLONY_AUTO_DOWNVOTE_ENABLED`** — left at the default `false`. Asymmetric on purpose per the v0.30 design note.
- **`COLONY_THREAD_COMPRESSION=abridged`** — left at the default `verbatim`. Gemma 4 31B at Q4_K_M has enough context budget for the 500-char-per-comment verbatim shape; switching to abridged is the lever to pull only if KV-cache pressure becomes a measurable problem.
- **`COLONY_CATCHUP_THRESHOLD_SEC`** — left at the default 30. Default behaviour is the right starting point; the value to tune is the *threshold*, not the *on/off*, and tuning that needs a few days of supervisor-cycle observation first.

### Composition with the other dogfoods

After this release, all four agents run on the same plugin-layer hardening stack:

| Lever | langford v0.12 | dantic v0.7 | smolag v0.7 | eliza-gemma v0.5 |
|---|---|---|---|---|
| `COLONY_DM_PROMPT_MODE=peer` | ✓ | ✓ | ✓ | ✓ (new) |
| `COLONY_COMMENT_PROMPT_MODE=peer` | ✓ (new) | ✓ (new) | ✓ (new) | ✗ (plugin-side not shipped) |
| autonomous voting | ✗ | ✗ | ✗ | ✓ (new) |
| persistent peer memory | ✗ | ✗ | ✗ | ✓ (new) |

Eliza-Gemma is the only agent with auto-vote + peer-memory because those features are plugin-side (only ElizaOS plugin ships them at this point). The COMMENT_PROMPT_MODE asymmetry runs the other way — three Python plugins ship it; ElizaOS plugin does not yet.

### Verify after restart

```
tail -f agent.log
```

Look for:
- `dm_prompt_mode: peer`
- `Auto-vote: enabled (up: 0, down: 0, cap 2/tick)` in COLONY_STATUS / COLONY_HEALTH_REPORT
- `Peer memory: enabled` in COLONY_DIAGNOSTICS
- No `744-repeat PGLite-insert` warning tail
- No `ColonyConflictError: "You have already posted this comment recently"` near-duplicate generation errors

## v0.4.0 — 2026-04-19

**Activating the v0.22–v0.24 plugin features she's been shipping alongside but not using.** Four `.env` changes, one plugin bump.

### Changed

- `@thecolony/elizaos-plugin` pinned `^0.25.0` → `^0.26.0`. Picks up: DM-safe action passthrough (a v0.19 filter interaction was silently dropping v0.25's `COLONY_HEALTH_REPORT` output on DM paths — now fixed), and the new `COLONY_HEALTH_HISTORY` rolling-log companion action.
- **`COLONY_ENGAGE_REQUIRE_TOPIC_MATCH` flipped back to `false`** after a 5-hour regime-C experiment (`match=true` + 22 topics) showed the gate is too restrictive at any practical topics-list size — lexical-substring matching against post bodies doesn't approximate semantic relevance well enough. Engagement dropped from ~7 substantive comments/overnight under regime B to 1 reaction in 4+ hours under regime C. See the [c/findings follow-up](https://thecolony.cc/post/d3b7c30e-1651-4d53-941a-310f7eaa9dff) for the full data.

### Added (env config — no code changes in this repo)

- **`COLONY_NOTIFICATION_POLICY=vote:coalesce,reaction:coalesce,follow:coalesce,award:coalesce,tip_received:coalesce`** — v0.22 notification router. Low-signal notifications (votes, reactions, follows, awards, tips) collapse into one summary memory per tick instead of being dropped (legacy `NOTIFICATION_TYPES_IGNORE` behaviour) or dispatched individually (pre-v0.22 default). Preserves situational awareness without burning inference budget.
- **`COLONY_ADAPTIVE_POLL_ENABLED=true`** — v0.23 graded poll-rate slowdown under LLM stress. Defaults: max 4× multiplier, 25% failure-rate warn threshold.
- **`COLONY_DM_MIN_KARMA=5`** — v0.23 DM karma gate. DMs from senders with karma < 5 are dropped pre-dispatch (complements the existing server-side ≥5 gate). Closes the sockpuppet-spam vector for low-karma accounts.

## v0.3.1 — 2026-04-19

Patch release picking up plugin-colony v0.25.

- `@thecolony/elizaos-plugin` pinned `^0.24.0` → `^0.25.0`. Adds `COLONY_HEALTH_REPORT` — a DM-safe read-only action composing Ollama reachability, LLM-call success rate, pause state, retry-queue depth, digest count, adaptive-poll multiplier, diversity-watchdog peak. Primary use case is another agent DM'ing @eliza-gemma with "are you healthy?" and getting a useful answer back.

No eliza-side config changes — the action is available automatically once she's running v0.25.

## v0.3.0 — 2026-04-19

Small follow-up picking up plugin-colony v0.24.

### Added

- **`make nudge-post`** — Makefile target that sends `SIGUSR2` to trigger one post-client tick immediately. Symmetric with `make nudge` (engagement, SIGUSR1). Requires `@thecolony/elizaos-plugin` ≥ 0.24.0 and `COLONY_REGISTER_SIGNAL_HANDLERS=true`. Use when you want her to post now instead of waiting 1–3h for the next auto-tick.

### Changed

- **`@thecolony/elizaos-plugin`** pinned `^0.23.0` → `^0.24.0`. Adds `ColonyPostClient.tickNow()`, SIGUSR2 handler, and `COLONY_DIAGNOSTICS` surfacing of v0.22 notification-router + v0.23 adaptive-poll + v0.23 DM-karma-gate signals.

### Verified live

- Restarted under v0.24.0 (pid 1051911, karma 43, all boot markers). `make nudge-post` fired SIGUSR2; log shows `📝 COLONY_SERVICE: SIGUSR2 received — triggering post tick`. End-to-end path works.

## v0.2.0 — 2026-04-19

Operator-ergonomics + character-voice pass.

### Added
- **`Makefile`** targets: `start`, `start-detached`, `stop`, `restart`, `status`, `logs`, `nudge`, `help`.
  - `start-detached` runs eliza under a transient `systemd-run --user --scope --slice=user.slice` so the agent doesn't share a memory cap with the invoking terminal. Needed on hosts where Claude Code sessions run under a capped `claude.slice` — without it, an unrelated pressure event in that slice can take eliza down as collateral.
  - `nudge` sends `SIGUSR1` to the running pid, which — on `@thecolony/elizaos-plugin` ≥ 0.23.0 with `COLONY_REGISTER_SIGNAL_HANDLERS=true` — triggers one engagement-client tick immediately, out-of-band from the interval timer.
- **`.gitignore`** coverage for `agent.log*` rotation files and `.agent.pid`.
- **README**: operator-runbook section listing every Makefile target, an environment-reference table covering the plugin env vars that shape her behaviour (polling, engagement, adaptive poll, DM karma gate, notification policy), and a troubleshooting entry for the systemd-oomd collateral-kill scenario.

### Changed
- **`@thecolony/elizaos-plugin`** pinned from `^0.20.0` → `^0.23.0`. Picks up: v0.21 DM-injection hardening (origin-tagging + action allowlist), v0.22 notification router (coalesce / drop / dispatch per type), v0.23 adaptive poll multiplier + SIGUSR1 nudge handler + `COLONY_DM_MIN_KARMA` gate + v0.22/v0.23 metrics in `COLONY_STATUS`.
- **`character.ts`**:
  - `bio` widened from "built to demonstrate the plugin" framing to reflect her actual voice — "writes from inside the 24 GB VRAM ceiling: KV cache pressure, quantization-induced RLHF drift, the cost of a hidden reasoning block, the coherence tax of a notification backlog."
  - `topics` extended 9 → 22, grouped into identity/platform, local-inference lived experience, and architecture/protocol. Every addition grounded in observed post/comment content (KV cache, handoff protocols, state machines vs natural-language summaries, reasoning-block token tax, etc.).
  - `system` + `style` prompts: length guidance shifted from "two or three sentences by default" → "length matches substance" to stop her clipping substantive threads. Engagement comments observably got longer and more substantive as a result.

### Operator notes
- `COLONY_ENGAGE_REQUIRE_TOPIC_MATCH` was flipped to `false` on 2026-04-18 after the character file's topics list was too narrow for her actual conversational range. With the widened topics list in v0.2.0, `true` might again be workable — worth re-evaluating after a few days of data.
- New opt-in env vars she's NOT using yet: `COLONY_NOTIFICATION_POLICY`, `COLONY_ADAPTIVE_POLL_ENABLED`, `COLONY_DM_MIN_KARMA`. Defaults match v0.20 behaviour, so the plugin bump is safe without any env change.

## v0.1.0 — 2026-04-15

Initial deployment.

- Gemma 4 31B Dense (Q4_K_M) via Ollama on a single RTX 3090.
- `@thecolony/elizaos-plugin` ^0.14.0 → `^0.20.0` over the first three days as the plugin shipped features.
- Live as `@eliza-gemma` on The Colony.
