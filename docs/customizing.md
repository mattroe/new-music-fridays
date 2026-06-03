# Customizing for your taste

- `config/release-sources.yaml` — swap in publications, blogs, and label sites for discovery. Tier-1 sources are consulted every run; tier-2 only when their `genres` overlap that week's listening profile.
- `config/review-sources.yaml` — the review outlets whose endorsements decorate picks, plus the exact citation strings allowed in the email.
- `config/lastfm.yaml` — tune query periods, top-artist limits, and the similar-artist fan-out depth.
- `templates/email.html` and `templates/email.txt` — edit the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- **Model.** The model is set on the routine itself — Sonnet is the default (sufficient curation for this digest at a fraction of the token cost), with Opus available for deeper curation and Haiku for cheaper, faster runs. The `model:` frontmatter in `SKILL.md` is ignored by routines; it documents the intended default (see the [Claude Code skills docs](https://code.claude.com/docs/en/skills) for what the field means). Routines expose no effort control, so there's nothing to set there.
- `SKILL.md` prompt body — the orchestration itself is editable. Add a section, tighten the rubric, or change what gets logged.

## Providing feedback

The digest steers toward your taste over time from a single trusted file, `config/feedback.md` — append-only prose where you react to each week's picks (what you loved, want more of, or want pulled back, by artist, genre, or scene). Each Friday run reads it before searching, weights the last ~12 weeks most heavily, biases its research toward what you've liked and away from what you haven't, and notes the influence in that run's `candidates.md`. An empty or missing file is fine — runs proceed normally until you start adding reactions. (This is the *explicit* half of the feedback loop; the implicit "did I actually play it?" signal is tracked in [#25](https://github.com/mattroe/new-music-fridays/issues/25), built on the [#17](https://github.com/mattroe/new-music-fridays/issues/17) history corpus.)

Two ways to add a reaction, both landing in the same file:

- **Edit it directly.** Append a bullet under a `## YYYY-MM-DD` heading and commit:
  ```markdown
  ## 2026-06-05
  - Loved Big Thief — Double Infinity. More along that axis.
  - Three weeks of shoegaze — pull back.
  ```
- **Tell the run.** Reopen the week's run (Routines → New Music Fridays → Runs → that run) and react in the conversation — the email footer reminds you of this. The session distills the steer, shows you the exact line it will add, and after you confirm, opens a PR against `config/feedback.md` for you to merge (one click). It commits to a `claude/feedback-*` branch, never straight to `main` — the merge is a human gate that keeps the production routine read-only on the repo. See `SKILL.md`'s "Capturing feedback (post-run)" for the protocol.

Keep `config/feedback.md` to taste signal about the picks only; questions and unrelated asks stay in conversation.
