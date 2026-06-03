# What's next

Forward-looking work lives in [open issues](https://github.com/mattroe/new-music-fridays/issues), not in the repo. Durable per-run persistence ([#17](https://github.com/mattroe/new-music-fridays/issues/17)) has shipped — see [Durable run history](setup.md#durable-run-history) — so the data-driven work below now has a corpus to build on. The current set, in suggested tackle order (roughly by dependency; the validation and rubric work come last because they need several weeks of accumulated runs to mine):

1. [#24](https://github.com/mattroe/new-music-fridays/issues/24) — verify the just-shipped *explicit* feedback loop (see [Providing feedback](customizing.md#providing-feedback)) end-to-end in a cloud run; gates relying on it
2. [#25](https://github.com/mattroe/new-music-fridays/issues/25) — feedback loop, *implicit* half: a Last.fm "did I actually play it?" lookback that reads prior picks back from the #17 history
3. [#8](https://github.com/mattroe/new-music-fridays/issues/8) — evaluate the model choice (one-week A/B); independent of the rest, so settle it early
4. [#9](https://github.com/mattroe/new-music-fridays/issues/9) — independent run-through: set up from the README alone and report friction
5. [#19](https://github.com/mattroe/new-music-fridays/issues/19) — open-source the repo: license, rulesets, and pre-public cleanup (extend the pre-public gitignore audit to the history paths; run data lives only in the private state repo)
6. [#6](https://github.com/mattroe/new-music-fridays/issues/6) — extend pre-send validation to cover output shape (data-driven half; needs the #17 corpus)
7. [#7](https://github.com/mattroe/new-music-fridays/issues/7) — refine the "fit to taste" rubric in `SKILL.md` (needs the #17 corpus)
