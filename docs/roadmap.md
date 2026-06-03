# What's next

Forward-looking work lives in [open issues](https://github.com/mattroe/new-music-fridays/issues), not in the repo. Durable per-run persistence ([#17](https://github.com/mattroe/new-music-fridays/issues/17)) has shipped — see [Durable run history](setup.md#durable-run-history) — so the data-driven work below now has a corpus to build on. The current set, in suggested tackle order (roughly by dependency; the validation and rubric work come last because they need several weeks of accumulated runs to mine):

1. [#24](https://github.com/mattroe/new-music-fridays/issues/24) — verify the *explicit* and *implicit* feedback loops (see [Providing feedback](customizing.md#providing-feedback)) end-to-end in a cloud run; gates relying on them
2. [#8](https://github.com/mattroe/new-music-fridays/issues/8) — evaluate the model choice (one-week A/B); independent of the rest, so settle it early
3. [#9](https://github.com/mattroe/new-music-fridays/issues/9) — independent run-through: set up from the README alone and report friction
4. [#19](https://github.com/mattroe/new-music-fridays/issues/19) — open-source the repo: license, rulesets, and pre-public cleanup (extend the pre-public gitignore audit to the history paths; run data lives only in the private state repo)
5. [#6](https://github.com/mattroe/new-music-fridays/issues/6) — extend pre-send validation to cover output shape (data-driven half; needs the #17 corpus)
6. [#7](https://github.com/mattroe/new-music-fridays/issues/7) — refine the "fit to taste" rubric in `SKILL.md` (needs the #17 corpus)

The *implicit* feedback signal ([#25](https://github.com/mattroe/new-music-fridays/issues/25)) — a Last.fm "did I actually play it?" lookback over prior picks — has shipped; cloud verification rides along with #24.
